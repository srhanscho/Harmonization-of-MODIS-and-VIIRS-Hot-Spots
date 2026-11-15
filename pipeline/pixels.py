"""Detection-level pixel footprints for selected regions (map view: one MODIS pixel vs several
VIIRS pixels). Uses FIRMS `scan` / `track` (pixel size in km along-scan / along-track).

pixels/{region_id}/{YYYY}-{MM}.json = [{lon, lat, sensor, sat, date, dn, scan_km, track_km, frp, conf}]
pixels/index.json = [{region_id, months: [...], subsampled: [...months]}]
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from config import AQUA, NOAA20, SNPP, TERRA

SAT_CODE = {TERRA: "T", AQUA: "A", SNPP: "N", NOAA20: "N20"}
PIXEL_REGIONS = ["CO-VID", "DEMO-SNSM", "DEMO-CHILECITO", "AR-F"]
EXTRA_MONTHS = [(2026, 7)]  # demo case: Chilecito, July 2026
MAX_PER_FILE = 1000


def month_rows(df: pd.DataFrame, max_n: int = MAX_PER_FILE, seed: int = 0) -> tuple[list[dict], bool]:
    """All MODIS detections plus a uniform VIIRS subsample when the month exceeds `max_n`."""
    subsampled = False
    if len(df) > max_n:
        modis = df[df["satellite"].isin([TERRA, AQUA])]
        viirs = df[~df.index.isin(modis.index)]
        keep = max(0, max_n - len(modis))
        if keep < len(viirs):
            viirs = viirs.sample(n=keep, random_state=seed) if keep else viirs.iloc[0:0]
            subsampled = True
        df = pd.concat([modis, viirs])
    df = df.sort_values(["acq_date", "satellite"])
    out = []
    for r in df.itertuples(index=False):
        out.append(
            {
                "lon": round(float(r.longitude), 4),
                "lat": round(float(r.latitude), 4),
                "sensor": "MODIS" if r.satellite in (TERRA, AQUA) else "VIIRS",
                "sat": SAT_CODE[r.satellite],
                "date": str(r.acq_date)[:10],
                "dn": r.daynight,
                "scan_km": None if r.scan is None or np.isnan(r.scan) else round(float(r.scan), 2),
                "track_km": None if r.track is None or np.isnan(r.track) else round(float(r.track), 2),
                "frp": None if r.frp is None or np.isnan(r.frp) else round(float(r.frp), 1),
                "conf": r.confidence,
            }
        )
    return out, subsampled
