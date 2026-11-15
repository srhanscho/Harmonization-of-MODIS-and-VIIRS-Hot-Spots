"""Read FIRMS active-fire CSVs (API downloads or Archive Download tool files) into one normalized table.

Normalized columns:
    latitude (f64), longitude (f64), acq_date (date, UTC), daynight ('D'/'N'),
    satellite (Terra | Aqua | S-NPP | NOAA-20), instrument ('MODIS'/'VIIRS'),
    confidence (str, raw value), type (i64, null when the file has no `type` column),
    product ('SP' | 'NRT'), frp (f64), scan / track (f64, pixel size in km)
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

import polars as pl

from config import AQUA, NOAA20, SNPP, TERRA

log = logging.getLogger(__name__)

# Observed / documented FIRMS satellite codes. MODIS: 'T'/'A' (NRT, API) or 'Terra'/'Aqua'
# (archive). VIIRS: 'N' (S-NPP), 'N20' (NOAA-20), 'N21' (NOAA-21). Some archive files of
# VJ114 use '1' (JPSS-1 = NOAA-20) and NOAA-21 '2'.
SATELLITE_CODES: dict[str, str | None] = {
    "T": TERRA, "TERRA": TERRA,
    "A": AQUA, "AQUA": AQUA,
    "N": SNPP, "NPP": SNPP, "SNPP": SNPP, "S-NPP": SNPP, "SUOMI NPP": SNPP, "SUOMI-NPP": SNPP,
    "N20": NOAA20, "1": NOAA20, "J1": NOAA20, "NOAA-20": NOAA20, "NOAA20": NOAA20, "JPSS-1": NOAA20,
    "N21": None, "2": None, "J2": None, "NOAA-21": None, "NOAA21": None,  # NOAA-21 not used
}

OUTPUT_SCHEMA = {
    "latitude": pl.Float64,
    "longitude": pl.Float64,
    "acq_date": pl.Date,
    "daynight": pl.Utf8,
    "satellite": pl.Utf8,
    "instrument": pl.Utf8,
    "confidence": pl.Utf8,
    "type": pl.Int64,
    "product": pl.Utf8,
    "frp": pl.Float64,
    "scan": pl.Float64,
    "track": pl.Float64,
}


def empty_frame() -> pl.DataFrame:
    return pl.DataFrame(schema=OUTPUT_SCHEMA)


def _hint_from_path(path: Path) -> tuple[str | None, str | None, str | None]:
    """Infer (instrument, satellite, product) hints from a file path / folder name.

    Handles API folders like VIIRS_SNPP_SP and archive names like fire_archive_SV-C2_123.csv,
    fire_nrt_J1V-C2_123.csv, fire_archive_M-C61_123.csv.
    """
    s = str(path).upper().replace("\\", "/")
    instrument = satellite = product = None
    if "MODIS" in s or re.search(r"_M-?C6", s):
        instrument = "MODIS"
    if "VIIRS" in s or re.search(r"_(SV|J1V|J2V)-C2", s):
        instrument = "VIIRS"
    if "NOAA20" in s or "J1V" in s:
        satellite = NOAA20
    elif "NOAA21" in s or "J2V" in s:
        satellite = "NOAA-21"
    elif "SNPP" in s or "_SV-" in s:
        satellite = SNPP
    if "_NRT" in s or "FIRE_NRT" in s:
        product = "NRT"
    elif "_SP" in s or "FIRE_ARCHIVE" in s:
        product = "SP"
    return instrument, satellite, product


def read_firms_csv(path: Path) -> pl.DataFrame:
    """Read one FIRMS CSV and return it in the normalized schema (possibly empty)."""
    try:
        df = pl.read_csv(path, infer_schema_length=0, ignore_errors=True)  # all columns as strings
    except pl.exceptions.NoDataError:
        return empty_frame()
    if df.height == 0 or "latitude" not in df.columns:
        return empty_frame()
    df = df.rename({c: c.strip().lower() for c in df.columns})

    inst_hint, sat_hint, prod_hint = _hint_from_path(path)
    if "instrument" in df.columns:
        instrument = pl.col("instrument").str.to_uppercase().str.strip_chars()
    elif "bright_ti4" in df.columns or inst_hint == "VIIRS":
        instrument = pl.lit("VIIRS")
    else:
        instrument = pl.lit("MODIS")

    if "satellite" in df.columns:
        sat_raw = pl.col("satellite").str.strip_chars().str.to_uppercase()
        satellite = sat_raw.replace_strict(SATELLITE_CODES, default="__unknown__", return_dtype=pl.Utf8)
    else:
        satellite = pl.lit(sat_hint or "__unknown__")

    if "version" in df.columns:
        product = (
            pl.when(pl.col("version").str.to_uppercase().str.contains("RT"))
            .then(pl.lit("NRT"))
            .otherwise(pl.lit("SP"))
        )
    else:
        product = pl.lit(prod_hint or "SP")

    type_expr = pl.col("type").cast(pl.Int64, strict=False) if "type" in df.columns else pl.lit(None, pl.Int64)
    frp_expr = pl.col("frp").cast(pl.Float64, strict=False) if "frp" in df.columns else pl.lit(None, pl.Float64)
    scan_expr = pl.col("scan").cast(pl.Float64, strict=False) if "scan" in df.columns else pl.lit(None, pl.Float64)
    track_expr = pl.col("track").cast(pl.Float64, strict=False) if "track" in df.columns else pl.lit(None, pl.Float64)

    out = df.select(
        pl.col("latitude").cast(pl.Float64, strict=False),
        pl.col("longitude").cast(pl.Float64, strict=False),
        pl.col("acq_date").str.strip_chars().str.slice(0, 10).str.to_date("%Y-%m-%d", strict=False),
        pl.col("daynight").str.strip_chars().str.to_uppercase(),
        satellite.alias("satellite"),
        instrument.alias("instrument"),
        pl.col("confidence").str.strip_chars().str.to_lowercase(),
        type_expr.alias("type"),
        product.alias("product"),
        frp_expr.alias("frp"),
        scan_expr.alias("scan"),
        track_expr.alias("track"),
    )

    unknown = out.filter(pl.col("satellite") == "__unknown__").height
    if unknown:
        if sat_hint:
            out = out.with_columns(
                pl.when(pl.col("satellite") == "__unknown__").then(pl.lit(sat_hint)).otherwise(pl.col("satellite")).alias("satellite")
            )
        else:
            log.warning("%s: %d rows with unrecognized satellite code dropped", path.name, unknown)
    out = out.filter(
        pl.col("satellite").is_in([TERRA, AQUA, SNPP, NOAA20])
        & pl.col("latitude").is_not_null()
        & pl.col("longitude").is_not_null()
        & pl.col("acq_date").is_not_null()
    )
    return out.cast(OUTPUT_SCHEMA)


def read_many(paths: list[Path]) -> pl.DataFrame:
    frames = [read_firms_csv(p) for p in paths]
    frames = [f for f in frames if f.height]
    if not frames:
        return empty_frame()
    return pl.concat(frames, how="vertical")


def drop_nrt_overlap(df: pl.DataFrame) -> pl.DataFrame:
    """Keep NRT rows only for dates after the last standard-product (SP) date of each satellite."""
    sp_max = df.filter(pl.col("product") == "SP").group_by("satellite").agg(pl.col("acq_date").max().alias("sp_max"))
    out = df.join(sp_max, on="satellite", how="left")
    out = out.filter((pl.col("product") == "SP") | pl.col("sp_max").is_null() | (pl.col("acq_date") > pl.col("sp_max")))
    return out.drop("sp_max")


def load_detections(raw_dir: Path | None = None, archive_dir: Path | None = None) -> pl.DataFrame:
    """Load every CSV under the API raw folder and/or an archive folder, normalized and NRT-deduplicated."""
    paths: list[Path] = []
    if raw_dir is not None and raw_dir.exists():
        paths += [p for p in raw_dir.rglob("*.csv") if "boundaries" not in p.parts]
    if archive_dir is not None:
        paths += sorted(archive_dir.rglob("*.csv"))
    log.info("Reading %d FIRMS CSV files", len(paths))
    df = read_many(paths)
    if df.height == 0:
        return df
    df = drop_nrt_overlap(df)
    # Identical detections can appear twice (overlapping downloads); they do not change
    # cell-day counts, but dropping them keeps memory down.
    return df.unique(subset=["latitude", "longitude", "acq_date", "daynight", "satellite"], maintain_order=False)
