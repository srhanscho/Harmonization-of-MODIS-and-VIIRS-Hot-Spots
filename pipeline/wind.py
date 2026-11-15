"""Wind context (REPORT_ALIGNMENT 7): NASA POWER monthly 10 m wind (WS10M speed m/s, WD10M
direction degrees, meteorological 'from' convention), no login required.

Endpoint: https://power.larc.nasa.gov/api/temporal/monthly/regional
          ?latitude-min&latitude-max&longitude-min&longitude-max&parameters=<ONE>&community=AG
          &start=YYYY&end=YYYY&format=JSON
Regional requests take one parameter and boxes of at most 10 x 10 degrees, so each country bbox
is split into tiles. Raw responses are cached under data/raw/power/{country}/.

    python wind.py --countries CO,AR --start 2001 --end 2025
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import time

import numpy as np
import pandas as pd
import requests

import config as C

log = logging.getLogger("wind")
URL = "https://power.larc.nasa.gov/api/temporal/monthly/regional"
PARAMS = ("WS10M", "WD10M")
POWER_DIR = C.RAW_DIR / "power"
MAX_TILE = 10.0


def tiles(bbox: list[float], size: float = MAX_TILE) -> list[tuple[float, float, float, float]]:
    """Split [w, s, e, n] into equal tiles no larger than `size` degrees per side."""
    w, s, e, n = bbox
    nx, ny = math.ceil((e - w) / size), math.ceil((n - s) / size)
    dx, dy = (e - w) / nx, (n - s) / ny
    return [(round(w + i * dx, 3), round(s + j * dy, 3), round(w + (i + 1) * dx, 3), round(s + (j + 1) * dy, 3)) for i in range(nx) for j in range(ny)]


def download(country: str, start: int, end: int) -> None:
    out = POWER_DIR / country
    out.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = "fire-harmonization-pipeline"
    for t in tiles(C.COUNTRY_BBOXES[country]):
        for p in PARAMS:
            path = out / f"{p}_{t[0]}_{t[1]}_{t[2]}_{t[3]}_{start}_{end}.json"
            if path.exists():
                continue
            q = {"latitude-min": t[1], "latitude-max": t[3], "longitude-min": t[0], "longitude-max": t[2],
                 "parameters": p, "community": "AG", "start": start, "end": end, "format": "JSON"}
            for attempt in range(1, 6):
                try:
                    r = session.get(URL, params=q, timeout=300)
                    if r.status_code >= 500 or r.status_code == 429:
                        raise requests.HTTPError(f"HTTP {r.status_code}")
                    r.raise_for_status()
                    data = r.json()
                    if "features" not in data:
                        raise ValueError(f"unexpected response: {str(data)[:200]}")
                    path.write_text(json.dumps(data), encoding="utf-8")
                    log.info("%s %s tile %s: %d points", country, p, t, len(data["features"]))
                    break
                except (requests.RequestException, ValueError) as e:
                    delay = 10 * 2 ** (attempt - 1)
                    log.warning("%s %s tile %s failed (%s); retry in %ds", country, p, t, e, delay)
                    time.sleep(delay)
            time.sleep(1)


def load(country: str) -> pd.DataFrame:
    """Columns lon, lat, year, month, ws, wd (monthly means; annual 'YYYY13' entries dropped)."""
    frames = {p: [] for p in PARAMS}
    for path in sorted((POWER_DIR / country).glob("*.json")):
        p = path.name.split("_")[0]
        data = json.loads(path.read_text(encoding="utf-8"))
        recs = []
        for f in data["features"]:
            lon, lat = f["geometry"]["coordinates"][:2]
            for k, v in f["properties"]["parameter"][p].items():
                if k[4:] == "13" or v is None or v <= -999:
                    continue
                recs.append((round(lon, 3), round(lat, 3), int(k[:4]), int(k[4:]), float(v)))
        frames[p].append(pd.DataFrame(recs, columns=["lon", "lat", "year", "month", p]))
    if not frames["WS10M"] or not frames["WD10M"]:
        return pd.DataFrame(columns=["lon", "lat", "year", "month", "ws", "wd"])
    ws = pd.concat(frames["WS10M"]).drop_duplicates(["lon", "lat", "year", "month"])
    wd = pd.concat(frames["WD10M"]).drop_duplicates(["lon", "lat", "year", "month"])
    df = ws.merge(wd, on=["lon", "lat", "year", "month"], how="inner").rename(columns={"WS10M": "ws", "WD10M": "wd"})
    return df


def to_uv(ws: np.ndarray, wd_from_deg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Meteorological direction (where the wind comes FROM) to u (east) / v (north) components."""
    rad = np.radians(wd_from_deg)
    return -ws * np.sin(rad), -ws * np.cos(rad)


def dir_from(u: float, v: float) -> float:
    return float((math.degrees(math.atan2(-u, -v)) + 360) % 360)


def export_grid(df: pd.DataFrame, country_geom, out_dir, country: str, max_points: int = 80) -> int:
    """Write wind/{country}/{year}.json as [{lat, lon, month, u, v, speed}] on a subsample of the
    POWER grid inside the country (stride grows until at most `max_points` points remain)."""
    from shapely import contains_xy

    if df.empty:
        return 0
    lats = np.sort(df["lat"].unique())
    lons = np.sort(df["lon"].unique())
    allpts = df[["lon", "lat"]].drop_duplicates()
    allpts = allpts[contains_xy(country_geom.buffer(0.5), allpts["lon"].to_numpy(), allpts["lat"].to_numpy())]
    stride = 2
    while True:
        keep_lat, keep_lon = set(lats[::stride]), set(lons[::stride])
        pts = allpts[allpts["lat"].isin(keep_lat) & allpts["lon"].isin(keep_lon)]
        if len(pts) <= max_points or stride >= 8:
            break
        stride += 1
    keys = set(zip(pts["lon"], pts["lat"]))
    sub = df[[(a, b) in keys for a, b in zip(df["lon"], df["lat"])]].copy()
    sub["u"], sub["v"] = to_uv(sub["ws"].to_numpy(), sub["wd"].to_numpy())
    n = 0
    for year, g in sub.groupby("year"):
        rows = [{"lat": float(lat), "lon": float(lon), "month": int(m), "u": round(float(u), 2), "v": round(float(v), 2), "speed": round(float(ws), 2)}
                for lon, lat, m, u, v, ws in g.sort_values(["month", "lat", "lon"])[["lon", "lat", "month", "u", "v", "ws"]].itertuples(index=False)]
        path = out_dir / "wind" / country / f"{int(year)}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(rows, separators=(",", ":")), encoding="utf-8")
        n += 1
    return n


def region_climatology(df: pd.DataFrame, geom, years=(2001, 2025)) -> list[dict] | None:
    """Monthly mean speed and prevailing direction (vector mean) over points inside `geom`."""
    from shapely import contains_xy

    if df.empty:
        return None
    d = df[(df["year"] >= years[0]) & (df["year"] <= years[1])]
    pts = d[["lon", "lat"]].drop_duplicates()
    inside = contains_xy(geom, pts["lon"].to_numpy(), pts["lat"].to_numpy())
    if not inside.any():  # small regions: nearest grid point to the centroid
        c = geom.centroid
        dist = (pts["lon"] - c.x) ** 2 + (pts["lat"] - c.y) ** 2
        sel = pts.loc[[dist.idxmin()]]
    else:
        sel = pts[inside]
    d = d.merge(sel, on=["lon", "lat"])
    u, v = to_uv(d["ws"].to_numpy(), d["wd"].to_numpy())
    d = d.assign(u=u, v=v)
    out = []
    for m, g in d.groupby("month"):
        mu, mv = float(g["u"].mean()), float(g["v"].mean())
        out.append({"month": int(m), "speed": round(float(g["ws"].mean()), 2), "direction": round(dir_from(mu, mv)),
                    "u": round(mu, 2), "v": round(mv, 2), "n_points": int(len(sel))})
    return out


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--countries", default="CO,AR")
    ap.add_argument("--start", type=int, default=2001)
    ap.add_argument("--end", type=int, default=2025)
    a = ap.parse_args()
    for c in [x.strip().upper() for x in a.countries.split(",")]:
        download(c, a.start, a.end)


if __name__ == "__main__":
    main()
