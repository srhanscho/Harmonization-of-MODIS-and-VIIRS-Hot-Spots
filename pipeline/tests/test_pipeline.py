"""Tests on hand-written TEST-ONLY fixtures. Nothing here is ever written to web/public/data."""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import polars as pl
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import fsi as F  # noqa: E402
import harmonize as H  # noqa: E402
from config import AQUA, NOAA20, SNPP, TERRA  # noqa: E402
from download_firms import plan_chunks  # noqa: E402
from firms_io import drop_nrt_overlap, read_firms_csv, read_many  # noqa: E402

FIX = Path(__file__).parent / "fixtures"
MODIS_CSV = FIX / "fixture_modis_TEST_ONLY.csv"
VIIRS_CSV = FIX / "fixture_viirs_TEST_ONLY.csv"

REGIONS = pd.DataFrame(
    {"id": ["XX-A", "XX-B", "XX"], "country": ["XX", "XX", "XX"], "type": ["admin1", "admin1", "country"]}
)


# ---------------------------------------------------------------- reading + cleaning


def test_reader_normalizes_satellite_codes():
    m = read_firms_csv(MODIS_CSV)
    v = read_firms_csv(VIIRS_CSV)
    assert set(m["satellite"]) == {TERRA, AQUA}  # 'Terra', 'Aqua' and 'A'
    assert set(v["satellite"]) == {SNPP, NOAA20}  # 'N', 'N20', '1'; NOAA-21 dropped
    assert v.height == 4
    assert m["type"].null_count() == 0


def test_cleaning_rules():
    clean = H.clean_detections(read_many([MODIS_CSV, VIIRS_CSV]))
    # MODIS: conf 20 dropped, type 2 dropped, conf 30 kept -> 5 of 7 rows
    assert clean.filter(pl.col("satellite").is_in([TERRA, AQUA])).height == 5
    # VIIRS: 'l' dropped -> n, h, nominal kept
    assert clean.filter(pl.col("satellite").is_in([SNPP, NOAA20])).height == 3
    assert set(clean["daynight"]) <= {"D", "N"}


def test_missing_type_is_kept():
    df = read_firms_csv(VIIRS_CSV).with_columns(pl.lit(None, pl.Int64).alias("type"))
    assert H.clean_detections(df).height == 3


def test_static_source_rule():
    base = date(2015, 1, 1)
    rows = [(5.005, -70.005, base + timedelta(days=i)) for i in range(50)]  # static: 50 distinct days
    rows += [(6.005, -71.005, base + timedelta(days=i)) for i in range(49)]  # 49 days: kept
    df = pl.DataFrame(
        {
            "latitude": [r[0] for r in rows],
            "longitude": [r[1] for r in rows],
            "acq_date": [r[2] for r in rows],
            "daynight": ["D"] * len(rows),
            "satellite": [AQUA] * len(rows),
            "instrument": ["MODIS"] * len(rows),
            "confidence": ["80"] * len(rows),
            "type": [0] * len(rows),
            "product": ["SP"] * len(rows),
            "frp": [1.0] * len(rows),
        }
    )
    clean = H.clean_detections(df)
    assert clean.height == 49
    assert set(clean["cell_lat"].to_list()) == {600}


def test_cell_day_uniqueness():
    cd = H.to_cell_days(H.clean_detections(read_many([MODIS_CSV, VIIRS_CSV])))
    keys = cd.select(["cell_lat", "cell_lon", "acq_date", "daynight", "satellite"])
    assert keys.height == keys.unique().height
    # 2014-03-01 cell (425, -6946): Terra D (2 detections -> 1), Terra N, Aqua D, S-NPP D
    day = cd.filter((pl.col("cell_lat") == 425) & (pl.col("cell_lon") == -6946) & (pl.col("acq_date") == date(2014, 3, 1)))
    assert day.height == 4
    assert day.filter(pl.col("satellite") == TERRA).height == 2


def test_nrt_used_only_after_sp():
    df = pl.DataFrame(
        {
            "satellite": [SNPP] * 3,
            "acq_date": [date(2026, 1, 1), date(2026, 1, 1), date(2026, 2, 1)],
            "product": ["SP", "NRT", "NRT"],
        }
    )
    out = drop_nrt_overlap(df)
    assert out.height == 2
    assert out.filter(pl.col("product") == "NRT")["acq_date"].to_list() == [date(2026, 2, 1)]


def test_plan_chunks_sp_then_nrt():
    chunks = plan_chunks(
        date(2026, 1, 1), date(2026, 1, 12),
        [("X_SP", date(2000, 1, 1), date(2026, 1, 7)), ("X_NRT", date(2025, 12, 1), date(2026, 1, 31))],
    )
    assert chunks == [("X_SP", date(2026, 1, 1), 5), ("X_SP", date(2026, 1, 6), 2), ("X_NRT", date(2026, 1, 8), 5)]
    assert all(1 <= n <= 5 for _, _, n in chunks)


# ---------------------------------------------------------------- calibration


def make_counts(spec: dict, years, months=range(1, 13), regions=("XX-A",), dns=("D", "N")) -> pd.DataFrame:
    """spec: satellite -> function(region, year, month, dn) -> cell-day count."""
    rows = []
    for rid in regions:
        for y in years:
            for m in months:
                for dn in dns:
                    for sat, fn in spec.items():
                        n = fn(rid, y, m, dn)
                        if n:
                            rows.append((rid, y, m, dn, sat, n))
    df = pd.DataFrame(rows, columns=["region_id", "year", "month", "daynight", "satellite", "n"])
    # country region = sum of admin-1 regions
    country = df.groupby(["year", "month", "daynight", "satellite"], as_index=False)["n"].sum().assign(region_id="XX")
    return pd.concat([df, country], ignore_index=True)


FULL = H.coverage_from_ranges(
    {TERRA: (date(2000, 11, 1), date(2026, 10, 31)), AQUA: (date(2002, 7, 1), date(2026, 10, 31)),
     SNPP: (date(2012, 1, 1), date(2026, 10, 31)), NOAA20: (date(2018, 1, 1), date(2026, 10, 31))}
)


def test_k_is_ratio_of_sums():
    counts = make_counts({AQUA: lambda r, y, m, dn: 100, SNPP: lambda r, y, m, dn: 300}, range(2012, 2020), regions=("XX-A", "XX-B"))
    k = H.calibrate(counts, FULL, REGIONS, SNPP, AQUA, (2012, 2019))
    val, p5, p95 = k.lookup("XX-A", 3, "D")
    assert val == pytest.approx(3.0)
    assert p5 == pytest.approx(3.0) and p95 == pytest.approx(3.0)
    assert k.table.loc[("XX-A", 3, "D"), "level"] == "region_month"


def test_k_ignores_years_outside_overlap():
    counts = make_counts(
        {AQUA: lambda r, y, m, dn: 100, SNPP: lambda r, y, m, dn: 300 if y <= 2019 else 900}, range(2012, 2024)
    )
    k = H.calibrate(counts, FULL, REGIONS, SNPP, AQUA, (2012, 2019))
    assert k.lookup("XX-A", 6, "N")[0] == pytest.approx(3.0)


def test_k_shrinkage_fallback():
    # XX-B: only 1 Aqua cell-day per month/dn (< 30 per stratum over 8 years = 8), but annual
    # sum per dn = 96 >= 30 -> region_annual. XX-A has none in January -> falls back.
    def aqua(r, y, m, dn):
        if r == "XX-B":
            return 1
        return 0 if m == 1 else 50

    def snpp(r, y, m, dn):
        if r == "XX-B":
            return 5
        return 0 if m == 1 else 100

    counts = make_counts({AQUA: aqua, SNPP: snpp}, range(2012, 2020), regions=("XX-A", "XX-B"))
    k = H.calibrate(counts, FULL, REGIONS, SNPP, AQUA, (2012, 2019))
    assert k.table.loc[("XX-B", 7, "D"), "level"] == "region_annual"
    assert k.lookup("XX-B", 7, "D")[0] == pytest.approx(5.0)
    assert k.table.loc[("XX-A", 1, "D"), "level"] == "region_annual"
    assert k.lookup("XX-A", 1, "D")[0] == pytest.approx(2.0)
    assert k.table.loc[("XX-A", 7, "D"), "level"] == "region_month"


def test_k_country_fallback_when_region_has_no_fire():
    counts = make_counts({AQUA: lambda r, y, m, dn: 40 if r == "XX-A" else 0, SNPP: lambda r, y, m, dn: 160 if r == "XX-A" else 0},
                         range(2012, 2020), regions=("XX-A", "XX-B"))
    k = H.calibrate(counts, FULL, REGIONS, SNPP, AQUA, (2012, 2019))
    assert k.table.loc[("XX-B", 5, "D"), "level"] == "country_month"
    assert k.lookup("XX-B", 5, "D")[0] == pytest.approx(4.0)


def test_uncertainty_from_annual_ratio_spread():
    counts = make_counts({AQUA: lambda r, y, m, dn: 100, SNPP: lambda r, y, m, dn: 200 if y % 2 else 400}, range(2012, 2020))
    k, p5, p95 = H.calibrate(counts, FULL, REGIONS, SNPP, AQUA, (2012, 2019)).lookup("XX-A", 4, "D")
    assert k == pytest.approx(3.0)
    assert p5 < k < p95
    assert p5 == pytest.approx(2.0) and p95 == pytest.approx(4.0)


# ---------------------------------------------------------------- harmonized series


def factors(counts, cov):
    k = H.calibrate(counts, cov, REGIONS, SNPP, AQUA, (2012, 2019))
    k2 = H.calibrate(counts, cov, REGIONS, NOAA20, SNPP, (2018, 2026))
    kt = H.calibrate(counts, cov, REGIONS, TERRA, AQUA, (2003, 2008))
    return k, k2, kt


def test_null_for_months_without_sensor():
    cov = H.coverage_from_ranges({AQUA: (date(2010, 1, 1), date(2010, 6, 30)), TERRA: (date(2010, 1, 1), date(2010, 6, 30))})
    counts = make_counts({AQUA: lambda r, y, m, dn: 0}, [2010])  # zero fires while observed
    k, k2, kt = factors(counts, cov)
    rows = H.harmonize_region("XX-A", counts, cov, k, k2, kt, first=(2009, 11), last=(2010, 8))
    by = {(r["year"], r["month"]): r for r in rows}
    for ym in [(2009, 11), (2009, 12), (2010, 7), (2010, 8)]:
        assert by[ym]["harmonized"] is None and by[ym]["raw_modis"] is None and by[ym]["source"] is None
    for m in range(1, 7):
        assert by[(2010, m)]["harmonized"] == 0  # observed zero, not null
        assert by[(2010, m)]["raw_viirs"] is None  # VIIRS not active
        assert by[(2010, m)]["regime"] == "R2"


def test_source_and_regime_selection():
    # gamma = S-NPP/Aqua = 4, kt = Terra/Aqua = 1.2, k2 = NOAA-20/S-NPP = 1.1
    counts = make_counts(
        {TERRA: lambda r, y, m, dn: 60, AQUA: lambda r, y, m, dn: 50, SNPP: lambda r, y, m, dn: 200, NOAA20: lambda r, y, m, dn: 220},
        range(2001, 2027),
    )
    cov = H.coverage_from_ranges(
        {TERRA: (date(2001, 1, 1), date(2026, 12, 31)), AQUA: (date(2002, 7, 4), date(2026, 12, 31)),
         SNPP: (date(2012, 1, 20), date(2026, 11, 2)), NOAA20: (date(2018, 1, 1), date(2026, 12, 31))}
    )
    k, k2, kt = factors(counts, cov)
    rows = {(r["year"], r["month"]): r for r in H.harmonize_region("XX-A", counts, cov, k, k2, kt, first=(2001, 1), last=(2026, 12))}
    r = rows[(2001, 5)]
    assert r["source"] == "MODIS_TERRA" and r["regime"] == "R1" and r["w"] == 1.0
    assert r["harmonized"] == pytest.approx(400.0)  # 4 * (120 / 1.2)
    assert rows[(2002, 7)]["source"] == "MODIS_TERRA" and rows[(2002, 7)]["regime"] == "R2"  # Aqua starts Jul 4
    assert rows[(2002, 8)]["source"] == "MODIS_AQUA" and rows[(2002, 8)]["harmonized"] == pytest.approx(400.0)
    assert rows[(2012, 1)]["source"] == "MODIS_AQUA"  # S-NPP covers only part of Jan 2012
    assert rows[(2012, 1)]["regime"] == "R3"
    r = rows[(2012, 2)]
    assert r["source"] == "MODIS_AQUA+VIIRS_SNPP" and r["w"] == 0.5
    assert r["harmonized"] == pytest.approx(400.0)  # 0.5 * 4 * 100 + 0.5 * 400
    assert r["factor"] == pytest.approx(4.0)
    assert rows[(2026, 12)]["source"] == "MODIS_AQUA+VIIRS_NOAA20"  # after S-NPP end
    assert rows[(2026, 12)]["harmonized"] == pytest.approx(400.0)  # 0.5*400 + 0.5*440/1.1


def test_gamma_blend_and_viirs_only():
    # Aqua 100/dn; S-NPP 300/dn (gamma 3). In 2016 fire doubles in VIIRS only -> blend is halfway.
    counts = make_counts(
        {AQUA: lambda r, y, m, dn: 100 if y <= 2016 else 0, SNPP: lambda r, y, m, dn: 600 if y == 2016 else 300},
        range(2010, 2018),
    )
    cov = H.coverage_from_ranges({AQUA: (date(2010, 1, 1), date(2016, 12, 31)), SNPP: (date(2012, 1, 1), date(2017, 12, 31))})
    k = H.calibrate(counts, cov, REGIONS, SNPP, AQUA, (2012, 2015))
    k2 = H.calibrate(counts, cov, REGIONS, NOAA20, SNPP, (2018, 2026))
    kt = H.calibrate(counts, cov, REGIONS, TERRA, AQUA, (2003, 2008))
    rows = {(r["year"], r["month"]): r for r in H.harmonize_region("XX-A", counts, cov, k, k2, kt, first=(2010, 1), last=(2017, 12))}
    assert rows[(2011, 6)]["harmonized"] == pytest.approx(600.0)  # gamma * Aqua = 3 * 200
    assert rows[(2011, 6)]["harmonized_p5"] == pytest.approx(600.0)  # no spread in gamma
    assert rows[(2016, 6)]["harmonized"] == pytest.approx(0.5 * 600 + 0.5 * 1200)
    r = rows[(2017, 6)]  # MODIS ended -> VIIRS only
    assert r["source"] == "VIIRS_SNPP" and r["w"] == 0.0 and r["harmonized"] == pytest.approx(600.0)
    assert r["raw_modis"] is None


def test_viirs_satellites_are_never_summed():
    counts = make_counts({SNPP: lambda r, y, m, dn: 100, NOAA20: lambda r, y, m, dn: 120}, range(2019, 2021))
    cov = H.coverage_from_ranges({SNPP: (date(2019, 1, 1), date(2020, 12, 31)), NOAA20: (date(2019, 1, 1), date(2020, 12, 31))})
    k, k2, kt = factors(counts, cov)
    rows = H.harmonize_region("XX-A", counts, cov, k, k2, kt, first=(2019, 1), last=(2020, 12))
    for r in rows:
        assert r["source"] == "VIIRS_SNPP"
        assert r["harmonized"] == pytest.approx(200.0)  # S-NPP only, not 200 + 240
        assert r["raw_viirs"] == 200 and r["raw_noaa20"] == 240


def test_seam_ratio_shrinks_after_harmonization():
    # Fire constant in reality; VIIRS sees 4x the Aqua cell-days.
    counts = make_counts(
        {AQUA: lambda r, y, m, dn: 50 + (m % 3) * 10, SNPP: lambda r, y, m, dn: 4 * (50 + (m % 3) * 10) if y >= 2012 else 0},
        range(2003, 2020),
    )
    cov = H.coverage_from_ranges({AQUA: (date(2003, 1, 1), date(2019, 12, 31)), SNPP: (date(2012, 1, 1), date(2019, 12, 31))})
    k, k2, kt = factors(counts, cov)
    rows = H.harmonize_region("XX-A", counts, cov, k, k2, kt, first=(2003, 1), last=(2019, 12))
    seam = H.seam_ratio(rows)
    assert seam["raw_ratio"] == pytest.approx(4.0)
    assert seam["harmonized_ratio"] == pytest.approx(1.0, abs=0.02)
    assert abs(seam["harmonized_ratio"] - 1) < abs(seam["raw_ratio"] - 1)


def test_loyo_harmonized_beats_raw():
    counts = make_counts(
        {AQUA: lambda r, y, m, dn: 40 + m * 3 + (y % 4), SNPP: lambda r, y, m, dn: 3 * (40 + m * 3 + (y % 4)) + (y % 3)},
        range(2012, 2020), regions=("XX-A", "XX-B"),
    )
    res = H.loyo_validation(counts, FULL, REGIONS, ["XX-A", "XX-B"])
    assert [r["year"] for r in res] == list(range(2012, 2020))
    for r in res:
        assert r["mape_harmonized"] < r["mape_raw"]
        assert r["mape_raw"] == pytest.approx(2 / 3, abs=0.02)  # |A - 3A| / 3A


# ---------------------------------------------------------------- FRP power law


def test_frp_power_law_fit_recovers_parameters():
    x = np.linspace(10, 5000, 40)
    fit = H.fit_power_law(x, 2.0 * x**0.9)
    assert fit is not None
    alpha, beta, r2, n = fit
    assert alpha == pytest.approx(2.0, rel=1e-6) and beta == pytest.approx(0.9, rel=1e-6)
    assert r2 == pytest.approx(1.0) and n == 40
    assert H.fit_power_law(np.array([0.0, 0.0, 5.0]), np.array([1.0, 2.0, 3.0])) is None  # needs >= 3 positive pairs


def test_frp_calibration_and_country_fallback():
    rows = []
    for y in range(2012, 2020):
        for m in range(1, 13):
            a = 100.0 + 37 * m + 11 * y % 7 * 10
            rows += [("XX-A", y, m, AQUA, a), ("XX-A", y, m, SNPP, 3.0 * a**0.8)]
            rows += [("XX", y, m, AQUA, a), ("XX", y, m, SNPP, 3.0 * a**0.8)]
            if y == 2012 and m <= 10:  # XX-B: only 10 paired months -> country fit
                rows += [("XX-B", y, m, AQUA, a), ("XX-B", y, m, SNPP, 9.0 * a)]
    frp = pd.DataFrame(rows, columns=["region_id", "year", "month", "satellite", "frp"])
    cal = H.calibrate_frp(frp, FULL, REGIONS)
    assert cal["XX-A"]["level"] == "region"
    assert cal["XX-A"]["alpha"] == pytest.approx(3.0, rel=1e-3) and cal["XX-A"]["beta"] == pytest.approx(0.8, rel=1e-3)
    assert cal["XX-B"]["level"] == "country" and cal["XX-B"]["beta"] == pytest.approx(0.8, rel=1e-3)
    # harmonized FRP for a MODIS-only month = alpha * FRP_MODIS ** beta
    counts = make_counts({AQUA: lambda r, y, m, dn: 10}, [2010])
    cov = H.coverage_from_ranges({AQUA: (date(2010, 1, 1), date(2010, 12, 31))})
    k, k2, kt = factors(counts, cov)
    hrows = H.harmonize_region("XX-A", counts, cov, k, k2, kt, first=(2010, 1), last=(2010, 1))
    H.add_frp(hrows, "XX-A", pd.DataFrame([("XX-A", 2010, 1, AQUA, 500.0)], columns=frp.columns), cal)
    assert hrows[0]["frp_raw_modis"] == 500.0 and hrows[0]["frp_raw_viirs"] is None
    assert hrows[0]["frp_harmonized"] == pytest.approx(round(3.0 * 500**0.8, 1), rel=1e-3)


# ---------------------------------------------------------------- HFAI z


def test_z_class_thresholds():
    assert H.z_class(None) is None
    assert H.z_class(-0.51) == "below"
    assert H.z_class(-0.5) == "normal" and H.z_class(1.0) == "normal"
    assert H.z_class(1.01) == "moderate" and H.z_class(2.0) == "moderate"
    assert H.z_class(2.01) == "critical"


def test_hfai_z_per_sensor_and_partial_null():
    rows = []
    for y in range(2003, 2026):
        nm = 100.0 + (y % 3)  # MODIS on the Aqua scale
        nv = 400.0 + (y % 3) * 4 if y >= 2012 else None
        rows.append({"year": y, "month": 7, "harmonized": 1.0, "partial": False, "_nm": nm, "_nv": nv})
    rows.append({"year": 2026, "month": 7, "harmonized": 1.0, "partial": False, "_nm": 1000.0, "_nv": 4000.0})  # spike
    rows.append({"year": 2026, "month": 8, "harmonized": 1.0, "partial": True, "_nm": 5.0, "_nv": 20.0})
    H.add_z(rows)
    by = {(r["year"], r["month"]): r for r in rows}
    assert by[(2026, 7)]["z_class"] == "critical" and by[(2026, 7)]["z"] > 2
    assert by[(2026, 8)]["z"] is None and by[(2026, 8)]["z_class"] is None
    assert by[(2005, 7)]["z_class"] in {"below", "normal", "moderate"}  # MODIS-only z
    assert abs(by[(2005, 7)]["z"]) < 2


# ---------------------------------------------------------------- FSI


def test_fsi_normalization_and_clusters():
    assert list(F.minmax_100(np.array([2.0, 4.0, 6.0]))) == [0.0, 50.0, 100.0]
    assert list(F.minmax_100(np.array([3.0, 3.0]))) == [100.0, 100.0]
    assert list(F.minmax_100(np.array([0.0, 0.0]))) == [0.0, 0.0]
    s = F.fsi_scores(np.array([1.0, 10.0, 1000.0]), np.array([1, 2, 5]), np.array([1, 1, 3]))
    assert s.max() == pytest.approx(100.0) and s.min() == pytest.approx(0.0)
    assert all(0 <= v <= 100 for v in s)
    comps = F.clusters_8n({(0, 0), (1, 1), (5, 5)})  # diagonal neighbours join
    assert sorted(len(c) for c in comps) == [1, 2]
    assert F.longest_run([date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 4)]) == 2

    det = pd.DataFrame(
        {
            "c10_lat": [10, 10, 11, 50],
            "c10_lon": [20, 21, 21, 80],
            "acq_date": [date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 3), date(2026, 1, 1)],
            "frp": [100.0, 50.0, 25.0, 1.0],
            "region_id": ["XX-A", "XX-A", "XX-B", "XX-B"],
        }
    )
    ranked = F.rank_month(det, {"XX-A": "Alpha", "XX-B": "Beta"})
    assert isinstance(ranked, list)
    assert [r["rank"] for r in ranked] == [1, 2]
    top = ranked[0]
    assert top["fsi"] == pytest.approx(100.0) and top["cells"] == 3 and top["days"] == 3
    assert top["admin1_name"] == "Alpha" and top["frp_mw"] == pytest.approx(175.0)
    assert top["bbox"] == [2.0, 1.0, 2.2, 1.2]


def test_climatology_counts_years_and_skips_nulls():
    rows = [{"year": y, "month": 3, "harmonized": float(y - 2000), "partial": False} for y in range(2003, 2023)]
    rows.append({"year": 2023, "month": 3, "harmonized": 999.0, "partial": False})  # outside baseline
    rows.append({"year": 2003, "month": 4, "harmonized": None, "partial": None})
    clim = {c["month"]: c for c in H.climatology(rows)}
    assert clim[3]["n_years"] == 20
    assert clim[3]["median"] == pytest.approx(12.5)
    assert clim[4]["n_years"] == 0 and clim[4]["median"] is None


# ---------------------------------------------------------------- NRT format variants

NRT = Path(__file__).parent / "fixtures_nrt"


def test_nrt_formats_without_type_and_instrument_columns():
    m = read_firms_csv(NRT / "nrt_modis_TEST_ONLY.csv")
    v = read_firms_csv(NRT / "nrt_noaa20_TEST_ONLY.csv")
    assert set(m["satellite"]) == {TERRA, AQUA} and set(m["instrument"]) == {"MODIS"}
    assert set(v["satellite"]) == {NOAA20, SNPP} and set(v["instrument"]) == {"VIIRS"}  # N21 dropped
    assert set(m["product"]) == {"NRT"} and set(v["product"]) == {"NRT"}
    assert m["type"].null_count() == m.height  # no `type` column -> null
    clean = H.clean_detections(pl.concat([m, v]))
    # MODIS: conf 25 dropped -> 2 kept; VIIRS: 'low' dropped, 'nominal', 'high', 'h' kept
    assert clean.filter(pl.col("instrument") == "MODIS").height == 2
    assert clean.filter(pl.col("instrument") == "VIIRS").height == 3


def test_static_rule_applies_when_type_missing():
    base = date(2026, 1, 1)
    df = pl.DataFrame(
        {
            "latitude": [5.005] * 60,
            "longitude": [-70.005] * 60,
            "acq_date": [base + timedelta(days=i) for i in range(60)],
            "daynight": ["N"] * 60,
            "satellite": [NOAA20] * 60,
            "instrument": ["VIIRS"] * 60,
            "confidence": ["nominal"] * 60,
            "type": pl.Series([None] * 60, dtype=pl.Int64),
            "product": ["NRT"] * 60,
            "frp": [1.0] * 60,
        }
    )
    assert H.clean_detections(df).height == 0


# ---------------------------------------------------------------- ENSO / ONI


def test_oni_parsing_and_phase():
    import climate as CL

    text = " SEAS  YR   TOTAL   ANOM\n  DJF 2015  27.0   0.55\n  NDJ 2015  28.9   2.64\n  JFM 2016  28.0  -0.50\n"
    oni = CL.parse_cpc(text)
    assert oni == {(2015, 1): 0.55, (2015, 12): 2.64, (2016, 2): -0.5}
    assert [CL.phase(v) for v in (0.5, 0.49, -0.5)] == ["el_nino", "neutral", "la_nina"]


def test_enso_link_finds_lag():
    import climate as CL

    rng = np.random.default_rng(0)
    oni = {}
    for i in range(300):
        y, m = 2000 + i // 12, i % 12 + 1
        oni[(y, m)] = float(np.sin(i / 7.0) * 1.5 + rng.normal(0, 0.1))
    rows = []
    for i in range(3, 300):
        y, m = 2000 + i // 12, i % 12 + 1
        src = CL._shift(y, m, 3)
        rows.append({"year": y, "month": m, "z": oni[src] + float(rng.normal(0, 0.05))})
    res = CL.enso_link(rows, oni)
    assert res["best_lag"] == 3 and res["r"] > 0.95
    assert res["mean_z_el_nino"] > res["mean_z_neutral"] > res["mean_z_la_nina"]


# ---------------------------------------------------------------- wind


def test_wind_uv_and_tiles():
    import wind as WD

    u, v = WD.to_uv(np.array([10.0, 10.0]), np.array([0.0, 270.0]))  # from north, from west
    assert u[0] == pytest.approx(0, abs=1e-9) and v[0] == pytest.approx(-10)
    assert u[1] == pytest.approx(10) and v[1] == pytest.approx(0, abs=1e-9)
    assert WD.dir_from(0.0, -10.0) == pytest.approx(0.0) and WD.dir_from(10.0, 0.0) == pytest.approx(270.0)
    t = WD.tiles([-73.6, -55.2, -53.5, -21.7])
    assert all(e - w <= 10 and n - s <= 10 for w, s, e, n in t) and len(t) == 12


# ---------------------------------------------------------------- pixel footprints


def test_pixel_rows_keep_modis_and_subsample_viirs():
    import pixels as PX

    n_v = 30
    df = pd.DataFrame(
        {
            "longitude": [-69.123456] * (5 + n_v),
            "latitude": [4.987654] * (5 + n_v),
            "satellite": [AQUA] * 5 + [SNPP] * n_v,
            "acq_date": [date(2026, 7, 1)] * (5 + n_v),
            "daynight": ["D"] * (5 + n_v),
            "scan": [1.2] * 5 + [0.39] * n_v,
            "track": [1.1] * 5 + [0.36] * n_v,
            "frp": [12.345] * (5 + n_v),
            "confidence": ["80"] * 5 + ["n"] * n_v,
        }
    )
    rows, sub = PX.month_rows(df, max_n=10)
    assert sub and len(rows) == 10
    assert sum(r["sensor"] == "MODIS" for r in rows) == 5
    r = rows[0]
    assert r["lon"] == -69.1235 and r["lat"] == 4.9877 and r["frp"] == 12.3
    assert r["date"] == "2026-07-01"
    assert set(r) == {"lon", "lat", "sensor", "sat", "date", "dn", "scan_km", "track_km", "frp", "conf"}
    rows, sub = PX.month_rows(df, max_n=100)
    assert not sub and len(rows) == 35 and {x["sat"] for x in rows} == {"A", "N"}
