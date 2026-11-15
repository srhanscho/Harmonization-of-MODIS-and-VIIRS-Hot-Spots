"""Ocean-climate context (REPORT_ALIGNMENT 6): NOAA CPC Oceanic Nino Index (ONI) and its
correlation with the monthly HFAI z of each region.

ONI source: https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt (fallback PSL oni.data).
Each 3-month running season (DJF, JFM, ..., NDJ) is mapped to its centre month (DJF -> Jan of YR).
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import requests
from scipy.stats import pearsonr, spearmanr

import config as C

log = logging.getLogger(__name__)

ONI_URLS = [
    ("cpc", "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"),
    ("psl", "https://psl.noaa.gov/data/correlation/oni.data"),
]
SEASONS = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]
ONI_DIR = C.RAW_DIR / "oni"
MAX_LAG = 6


def phase(oni: float) -> str:
    if oni >= 0.5:
        return "el_nino"
    if oni <= -0.5:
        return "la_nina"
    return "neutral"


def parse_cpc(text: str) -> dict[tuple[int, int], float]:
    out = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 4 and parts[0] in SEASONS:
            try:
                out[(int(parts[1]), SEASONS.index(parts[0]) + 1)] = float(parts[3])
            except ValueError:
                continue
    return out


def parse_psl(text: str) -> dict[tuple[int, int], float]:
    """PSL format: header 'start end', then 'YEAR v1 .. v12' rows (value for the season centred on
    each month), missing = -99.9."""
    out = {}
    for line in text.splitlines()[1:]:
        parts = line.split()
        if len(parts) == 13 and parts[0].isdigit():
            for m, v in enumerate(parts[1:], 1):
                fv = float(v)
                if fv > -99:
                    out[(int(parts[0]), m)] = fv
    return out


def load_oni(refresh: bool = False) -> dict[tuple[int, int], float]:
    ONI_DIR.mkdir(parents=True, exist_ok=True)
    for name, url in ONI_URLS:
        path = ONI_DIR / Path(url).name
        if refresh or not path.exists():
            try:
                r = requests.get(url, timeout=60, headers={"User-Agent": "fire-harmonization-pipeline"})
                r.raise_for_status()
                path.write_text(r.text, encoding="utf-8")
            except requests.RequestException as e:
                log.warning("ONI download failed from %s: %s", url, e)
                if not path.exists():
                    continue
        text = path.read_text(encoding="utf-8")
        data = parse_cpc(text) if name == "cpc" else parse_psl(text)
        if data:
            return data
    return {}


def oni_json(oni: dict[tuple[int, int], float], from_year: int = 2000) -> list[dict]:
    return [{"year": y, "month": m, "oni": round(v, 2), "phase": phase(v)} for (y, m), v in sorted(oni.items()) if y >= from_year]


def _shift(y: int, m: int, lag: int) -> tuple[int, int]:
    k = y * 12 + (m - 1) - lag
    return k // 12, k % 12 + 1


def enso_link(rows: list[dict], oni: dict[tuple[int, int], float], min_n: int = 36) -> dict:
    """Correlate ONI leading by 0..6 months with the HFAI z of each month (2001 onwards)."""
    z = {(r["year"], r["month"]): r["z"] for r in rows if r.get("z") is not None and r["year"] >= 2001}
    best = None
    by_lag = []
    for lag in range(MAX_LAG + 1):
        pairs = [(oni[_shift(y, m, lag)], v) for (y, m), v in z.items() if _shift(y, m, lag) in oni]
        if len(pairs) < min_n:
            continue
        x, yv = np.array(pairs).T
        if np.std(x) == 0 or np.std(yv) == 0:
            continue
        r, p = pearsonr(x, yv)
        rs, _ = spearmanr(x, yv)
        rec = {"lag": lag, "r": round(float(r), 3), "p": float(f"{p:.3g}"), "spearman": round(float(rs), 3), "n": len(pairs)}
        by_lag.append(rec)
        if best is None or abs(rec["r"]) > abs(best["r"]):
            best = rec
    if best is None:
        return {"best_lag": None, "r": None, "p": None, "n": len(z), "r2": None, "by_lag": [],
                "mean_z_el_nino": None, "mean_z_la_nina": None, "mean_z_neutral": None}
    groups: dict[str, list[float]] = {"el_nino": [], "la_nina": [], "neutral": []}
    for (y, m), v in z.items():
        key = _shift(y, m, best["lag"])
        if key in oni:
            groups[phase(oni[key])].append(v)

    def mean(v):
        return round(float(np.mean(v)), 2) if v else None

    return {
        "best_lag": best["lag"], "r": best["r"], "p": best["p"], "spearman": best["spearman"], "n": best["n"],
        "r2": round(best["r"] ** 2, 3), "by_lag": by_lag,
        "mean_z_el_nino": mean(groups["el_nino"]), "mean_z_la_nina": mean(groups["la_nina"]), "mean_z_neutral": mean(groups["neutral"]),
        "note": "ONI leads fire anomaly by best_lag months; phases evaluated at that lag",
    }
