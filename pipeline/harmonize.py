"""Core method (spec section 4): cleaning, fire cell-days, calibration, harmonized series,
climatology and validation. Pure functions over polars / pandas frames, no I/O.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd
import polars as pl

import config as C
from config import AQUA, NOAA20, SNPP, TERRA

# ---------------------------------------------------------------------------
# 4.2 Cleaning
# ---------------------------------------------------------------------------


def clean_detections(df: pl.DataFrame, static_min_days: int = C.STATIC_MIN_DAYS) -> pl.DataFrame:
    """Apply the cleaning rules and add 0.01 deg cell indices.

    1. keep type == 0 where `type` exists (null type = field missing -> kept, static rule applies)
    2. MODIS confidence >= 30; VIIRS confidence in nominal/high
    3. static sources: drop (cell, year, satellite) with detections on >= static_min_days distinct days
    4. daynight must be D or N; dates are FIRMS UTC acquisition dates
    """
    conf_num = pl.col("confidence").cast(pl.Float64, strict=False)
    viirs_conf = pl.col("confidence").str.slice(0, 1)  # 'nominal' -> 'n', 'h' -> 'h'
    is_modis = pl.col("satellite").is_in(list(C.MODIS_SATS))
    out = df.filter(
        (pl.col("type").is_null() | (pl.col("type") == 0))
        & pl.col("daynight").is_in(["D", "N"])
        & pl.when(is_modis)
        .then(conf_num >= C.MODIS_MIN_CONFIDENCE)
        .otherwise(viirs_conf.is_in(list(C.VIIRS_KEEP_CONFIDENCE)))
        .fill_null(False)
    )
    out = out.with_columns(
        (pl.col("latitude") * 100).floor().cast(pl.Int32).alias("cell_lat"),
        (pl.col("longitude") * 100).floor().cast(pl.Int32).alias("cell_lon"),
        pl.col("acq_date").dt.year().alias("year"),
    )
    days = out.group_by(["cell_lat", "cell_lon", "year", "satellite"]).agg(pl.col("acq_date").n_unique().alias("n_days"))
    static = days.filter(pl.col("n_days") >= static_min_days).select(["cell_lat", "cell_lon", "year", "satellite"])
    if static.height:
        out = out.join(static, on=["cell_lat", "cell_lon", "year", "satellite"], how="anti")
    return out.drop("year")


# ---------------------------------------------------------------------------
# 4.3 Fire cell-days
# ---------------------------------------------------------------------------


def to_cell_days(clean: pl.DataFrame) -> pl.DataFrame:
    """Unique (0.01 deg cell, UTC date, daynight, satellite) = one fire cell-day."""
    return clean.select(["cell_lat", "cell_lon", "acq_date", "daynight", "satellite"]).unique()


def region_counts(cell_days: pl.DataFrame, cell_regions: pl.DataFrame) -> pd.DataFrame:
    """Aggregate cell-days to region x year x month x daynight x satellite.

    cell_regions: (cell_lat, cell_lon, region_id), many-to-many.
    """
    joined = cell_days.join(cell_regions, on=["cell_lat", "cell_lon"], how="inner")
    agg = (
        joined.with_columns(pl.col("acq_date").dt.year().alias("year"), pl.col("acq_date").dt.month().alias("month"))
        .group_by(["region_id", "year", "month", "daynight", "satellite"])
        .agg(pl.len().alias("n"))
    )
    return agg.to_pandas()


def cell_counts(cell_days: pl.DataFrame, cell_regions: pl.DataFrame) -> pd.DataFrame:
    """Aggregate cell-days to 0.1 deg cell x region x year x month x satellite (day+night summed)."""
    joined = cell_days.join(cell_regions, on=["cell_lat", "cell_lon"], how="inner")
    agg = (
        joined.with_columns(
            (pl.col("cell_lat") // 10).alias("c10_lat"),
            (pl.col("cell_lon") // 10).alias("c10_lon"),
            pl.col("acq_date").dt.year().alias("year"),
            pl.col("acq_date").dt.month().alias("month"),
        )
        .group_by(["region_id", "c10_lat", "c10_lon", "year", "month", "satellite"])
        .agg(pl.len().alias("n"))
    )
    return agg.to_pandas()


# ---------------------------------------------------------------------------
# Sensor coverage (which satellite observed which month)
# ---------------------------------------------------------------------------


def compute_coverage(detections: pl.DataFrame, end_override: date | None = None) -> pd.DataFrame:
    """Covered days per (satellite, year, month).

    A satellite covers the days between its first and last acquisition date in the loaded data,
    clipped to its mission window. Months with zero detections over the whole download area are
    treated as outages (not covered). Returns columns: satellite, year, month, days_covered, days_in_month.
    """
    rows = []
    if detections.height == 0:
        return pd.DataFrame(columns=["satellite", "year", "month", "days_covered", "days_in_month"])
    stats = detections.group_by("satellite").agg(pl.col("acq_date").min().alias("lo"), pl.col("acq_date").max().alias("hi"))
    months_with_data = set(
        detections.select(
            pl.col("satellite"), pl.col("acq_date").dt.year().alias("y"), pl.col("acq_date").dt.month().alias("m")
        )
        .unique()
        .iter_rows()
    )
    for sat, lo, hi in stats.iter_rows():
        m_lo, m_hi = C.MISSION_WINDOWS[sat]
        lo = max(lo, m_lo)
        if m_hi is not None:
            hi = min(hi, m_hi)
        if end_override is not None:
            hi = min(hi, end_override)
        for (y, m), d_lo, d_hi in _month_spans(lo, hi):
            if (sat, y, m) not in months_with_data:
                continue
            rows.append((sat, y, m, (d_hi - d_lo).days + 1, calendar.monthrange(y, m)[1]))
    return pd.DataFrame(rows, columns=["satellite", "year", "month", "days_covered", "days_in_month"])


def coverage_from_ranges(ranges: dict[str, tuple[date, date]]) -> pd.DataFrame:
    """Build a coverage table from explicit [start, end] date ranges (used by tests)."""
    rows = []
    for sat, (lo, hi) in ranges.items():
        for (y, m), d_lo, d_hi in _month_spans(lo, hi):
            rows.append((sat, y, m, (d_hi - d_lo).days + 1, calendar.monthrange(y, m)[1]))
    return pd.DataFrame(rows, columns=["satellite", "year", "month", "days_covered", "days_in_month"])


def _month_spans(lo: date, hi: date):
    y, m = lo.year, lo.month
    while (y, m) <= (hi.year, hi.month):
        first = date(y, m, 1)
        last = date(y, m, calendar.monthrange(y, m)[1])
        yield (y, m), max(first, lo), min(last, hi)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


# ---------------------------------------------------------------------------
# 4.4 Calibration factors with shrinkage
# ---------------------------------------------------------------------------


@dataclass
class Factors:
    """Factor table indexed by (region_id, month, daynight) with columns k, k_p5, k_p95, level."""

    table: pd.DataFrame

    def lookup(self, region_id: str, month: int, daynight: str) -> tuple[float, float, float]:
        row = self.table.loc[(region_id, month, daynight)]
        return float(row["k"]), float(row["k_p5"]), float(row["k_p95"])


def _full_months(coverage: pd.DataFrame, sats: list[str]) -> set[tuple[int, int]]:
    full = coverage[coverage["days_covered"] == coverage["days_in_month"]]
    sets = [set(map(tuple, full[full["satellite"] == s][["year", "month"]].values.tolist())) for s in sats]
    return set.intersection(*sets) if sets else set()


def calibrate(
    counts: pd.DataFrame,
    coverage: pd.DataFrame,
    regions: pd.DataFrame,
    num_sat: str,
    den_sat: str,
    years: tuple[int, int],
    exclude_year: int | None = None,
    min_den: int = C.MIN_DEN_CELL_DAYS,
) -> Factors:
    """Ratio factor num_sat / den_sat per (region, calendar month, daynight).

    Only months fully covered by both satellites inside `years` are used. Shrinkage chain, first
    level whose denominator sum >= min_den wins:
        L1 (region, month, dn) -> L2 (region, dn) -> L3 (country, month, dn) -> L4 (country, dn)
        -> L5 (all regions pooled, dn) -> 1.0 ('none').
    p5 / p95 come from the spread of annual ratios (num/den per overlap year) at the chosen level.
    `regions` needs columns id, country. The country level uses the country region (id == country).
    """
    valid = _full_months(coverage, [num_sat, den_sat])
    c = counts[counts["satellite"].isin([num_sat, den_sat])]
    c = c[(c["year"] >= years[0]) & (c["year"] <= years[1])]
    if exclude_year is not None:
        c = c[c["year"] != exclude_year]
    if len(c):
        keep = [(y, m) in valid for y, m in zip(c["year"], c["month"])]
        c = c[keep]
    wide = (
        c.pivot_table(index=["region_id", "year", "month", "daynight"], columns="satellite", values="n", aggfunc="sum", fill_value=0)
        .reindex(columns=[num_sat, den_sat], fill_value=0)
        .rename(columns={num_sat: "num", den_sat: "den"})
        .reset_index()
    )
    # Years that contribute: fully covered overlap years (zero-count months still count as observed).
    country_of = dict(zip(regions["id"], regions["country"]))

    def annual(group_cols: list[str]) -> pd.DataFrame:
        return wide.groupby(group_cols + ["year"], as_index=False)[["num", "den"]].sum()

    def summarize(group_cols: list[str]) -> dict:
        a = annual(group_cols)
        out = {}
        for key, g in a.groupby(group_cols):
            key = key if isinstance(key, tuple) else (key,)
            num, den = g["num"].sum(), g["den"].sum()
            if den <= 0 or num <= 0:
                continue
            ratios = (g["num"] / g["den"])[(g["den"] > 0) & (g["num"] > 0)].to_numpy()
            k = num / den
            if len(ratios) >= 2:
                p5, p95 = float(np.percentile(ratios, 5)), float(np.percentile(ratios, 95))
                p5, p95 = min(p5, k), max(p95, k)
            else:
                p5 = p95 = k
            out[key] = (k, p5, p95, den)
        return out

    l1 = summarize(["region_id", "month", "daynight"])
    l2 = summarize(["region_id", "daynight"])
    l5 = summarize(["daynight"])

    rows = []
    for rid in regions["id"]:
        country = country_of.get(rid)
        for month in range(1, 13):
            for dn in ("D", "N"):
                candidates = [
                    ("region_month", l1.get((rid, month, dn))),
                    ("region_annual", l2.get((rid, dn))),
                    ("country_month", l1.get((country, month, dn))),
                    ("country_annual", l2.get((country, dn))),
                    ("pooled", l5.get((dn,))),
                ]
                chosen = None
                for level, val in candidates:
                    if val is not None and val[3] >= min_den:
                        chosen = (level, val)
                        break
                if chosen is None:  # nothing meets the threshold: best available, else neutral
                    for level, val in candidates:
                        if val is not None:
                            chosen = (level + "_lowcount", val)
                            break
                if chosen is None:
                    rows.append((rid, month, dn, 1.0, 1.0, 1.0, "none"))
                else:
                    level, (k, p5, p95, _) = chosen
                    rows.append((rid, month, dn, k, p5, p95, level))
    table = pd.DataFrame(rows, columns=["region_id", "month", "daynight", "k", "k_p5", "k_p95", "level"])
    return Factors(table.set_index(["region_id", "month", "daynight"]).sort_index())


# ---------------------------------------------------------------------------
# Harmonized monthly series (REPORT_ALIGNMENT 1): VIIRS S-NPP equivalents
# ---------------------------------------------------------------------------

BLEND_W = 0.5  # MODIS weight in months where both MODIS and VIIRS observe


def _pick(sats: list[str], cov: dict[str, int]) -> str | None:
    """Satellite with most covered days in the month; ties broken by list order."""
    best, best_days = None, 0
    for s in sats:
        d = cov.get(s, 0)
        if d > best_days:
            best, best_days = s, d
    return best


def month_range(first: tuple[int, int], last: tuple[int, int]):
    y, m = first
    while (y, m) <= last:
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def coverage_maps(coverage: pd.DataFrame):
    cov_map: dict[tuple[int, int], dict[str, int]] = {}
    dim_map: dict[tuple[int, int], int] = {}
    for sat, y, m, dc, dim in coverage[["satellite", "year", "month", "days_covered", "days_in_month"]].itertuples(index=False):
        cov_map.setdefault((int(y), int(m)), {})[sat] = int(dc)
        dim_map[(int(y), int(m))] = int(dim)
    return cov_map, dim_map


def harmonize_region(
    region_id: str,
    counts: pd.DataFrame,
    coverage: pd.DataFrame,
    gamma: Factors,
    k2: Factors,
    kt: Factors,
    first: tuple[int, int] = C.FIRST_MONTH,
    last: tuple[int, int] | None = None,
    w_blend: float = BLEND_W,
) -> list[dict]:
    """Monthly rows for one region in VIIRS S-NPP equivalents.

    gamma = S-NPP/Aqua, k2 = NOAA-20/S-NPP, kt = Terra/Aqua (all per region, month, daynight).
    N_MODIS = one MODIS satellite on the Aqua scale (Aqua, else Terra / kt).
    N_VIIRS = one VIIRS satellite on the S-NPP scale (S-NPP, else NOAA-20 / k2); never a sum.
    harmonized = gamma * N_MODIS (MODIS only) | w*gamma*N_MODIS + (1-w)*N_VIIRS (both) | N_VIIRS.
    A sensor family takes part only when it covers as many days of the month as the best family.
    """
    cov_map, dim_map = coverage_maps(coverage)
    if last is None:
        last = max(cov_map) if cov_map else first
    rc = counts[counts["region_id"] == region_id]
    n_map = {(int(y), int(m), dn, s): int(n) for y, m, dn, s, n in rc[["year", "month", "daynight", "satellite", "n"]].itertuples(index=False)}

    def raw(y, m, sat, dn=None):
        if dn is None:
            return n_map.get((y, m, "D", sat), 0) + n_map.get((y, m, "N", sat), 0)
        return n_map.get((y, m, dn, sat), 0)

    rows = []
    for y, m in month_range(first, last):
        cov = cov_map.get((y, m), {})
        row: dict = {"year": y, "month": m}
        for sat, key in ((TERRA, "raw_terra"), (AQUA, "raw_aqua"), (SNPP, "raw_snpp"), (NOAA20, "raw_noaa20")):
            row[key] = raw(y, m, sat) if cov.get(sat, 0) > 0 else None
        msat = _pick([AQUA, TERRA], cov)
        vsat = _pick([SNPP, NOAA20], cov)
        row["raw_modis"] = raw(y, m, msat) if msat else None
        row["raw_viirs"] = raw(y, m, vsat) if vsat else None
        row["_mraw"], row["_vraw"] = msat, vsat
        best = max([cov.get(s, 0) for s in (msat, vsat) if s] or [0])
        m_ok = msat is not None and cov.get(msat, 0) >= best
        v_ok = vsat is not None and cov.get(vsat, 0) >= best
        if not (m_ok or v_ok):
            row.update(harmonized=None, harmonized_p5=None, harmonized_p95=None, source=None, factor=None, w=None, regime=None, partial=None)
            row.update(_msat=None, _vsat=None, _nm=None, _nv=None, _mult={}, _raw_source=None)
            rows.append(row)
            continue
        w = w_blend if (m_ok and v_ok) else (1.0 if m_ok else 0.0)
        val = lo = hi = 0.0
        nm = nv = 0.0
        mult: dict[str, float] = {}
        m_base_sum = m_cnt = 0.0
        v_base_sum = v_cnt = 0.0
        m_bases, v_bases = [], []
        for dn in ("D", "N"):
            g, g_lo, g_hi = gamma.lookup(region_id, m, dn)
            if m_ok:
                n = raw(y, m, msat, dn)
                if msat == TERRA:  # bridge Terra to the Aqua scale first
                    t, t_lo, t_hi = kt.lookup(region_id, m, dn)
                    to_aqua, to_aqua_lo, to_aqua_hi = 1 / t, 1 / t_hi, 1 / max(t_lo, 1e-9)
                else:
                    to_aqua = to_aqua_lo = to_aqua_hi = 1.0
                nm += n * to_aqua
                base = g * to_aqua
                val += w * n * base
                lo += w * n * g_lo * to_aqua_lo
                hi += w * n * g_hi * to_aqua_hi
                m_base_sum += n * base
                m_cnt += n
                m_bases.append(base)
            if v_ok:
                n = raw(y, m, vsat, dn)
                if vsat == NOAA20:
                    a, a_lo, a_hi = k2.lookup(region_id, m, dn)
                    b, b_lo, b_hi = 1 / a, 1 / a_hi, 1 / max(a_lo, 1e-9)
                else:
                    b = b_lo = b_hi = 1.0
                nv += n * b
                val += (1 - w) * n * b
                lo += (1 - w) * n * b_lo
                hi += (1 - w) * n * b_hi
                v_base_sum += n * b
                v_cnt += n
                v_bases.append(b)
        if m_ok:
            mult[msat] = w * (m_base_sum / m_cnt if m_cnt else float(np.mean(m_bases)))
        if v_ok:
            mult[vsat] = (1 - w) * (v_base_sum / v_cnt if v_cnt else float(np.mean(v_bases)))
        if m_ok:
            factor = m_base_sum / m_cnt if m_cnt else float(np.mean(m_bases))
        else:
            factor = v_base_sum / v_cnt if v_cnt else float(np.mean(v_bases))
        labels = ([C.SOURCE_LABELS[msat]] if m_ok else []) + ([C.SOURCE_LABELS[vsat]] if v_ok else [])
        has_viirs = any(cov.get(s, 0) > 0 for s in C.VIIRS_SATS)
        regime = "R3" if has_viirs else ("R2" if cov.get(AQUA, 0) > 0 else "R1")
        row.update(
            harmonized=round(val, 1),
            harmonized_p5=round(lo, 1),
            harmonized_p95=round(hi, 1),
            source="+".join(labels),
            factor=round(factor, 3),
            w=w,
            regime=regime,
            partial=best < dim_map[(y, m)],
        )
        row.update(
            _msat=msat if m_ok else None,
            _vsat=vsat if v_ok else None,
            _nm=nm if m_ok else None,
            _nv=nv if v_ok else None,
            _mult=mult,
            _raw_source=raw(y, m, vsat) if v_ok else raw(y, m, msat),
        )
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# FRP power-law calibration (REPORT_ALIGNMENT 2)
# ---------------------------------------------------------------------------


def region_frp(clean: pl.DataFrame, cell_regions: pl.DataFrame) -> pd.DataFrame:
    """FRP sum (MW) per region x year x month x satellite (day+night)."""
    j = clean.join(cell_regions, on=["cell_lat", "cell_lon"], how="inner")
    agg = (
        j.with_columns(pl.col("acq_date").dt.year().alias("year"), pl.col("acq_date").dt.month().alias("month"))
        .group_by(["region_id", "year", "month", "satellite"])
        .agg(pl.col("frp").fill_null(0).sum().alias("frp"))
    )
    return agg.to_pandas()


def fit_power_law(x: np.ndarray, y: np.ndarray) -> tuple[float, float, float, int] | None:
    """OLS of ln(y) = ln(alpha) + beta ln(x) on pairs with x, y > 0. Returns (alpha, beta, r2, n)."""
    mask = (x > 0) & (y > 0)
    x, y = np.log(x[mask]), np.log(y[mask])
    n = int(mask.sum())
    if n < 3 or np.std(x) == 0:
        return None
    beta, ln_a = np.polyfit(x, y, 1)
    pred = ln_a + beta * x
    ss_res = float(np.sum((y - pred) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return float(np.exp(ln_a)), float(beta), float(r2), n


def _ratio_of_sums(frp: pd.DataFrame, num: str, den: str, years, valid: set) -> dict[str, float]:
    f = frp[(frp["year"] >= years[0]) & (frp["year"] <= years[1])]
    f = f[[(int(y), int(m)) in valid for y, m in zip(f["year"], f["month"])]] if len(f) else f
    p = f.pivot_table(index="region_id", columns="satellite", values="frp", aggfunc="sum", fill_value=0)
    out = {}
    if num in p and den in p:
        for rid, r in p.iterrows():
            if r[den] > 0 and r[num] > 0:
                out[rid] = float(r[num] / r[den])
    return out


def calibrate_frp(frp: pd.DataFrame, coverage: pd.DataFrame, regions: pd.DataFrame, years=C.K_YEARS, min_n: int = 24) -> dict:
    """Per-region power law S-NPP FRP vs Aqua FRP on fully covered overlap months, with country
    fallback when fewer than `min_n` paired months. Also Terra->Aqua and NOAA-20->S-NPP FRP ratios.
    """
    valid = _full_months(coverage, [SNPP, AQUA])
    f = frp[(frp["year"] >= years[0]) & (frp["year"] <= years[1])]
    if len(f):
        f = f[[(int(y), int(m)) in valid for y, m in zip(f["year"], f["month"])]]
    p = f.pivot_table(index=["region_id", "year", "month"], columns="satellite", values="frp", aggfunc="sum", fill_value=0)
    p = p.reindex(columns=[AQUA, SNPP], fill_value=0).reset_index()
    fits = {}
    for rid, g in p.groupby("region_id"):
        fits[rid] = fit_power_law(g[AQUA].to_numpy(float), g[SNPP].to_numpy(float))
    pooled = fit_power_law(p[AQUA].to_numpy(float), p[SNPP].to_numpy(float)) if len(p) else None
    country_of = dict(zip(regions["id"], regions["country"]))
    cal = {}
    for rid in regions["id"]:
        own, ctry = fits.get(rid), fits.get(country_of.get(rid))
        if own is not None and own[3] >= min_n:
            alpha, beta, r2, n = own
            level = "region"
        elif ctry is not None and ctry[3] >= min_n:
            alpha, beta, r2, n = ctry
            level = "country"
        elif pooled is not None:
            alpha, beta, r2, n = pooled
            level = "pooled"
        else:
            alpha, beta, r2, n = 1.0, 1.0, 0.0, 0
            level = "none"
        cal[rid] = {"alpha": alpha, "beta": beta, "r2": r2, "n": n, "level": level}
    terra = _ratio_of_sums(frp, TERRA, AQUA, C.TERRA_YEARS, _full_months(coverage, [TERRA, AQUA]))
    n20 = _ratio_of_sums(frp, NOAA20, SNPP, C.K2_YEARS, _full_months(coverage, [NOAA20, SNPP]))
    for rid in cal:
        c = country_of.get(rid)
        cal[rid]["terra_over_aqua"] = terra.get(rid, terra.get(c, 1.0))
        cal[rid]["noaa20_over_snpp"] = n20.get(rid, n20.get(c, 1.0))
    return cal


def add_frp(rows: list[dict], region_id: str, frp: pd.DataFrame, cal: dict) -> None:
    """Add frp_raw_modis, frp_raw_viirs, frp_harmonized (MW, 1 decimal) using each row's blend."""
    f = frp[frp["region_id"] == region_id]
    fmap = {(int(y), int(m), s): float(v) for y, m, s, v in f[["year", "month", "satellite", "frp"]].itertuples(index=False)}
    c = cal[region_id]
    for r in rows:
        y, m = r["year"], r["month"]
        msat_raw, vsat_raw = r.get("_mraw"), r.get("_vraw")
        r["frp_raw_modis"] = round(fmap.get((y, m, msat_raw), 0.0), 1) if msat_raw else None
        r["frp_raw_viirs"] = round(fmap.get((y, m, vsat_raw), 0.0), 1) if vsat_raw else None
        if r["harmonized"] is None:
            r["frp_harmonized"] = None
            continue
        w = r["w"]
        val = 0.0
        if r["_msat"]:
            fm = fmap.get((y, m, r["_msat"]), 0.0)
            if r["_msat"] == TERRA:
                fm /= c["terra_over_aqua"]
            val += w * (c["alpha"] * fm ** c["beta"] if fm > 0 else 0.0)
        if r["_vsat"]:
            fv = fmap.get((y, m, r["_vsat"]), 0.0)
            if r["_vsat"] == NOAA20:
                fv /= c["noaa20_over_snpp"]
            val += (1 - w) * fv
        r["frp_harmonized"] = round(val, 1)


# ---------------------------------------------------------------------------
# HFAI z-score (REPORT_ALIGNMENT 3)
# ---------------------------------------------------------------------------

Z_EPS = 1e-5
MODIS_Z_YEARS = (2003, 2022)
VIIRS_Z_YEARS = (2012, 2025)


def z_class(z: float | None) -> str | None:
    if z is None:
        return None
    if z < -0.5:
        return "below"
    if z <= 1.0:
        return "normal"
    if z <= 2.0:
        return "moderate"
    return "critical"


def _baseline(rows: list[dict], key: str, years: tuple[int, int]) -> dict[int, tuple[float, float]]:
    vals: dict[int, list[float]] = {}
    for r in rows:
        v = r.get(key)
        if v is None or r.get("partial") or not (years[0] <= r["year"] <= years[1]):
            continue
        vals.setdefault(r["month"], []).append(float(np.log1p(v)))
    return {m: (float(np.mean(v)), float(np.std(v))) for m, v in vals.items() if len(v) >= 2}


def _z(v, base, month):
    if v is None or month not in base:
        return None
    mu, sd = base[month]
    return (float(np.log1p(v)) - mu) / (sd + Z_EPS)


def add_z(rows: list[dict]) -> None:
    """Add HFAI `z`, `z_class` (public) and `_z_harm` (harmonized-baseline z, private) to rows.

    Per-sensor z on log1p counts against each sensor's own baseline; HFAI = MODIS z, mean of both
    in the overlap, or VIIRS z. Partial months get null z (incomplete counts).
    """
    bm = _baseline(rows, "_nm", MODIS_Z_YEARS)
    bv = _baseline(rows, "_nv", VIIRS_Z_YEARS)
    bh = _baseline(rows, "harmonized", C.CLIMATOLOGY_YEARS)
    for r in rows:
        if r.get("harmonized") is None or r.get("partial"):
            r["z"], r["z_class"], r["_z_harm"] = None, None, None
            continue
        zs = [z for z in (_z(r.get("_nm"), bm, r["month"]), _z(r.get("_nv"), bv, r["month"])) if z is not None]
        z = float(np.mean(zs)) if zs else None
        r["z"] = None if z is None else round(z, 2)
        r["z_class"] = z_class(r["z"])
        r["_z_harm"] = _z(r["harmonized"], bh, r["month"])


def z_agreement(rows_by_region: dict[str, list[dict]], region_ids: list[str], years=(2012, 2022)) -> dict:
    a, b = [], []
    for rid in region_ids:
        for r in rows_by_region.get(rid, []):
            if years[0] <= r["year"] <= years[1] and r.get("z") is not None and r.get("_z_harm") is not None:
                a.append(r["z"])
                b.append(r["_z_harm"])
    if len(a) < 3 or np.std(a) == 0 or np.std(b) == 0:
        return {"r": None, "n": len(a)}
    return {"r": round(float(np.corrcoef(a, b)[0, 1]), 3), "n": len(a)}


# ---------------------------------------------------------------------------
# 4.7 Climatology
# ---------------------------------------------------------------------------


def climatology(rows: list[dict], years: tuple[int, int] = C.CLIMATOLOGY_YEARS) -> list[dict]:
    df = pd.DataFrame(rows)
    out = []
    for month in range(1, 13):
        if df.empty:
            vals = np.array([])
        else:
            sel = df[(df["month"] == month) & (df["year"] >= years[0]) & (df["year"] <= years[1]) & df["harmonized"].notna()]
            sel = sel[sel["partial"] != True]  # noqa: E712
            vals = sel["harmonized"].astype(float).to_numpy()
        if len(vals) == 0:
            out.append({"month": month, "median": None, "p10": None, "p90": None, "mean": None, "n_years": 0})
            continue
        out.append(
            {
                "month": month,
                "median": round(float(np.median(vals)), 2),
                "p10": round(float(np.percentile(vals, 10)), 2),
                "p90": round(float(np.percentile(vals, 90)), 2),
                "mean": round(float(np.mean(vals)), 2),
                "n_years": int(len(vals)),
            }
        )
    return out


# ---------------------------------------------------------------------------
# 4.6 Validation
# ---------------------------------------------------------------------------


def loyo_validation(
    counts: pd.DataFrame,
    coverage: pd.DataFrame,
    regions: pd.DataFrame,
    eval_region_ids: list[str],
    years: tuple[int, int] = C.K_YEARS,
    min_obs: int = 10,
) -> list[dict]:
    """Leave-one-year-out: refit gamma without year Y and predict S-NPP from Aqua in Y.

    raw = Aqua count used as-is (uncorrected); harmonized = gamma * Aqua. Evaluated over
    (region, month) pairs fully covered by both sensors with S-NPP >= min_obs cell-days.
    MAPE is a fraction (0.18 = 18 %).
    """
    valid = _full_months(coverage, [SNPP, AQUA])
    c = counts[counts["region_id"].isin(eval_region_ids) & counts["satellite"].isin([SNPP, AQUA])]
    wide = (
        c.pivot_table(index=["region_id", "year", "month", "daynight"], columns="satellite", values="n", aggfunc="sum", fill_value=0)
        .reindex(columns=[SNPP, AQUA], fill_value=0)
        .reset_index()
    )
    out = []
    for year in range(years[0], years[1] + 1):
        f = calibrate(counts, coverage, regions, SNPP, AQUA, years, exclude_year=year)
        w = wide[wide["year"] == year]
        w = w[[(year, m) in valid for m in w["month"]]]
        if w.empty:
            continue
        g_ = np.array([f.lookup(r, m, dn)[0] for r, m, dn in zip(w["region_id"], w["month"], w["daynight"])])
        w = w.assign(pred=w[AQUA] * g_)
        g = w.groupby(["region_id", "month"], as_index=False)[[SNPP, AQUA, "pred"]].sum()
        g = g[g[SNPP] >= min_obs]
        if len(g) < 2:
            continue
        obs = g[SNPP].to_numpy(float)
        pred = g["pred"].to_numpy(float)
        mape_raw = float(np.mean(np.abs(g[AQUA].to_numpy(float) - obs) / obs))
        mape_h = float(np.mean(np.abs(pred - obs) / obs))
        r = float(np.corrcoef(pred, obs)[0, 1]) if np.std(obs) > 0 and np.std(pred) > 0 else None
        out.append({"year": year, "mape_raw": round(mape_raw, 3), "mape_harmonized": round(mape_h, 3), "r": None if r is None else round(r, 3), "n": int(len(g))})
    return out


def seam_ratio(rows: list[dict], before: tuple[int, int] = C.SEAM_BEFORE, after: tuple[int, int] = C.SEAM_AFTER) -> dict | None:
    """Mean annual total in `after` / mean annual total in `before`, raw vs harmonized.

    Raw = the naive merged record (MODIS count before VIIRS joins, VIIRS count after).
    aqua_ratio is the Aqua-only reference change.
    """
    df = pd.DataFrame(rows)
    if df.empty or "_raw_source" not in df:
        return None
    df = df[df["harmonized"].notna()]

    def mean_annual(col, yrs):
        sel = df[(df["year"] >= yrs[0]) & (df["year"] <= yrs[1])]
        if sel.empty:
            return None
        return sel.groupby("year")[col].sum(min_count=1).mean()

    def ratio(col):
        b, a = mean_annual(col, before), mean_annual(col, after)
        if b is None or a is None or pd.isna(b) or pd.isna(a) or b == 0:
            return None
        return round(float(a / b), 3)

    return {"raw_ratio": ratio("_raw_source"), "harmonized_ratio": ratio("harmonized"), "aqua_ratio": ratio("raw_aqua")}
