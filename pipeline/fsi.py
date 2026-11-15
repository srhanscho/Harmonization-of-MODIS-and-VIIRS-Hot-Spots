"""Fire Severity Index (FSI) cluster ranking (REPORT_ALIGNMENT 4).

Contiguous active 0.1 deg cells (8-neighbour) in a month form a cluster C, scored as
    FSI(C) = 0.45 * FRP_norm + 0.35 * A_norm + 0.20 * D_norm
where each term is min-max normalized to 0-100 across the clusters of that country-month
(FRP on a log1p scale), A = number of cells, D = longest run of consecutive days with detections.
Composite index, 0-100. It is not burned area.
"""

from __future__ import annotations

from collections import Counter
from datetime import date

import numpy as np
import pandas as pd

W_FRP, W_AREA, W_DAYS = 0.45, 0.35, 0.20


def clusters_8n(cells: set[tuple[int, int]]) -> list[list[tuple[int, int]]]:
    """Connected components of grid cells (lat_idx, lon_idx) with 8-neighbour connectivity."""
    seen: set[tuple[int, int]] = set()
    out = []
    for start in cells:
        if start in seen:
            continue
        comp, stack = [], [start]
        seen.add(start)
        while stack:
            a, b = stack.pop()
            comp.append((a, b))
            for da in (-1, 0, 1):
                for db in (-1, 0, 1):
                    nb = (a + da, b + db)
                    if nb in cells and nb not in seen:
                        seen.add(nb)
                        stack.append(nb)
        out.append(comp)
    return out


def longest_run(days: list[date]) -> int:
    ds = sorted(set(days))
    best = run = 1 if ds else 0
    for prev, cur in zip(ds, ds[1:]):
        run = run + 1 if (cur - prev).days == 1 else 1
        best = max(best, run)
    return best


def minmax_100(x: np.ndarray) -> np.ndarray:
    """Min-max scale to 0-100. A degenerate range (all equal) maps to 100 (or 0 if all zero)."""
    x = np.asarray(x, dtype=float)
    lo, hi = x.min(), x.max()
    if hi == lo:
        return np.full_like(x, 100.0 if hi > 0 else 0.0)
    return (x - lo) / (hi - lo) * 100.0


def fsi_scores(frp: np.ndarray, area: np.ndarray, days: np.ndarray) -> np.ndarray:
    return W_FRP * minmax_100(np.log1p(frp)) + W_AREA * minmax_100(area) + W_DAYS * minmax_100(days)


def rank_month(det: pd.DataFrame, names: dict[str, str], top: int = 20) -> list[dict]:
    """det: detections of ONE sensor in one country-month with columns
    c10_lat, c10_lon, acq_date, frp, region_id (admin-1). Returns the top clusters.
    """
    if det.empty:
        return []
    cells = set(zip(det["c10_lat"].astype(int), det["c10_lon"].astype(int)))
    comps = clusters_8n(cells)
    cell_to_c = {c: i for i, comp in enumerate(comps) for c in comp}
    det = det.assign(cluster=[cell_to_c[(int(a), int(b))] for a, b in zip(det["c10_lat"], det["c10_lon"])])
    recs = []
    for cid, g in det.groupby("cluster"):
        comp = comps[cid]
        lats = np.array([c[0] for c in comp])
        lons = np.array([c[1] for c in comp])
        admin = Counter(g["region_id"]).most_common(1)[0][0]
        recs.append(
            {
                "frp_mw": float(g["frp"].fillna(0).sum()),
                "cells": len(comp),
                "days": longest_run(list(g["acq_date"])),
                "centroid": [round((lons.mean() + 0.5) / 10, 3), round((lats.mean() + 0.5) / 10, 3)],
                "admin1_id": admin,
                "admin1_name": names.get(admin, admin),
                "bbox": [round(lons.min() / 10, 2), round(lats.min() / 10, 2), round((lons.max() + 1) / 10, 2), round((lats.max() + 1) / 10, 2)],
            }
        )
    scores = fsi_scores(np.array([r["frp_mw"] for r in recs]), np.array([r["cells"] for r in recs]), np.array([r["days"] for r in recs]))
    for r, s in zip(recs, scores):
        r["fsi"] = round(float(s), 1)
        r["frp_mw"] = round(r["frp_mw"], 1)
    recs.sort(key=lambda r: (-r["fsi"], -r["frp_mw"]))
    out = []
    for i, r in enumerate(recs[:top], 1):
        out.append({"rank": i, "fsi": r["fsi"], "frp_mw": r["frp_mw"], "cells": r["cells"], "days": r["days"],
                    "centroid": r["centroid"], "admin1_id": r["admin1_id"], "admin1_name": r["admin1_name"], "bbox": r["bbox"]})
    return out
