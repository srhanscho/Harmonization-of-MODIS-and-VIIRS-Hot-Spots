"""Shared configuration: paths, country bounding boxes, demo regions, method constants."""

from __future__ import annotations

from datetime import date
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
APP_DIR = PIPELINE_DIR.parent
DATA_DIR = PIPELINE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
INTERIM_DIR = DATA_DIR / "interim"
BOUNDARIES_DIR = RAW_DIR / "boundaries"
WEB_DATA_DIR = APP_DIR / "web" / "public" / "data"

PIPELINE_VERSION = "0.1.0"

# Country bounding boxes as [west, south, east, north] (FIRMS area API order).
# Colombia includes the San Andres archipelago.
COUNTRY_BBOXES: dict[str, list[float]] = {
    "CO": [-82.0, -4.3, -66.8, 13.6],
    "AR": [-73.6, -55.2, -53.5, -21.7],
}

COUNTRY_NAMES = {"CO": "Colombia", "AR": "Argentina"}


def _box_around(lat: float, lon: float, half_km: float) -> list[float]:
    """Return [west, south, east, north] of a square box of side 2*half_km centred on (lat, lon)."""
    import math

    dlat = half_km / 111.32
    dlon = half_km / (111.32 * math.cos(math.radians(lat)))
    return [round(lon - dlon, 4), round(lat - dlat, 4), round(lon + dlon, 4), round(lat + dlat, 4)]


# Demo regions are axis-aligned boxes (not administrative units).
DEMO_REGIONS: list[dict] = [
    {
        "id": "DEMO-CHILECITO",
        "name": "Chilecito (La Rioja) - 60 km box",
        "country": "AR",
        "bbox": _box_around(-29.16, -67.50, 30.0),
    },
    {
        "id": "DEMO-SNSM",
        "name": "Sierra Nevada de Santa Marta",
        "country": "CO",
        "bbox": [-74.3, 10.5, -73.0, 11.4],
    },
]

# Satellite canonical names used throughout the pipeline.
TERRA, AQUA, SNPP, NOAA20 = "Terra", "Aqua", "S-NPP", "NOAA-20"
SATELLITES = [TERRA, AQUA, SNPP, NOAA20]
MODIS_SATS = {TERRA, AQUA}
VIIRS_SATS = {SNPP, NOAA20}

# Mission windows (inclusive) used to clip data-driven coverage.
# S-NPP stopped delivering new data to FIRMS on 2026-11-02.
MISSION_WINDOWS: dict[str, tuple[date, date | None]] = {
    TERRA: (date(2000, 11, 1), None),
    AQUA: (date(2002, 7, 4), None),
    SNPP: (date(2012, 1, 20), date(2026, 11, 2)),
    NOAA20: (date(2018, 1, 1), None),
}

# Method constants (spec section 4).
MODIS_MIN_CONFIDENCE = 30
VIIRS_KEEP_CONFIDENCE = {"n", "h"}
STATIC_MIN_DAYS = 50  # drop 0.01 deg cells with detections on >= this many distinct days in a year
MIN_DEN_CELL_DAYS = 30  # shrinkage threshold on the denominator sensor
K_YEARS = (2012, 2019)  # S-NPP / Aqua overlap used for k
K2_YEARS = (2018, 2026)  # NOAA-20 / S-NPP overlap used for k2 (only fully covered months count)
TERRA_YEARS = (2003, 2008)  # Terra / Aqua ratio used for Nov 2000 - Jun 2002
CLIMATOLOGY_YEARS = (2003, 2022)
SEAM_BEFORE = (2009, 2011)
SEAM_AFTER = (2012, 2014)
FIRST_MONTH = (2000, 11)

# Source priority for the harmonized series (higher priority first);
# the sensor with the most covered days in a month wins, ties broken by this order.
HARMONIZED_PRIORITY = [SNPP, NOAA20, AQUA, TERRA]
SOURCE_LABELS = {TERRA: "MODIS_TERRA", AQUA: "MODIS_AQUA", SNPP: "VIIRS_SNPP", NOAA20: "VIIRS_NOAA20"}
