"""Process FIRMS detections into the static data contract under web/public/data/.

    python process.py                              # uses data/raw/ (API downloads)
    python process.py --from-archive path/to/csvs  # also ingest FIRMS Archive Download CSVs
    python process.py --from-archive path --no-raw # archive CSVs only
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd
import polars as pl

import config as C
import forecast as FC
import fsi as F
import climate as CL
import harmonize as H
import pixels as PX
import wind as WD
import regions as R
from config import AQUA, NOAA20, SNPP, TERRA
from firms_io import load_detections

log = logging.getLogger("process")


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def clean_row(row: dict) -> dict:
    """Drop private keys and convert numpy / NaN values for JSON."""
    out = {}
    for k, v in row.items():
        if k.startswith("_"):
            continue
        if v is not None and isinstance(v, float) and v != v:
            v = None
        elif hasattr(v, "item"):
            v = v.item()
        out[k] = v
    return out


def build_cells(
    cc: pd.DataFrame,
    monthly: dict[str, list[dict]],
    regions_df: pd.DataFrame,
    out_dir: Path,
    min_year: int,
) -> int:
    """Write cells/{region_id}/{year}.json for admin-1, demo and country regions.

    Cell value = sum over the month's contributing satellites of cell count x the region's
    effective multiplier for that satellite (same blend as the monthly series).
    Returns number of files written.
    """
    if cc.empty:
        return 0
    mult = {}
    for rid, rows in monthly.items():
        for r in rows:
            for sat, f in (r.get("_mult") or {}).items():
                mult[(rid, r["year"], r["month"], sat)] = f
    types = dict(zip(regions_df["id"], regions_df["type"]))
    countries = dict(zip(regions_df["id"], regions_df["country"]))

    cc = cc[cc["year"] >= min_year].copy()
    cc["rtype"] = cc["region_id"].map(types)
    cc = cc[cc["rtype"].isin(["admin1", "demo"])]
    cc["mult"] = [mult.get((r, int(y), int(m), s)) for r, y, m, s in zip(cc["region_id"], cc["year"], cc["month"], cc["satellite"])]
    cc = cc[cc["mult"].notna()]
    cc["value"] = cc["n"] * cc["mult"].astype(float)
    # One file set per region id: each admin-1 and demo region gets its own cells, and each
    # country file holds all of its admin-1 cells (tagged with region_index).
    own = cc.assign(group=cc["region_id"])
    national = cc[cc["rtype"] == "admin1"].assign(group=lambda d: d["region_id"].map(countries))
    cc = pd.concat([own, national], ignore_index=True)

    cc = (
        cc.groupby(["group", "year", "region_id", "c10_lat", "c10_lon", "month"], as_index=False)["value"].sum()
        .assign(value=lambda d: d["value"].round(0))
    )
    cc = cc[cc["value"] > 0].sort_values(["group", "year", "region_id", "c10_lat", "c10_lon", "month"])

    n_files = 0
    for (group, year), g in cc.groupby(["group", "year"], sort=False):
        region_ids = sorted(g["region_id"].unique())
        ridx = {r: i for i, r in enumerate(region_ids)}
        # months with no active sensor for this group (same for every cell)
        ref_region = group if group in monthly else region_ids[0]
        null_months = [r["month"] for r in monthly.get(ref_region, []) if r["year"] == year and r["harmonized"] is None]
        cells: list[list] = []
        last_key = None
        for rid, clat, clon, m, v in g[["region_id", "c10_lat", "c10_lon", "month", "value"]].itertuples(index=False):
            key = (rid, clat, clon)
            if key != last_key:
                cells.append([round((int(clon) + 0.5) / 10, 2), round((int(clat) + 0.5) / 10, 2), ridx[rid]])
                last_key = key
            cells[-1] += [int(m), int(v)]
        write_json(
            out_dir / "cells" / group / f"{int(year)}.json",
            {
                "group": group,
                "year": int(year),
                "cell_size": 0.1,
                "regions": region_ids,
                "null_months": null_months,
                "format": "[lon_center, lat_center, region_index, month, value, month, value, ...]",
                "cells": cells,
            },
        )
        n_files += 1
    return n_files


def dir_size(path: Path) -> int:
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())


def run(args) -> int:
    countries = [c.strip().upper() for c in args.countries.split(",") if c.strip()]
    out_dir = Path(args.out)

    raw_dir = None if args.no_raw else C.RAW_DIR
    archive = Path(args.from_archive) if args.from_archive else None
    det = load_detections(raw_dir, archive)
    if det.height == 0:
        log.error("No FIRMS detections found (looked in %s%s). Run download_firms.py or pass --from-archive.", raw_dir, f" and {archive}" if archive else "")
        return 2
    log.info("Loaded %d detections", det.height)
    coverage = H.compute_coverage(det, end_override=date.fromisoformat(args.coverage_end) if args.coverage_end else None)
    source_ranges = {
        sat: [str(d) for d in det.filter(pl.col("satellite") == sat).select(pl.col("acq_date").min().alias("lo"), pl.col("acq_date").max().alias("hi")).row(0)]
        for sat in det["satellite"].unique().to_list()
    }

    clean = H.clean_detections(det)
    log.info("After cleaning: %d detections", clean.height)
    del det
    cell_days = H.to_cell_days(clean)
    log.info("Fire cell-days: %d", cell_days.height)

    R.download_boundaries(countries)
    regions_gdf = R.load_regions(countries)
    regions_df = pd.DataFrame(regions_gdf.drop(columns="geometry"))
    names = dict(zip(regions_df["id"], regions_df["name"]))
    types = dict(zip(regions_df["id"], regions_df["type"]))
    country_of = dict(zip(regions_df["id"], regions_df["country"]))
    cell_regions = R.map_cells_to_regions(cell_days, regions_gdf)
    counts = H.region_counts(cell_days, cell_regions)
    cc = H.cell_counts(cell_days, cell_regions)
    frp = H.region_frp(clean, cell_regions)
    # detections of the last ~3 years for the FSI ranking (admin-1 tagged)
    max_date = clean["acq_date"].max()
    cutoff = date(max_date.year - 3, max_date.month, 1)
    admin1_cells = cell_regions.filter(pl.col("region_id").is_in([r for r, t in types.items() if t == "admin1"]))
    fsi_det = (
        clean.filter(pl.col("acq_date") >= cutoff)
        .join(admin1_cells, on=["cell_lat", "cell_lon"], how="inner")
        .with_columns(
            (pl.col("cell_lat") // 10).alias("c10_lat"),
            (pl.col("cell_lon") // 10).alias("c10_lon"),
            pl.col("acq_date").dt.year().alias("year"),
            pl.col("acq_date").dt.month().alias("month"),
        )
        .select(["region_id", "c10_lat", "c10_lon", "acq_date", "year", "month", "satellite", "frp"])
        .to_pandas()
    )
    pix_regions = [r for r in PX.PIXEL_REGIONS if r in types]
    pix_det = (
        clean.filter(pl.col("acq_date") >= cutoff)
        .join(cell_regions.filter(pl.col("region_id").is_in(pix_regions)), on=["cell_lat", "cell_lon"], how="inner")
        .with_columns(pl.col("acq_date").dt.year().alias("year"), pl.col("acq_date").dt.month().alias("month"))
        .select(["region_id", "year", "month", "longitude", "latitude", "satellite", "acq_date", "daynight", "scan", "track", "frp", "confidence"])
        .to_pandas()
    )
    del clean, cell_days
    log.info("Region-month rows: %d, cell-month rows: %d", len(counts), len(cc))

    gamma = H.calibrate(counts, coverage, regions_df, SNPP, AQUA, C.K_YEARS)
    k2 = H.calibrate(counts, coverage, regions_df, NOAA20, SNPP, C.K2_YEARS)
    kt = H.calibrate(counts, coverage, regions_df, TERRA, AQUA, C.TERRA_YEARS)
    frp_cal = H.calibrate_frp(frp, coverage, regions_df)

    if out_dir.exists() and not args.keep_existing:
        for sub in ("monthly", "climatology", "cells", "ranking", "forecast", "climate", "wind", "pixels"):
            shutil.rmtree(out_dir / sub, ignore_errors=True)

    monthly: dict[str, list[dict]] = {}
    seams = {}
    for rid in regions_df["id"]:
        rows = H.harmonize_region(rid, counts, coverage, gamma, k2, kt)
        H.add_frp(rows, rid, frp, frp_cal)
        H.add_z(rows)
        monthly[rid] = rows
        seams[rid] = H.seam_ratio(rows)
        write_json(out_dir / "monthly" / f"{rid}.json", [clean_row(r) for r in rows])
        write_json(out_dir / "climatology" / f"{rid}.json", H.climatology(rows))

    admin1_ids = regions_df.loc[regions_df["type"] == "admin1", "id"].tolist()
    loyo = H.loyo_validation(counts, coverage, regions_df, admin1_ids)
    country_rows = [r for c in countries for r in monthly.get(c, [])]
    overall = pd.DataFrame(country_rows)
    if not overall.empty:
        agg = overall.groupby(["year", "month"], as_index=False)[["_raw_source", "harmonized", "raw_aqua"]].sum(min_count=1)
        seam_overall = H.seam_ratio(agg.to_dict("records"))
    else:
        seam_overall = None
    summary = {}
    if loyo:
        ldf = pd.DataFrame(loyo)
        summary = {
            "mape_raw_mean": round(float(ldf["mape_raw"].mean()), 3),
            "mape_harmonized_mean": round(float(ldf["mape_harmonized"].mean()), 3),
            "r_mean": None if ldf["r"].isna().all() else round(float(ldf["r"].mean()), 3),
        }
    factors_out = {}
    for name, f in (("gamma_snpp_over_aqua", gamma), ("k2_noaa20_over_snpp", k2), ("terra_over_aqua", kt)):
        t = f.table.reset_index()
        t = t[t["region_id"].isin(countries)]
        factors_out[name] = [
            {"region_id": r.region_id, "month": int(r.month), "daynight": r.daynight, "k": round(r.k, 3),
             "k_p5": round(r.k_p5, 3), "k_p95": round(r.k_p95, 3), "level": r.level}
            for r in t.itertuples(index=False)
        ]

    # FSI ranking for the last N months per country
    n_rank = 0
    months_all = sorted({(r["year"], r["month"]) for c in countries for r in monthly.get(c, []) if r["harmonized"] is not None})
    last_months = months_all[-args.ranking_months:] if args.ranking_months > 0 else []
    ranked_months: list[str] = []
    if not fsi_det.empty:
        fsi_det["country"] = fsi_det["region_id"].map(country_of)
        for c in countries:
            crow = {(r["year"], r["month"]): r for r in monthly.get(c, [])}
            for y, m in last_months:
                r = crow.get((y, m))
                sat = (r.get("_vraw") or r.get("_mraw")) if r else None
                if sat is None:
                    continue
                d = fsi_det[(fsi_det["country"] == c) & (fsi_det["year"] == y) & (fsi_det["month"] == m) & (fsi_det["satellite"] == sat)]
                # canonical web format: a plain array of clusters (sensor recorded in meta.json)
                write_json(out_dir / "ranking" / c / f"{y}-{m:02d}.json", F.rank_month(d, names))
                ranked_months.append(f"{c}/{y}-{m:02d}")
                n_rank += 1

    # Detection-level pixel footprints for demo regions
    pix_index = []
    pix_months = sorted(set(last_months) | set(PX.EXTRA_MONTHS))
    for rid in pix_regions:
        d_r = pix_det[pix_det["region_id"] == rid]
        months_done, sub_months = [], []
        for (y, m), g in d_r.groupby(["year", "month"]):
            if (int(y), int(m)) not in pix_months:
                continue
            rows_px, sub = PX.month_rows(g)
            key = f"{int(y)}-{int(m):02d}"
            write_json(out_dir / "pixels" / rid / f"{key}.json", rows_px)
            months_done.append(key)
            if sub:
                sub_months.append(key)
        if months_done:
            pix_index.append({"region_id": rid, "months": months_done, "subsampled": sub_months, "max_per_file": PX.MAX_PER_FILE})
    write_json(out_dir / "pixels" / "index.json", pix_index)

    # Ocean-climate (ENSO / ONI) and wind (NASA POWER) context
    oni = CL.load_oni()
    if oni:
        write_json(out_dir / "oni.json", CL.oni_json(oni))
    else:
        log.warning("ONI unavailable; skipping oni.json and the enso block")
    wind_df = {c: WD.load(c) for c in countries}
    geoms = dict(zip(regions_gdf["id"], regions_gdf.geometry))
    n_wind = 0
    for c in countries:
        if not wind_df[c].empty:
            n_wind += WD.export_grid(wind_df[c], geoms[c], out_dir, c)
    for rid in regions_df["id"]:
        wdf = wind_df.get(country_of[rid])
        write_json(out_dir / "climate" / f"{rid}.json", {
            "region_id": rid,
            "enso": CL.enso_link(monthly[rid], oni) if oni else None,
            "wind": WD.region_climatology(wdf, geoms[rid]) if wdf is not None and not wdf.empty else None,
        })
    log.info("Wrote climate context (%d wind files)", n_wind)

    # Forecasts
    n_fc = 0
    if not args.no_forecast:
        for rid in regions_df["id"]:
            write_json(out_dir / "forecast" / f"{rid}.json", FC.forecast_region(rid, monthly[rid]))
            n_fc += 1
        log.info("Wrote %d forecasts", n_fc)

    validation = {
        "loyo": loyo,
        "loyo_summary": summary,
        "seam_2012": seam_overall,
        "seam_2012_by_region": seams,
        "z_agreement": {
            "all_admin1": H.z_agreement(monthly, admin1_ids),
            **{c: H.z_agreement(monthly, [r for r in admin1_ids if country_of[r] == c]) for c in countries},
        },
        "frp_calibration": [{"region_id": rid, **{k_: (round(v, 4) if isinstance(v, float) else v) for k_, v in cal.items()}} for rid, cal in frp_cal.items()],
        "factors": factors_out,
        "notes": "MAPE values are fractions (0.18 = 18%). LOYO refits gamma without the year and predicts S-NPP from Aqua "
        "(raw = Aqua as-is), pooling admin-1 region-months with >= 10 S-NPP cell-days. Seam ratio = mean annual total "
        "2012-2014 / 2009-2011; aqua_ratio is the Aqua-only reference. z_agreement = Pearson r between HFAI z (per-sensor "
        "baselines) and z on the harmonized series (2003-2022 baseline) over 2012-2022.",
    }
    write_json(out_dir / "validation.json", json.loads(json.dumps(validation, default=lambda o: o.item() if hasattr(o, "item") else None)))
    write_json(out_dir / "regions.json", R.regions_json(regions_gdf))

    n_cells = build_cells(cc, monthly, regions_df, out_dir, args.cells_from_year)
    with_data = [(r["year"], r["month"], bool(r["partial"])) for c in countries for r in monthly.get(c, []) if r["harmonized"] is not None]
    last = max(with_data, default=None)
    last_complete = max(((y, m) for y, m, p in with_data if not p), default=None)
    write_json(
        out_dir / "meta.json",
        {
            "version": C.PIPELINE_VERSION,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "data_source": "NASA FIRMS (MODIS C6.1 MCD14ML, VIIRS 375 m VNP14IMG / VJ114IMG)",
            "source_date_ranges": source_ranges,
            "last_month": None if last is None else {"year": last[0], "month": last[1], "partial": last[2]},
            "last_complete_month": None if last_complete is None else {"year": last_complete[0], "month": last_complete[1]},
            "countries": countries,
            "units": "fire cell-days (unique 0.01 deg cell x UTC day x day/night x satellite); harmonized = VIIRS S-NPP equivalents",
            "blend_w_modis": H.BLEND_W,
            "cells_from_year": args.cells_from_year,
            "n_cell_files": n_cells,
            "ranking_files": ranked_months,
            "ranking_label": "Fire Severity Index (composite, 0-100)",
            "ranking_sensor": "month's VIIRS satellite (S-NPP, then NOAA-20); MODIS before 2012",
            "forecast_regions": n_fc,
        },
    )
    size_mb = dir_size(out_dir) / 1e6
    log.info("Wrote %d regions, %d cell files, %d ranking files, %d forecasts to %s (%.1f MB)", len(regions_df), n_cells, n_rank, n_fc, out_dir, size_mb)
    if size_mb > 25:
        log.warning("Output exceeds 25 MB; consider --cells-from-year to limit cell files")
    return 0

def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from-archive", help="folder with CSVs from the FIRMS Archive Download tool")
    ap.add_argument("--no-raw", action="store_true", help="ignore data/raw API downloads")
    ap.add_argument("--countries", default="CO,AR")
    ap.add_argument("--out", default=str(C.WEB_DATA_DIR))
    ap.add_argument("--cells-from-year", type=int, default=2001)
    ap.add_argument("--coverage-end", help="last date (YYYY-MM-DD) to treat as observed")
    ap.add_argument("--ranking-months", type=int, default=36, help="FSI ranking files for the last N months")
    ap.add_argument("--no-forecast", action="store_true", help="skip the Prophet/SARIMA forecasts")
    ap.add_argument("--keep-existing", action="store_true", help="do not clear old monthly/climatology/cells output")
    return run(ap.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
