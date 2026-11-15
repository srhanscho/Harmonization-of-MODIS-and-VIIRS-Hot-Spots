"""Regions: Natural Earth admin-1 (public domain) for the configured countries, country-level
regions and demo boxes. Also maps 0.01 deg fire cells to regions.

Run directly to download boundaries:  python regions.py
"""

from __future__ import annotations

import argparse
import logging
import zipfile
from pathlib import Path

import requests

import config as C

log = logging.getLogger(__name__)

NE_URLS = [
    "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip",
    "https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/cultural/ne_10m_admin_1_states_provinces.zip",
]
ADMIN1_FILE = C.BOUNDARIES_DIR / "admin1.geojson"


def download_boundaries(countries: list[str], force: bool = False) -> Path:
    """Download Natural Earth admin-1, keep only `countries`, write admin1.geojson."""
    import geopandas as gpd

    C.BOUNDARIES_DIR.mkdir(parents=True, exist_ok=True)
    if ADMIN1_FILE.exists() and not force:
        log.info("Boundaries already present: %s", ADMIN1_FILE)
        return ADMIN1_FILE
    zip_path = C.BOUNDARIES_DIR / "ne_10m_admin_1_states_provinces.zip"
    if not zip_path.exists():
        last_err = None
        for url in NE_URLS:
            try:
                log.info("Downloading %s", url)
                with requests.get(url, timeout=120, stream=True, headers={"User-Agent": "fire-harmonization-pipeline"}) as r:
                    r.raise_for_status()
                    tmp = zip_path.with_suffix(".part")
                    with open(tmp, "wb") as fh:
                        for chunk in r.iter_content(1 << 20):
                            fh.write(chunk)
                    tmp.replace(zip_path)
                break
            except requests.RequestException as e:
                last_err = e
                log.warning("Download failed from %s: %s", url, e)
        else:
            raise RuntimeError(f"Could not download Natural Earth admin-1: {last_err}")
    with zipfile.ZipFile(zip_path) as z:
        shp = next(n for n in z.namelist() if n.endswith(".shp"))
    gdf = gpd.read_file(f"zip://{zip_path.as_posix()}!{shp}")
    gdf = gdf[gdf["iso_a2"].isin(countries)][["iso_3166_2", "name", "iso_a2", "geometry"]].copy()
    gdf = gdf.rename(columns={"iso_3166_2": "id", "iso_a2": "country"})
    gdf = gdf.to_crs(4326)
    gdf.to_file(ADMIN1_FILE, driver="GeoJSON")
    log.info("Wrote %d admin-1 polygons to %s", len(gdf), ADMIN1_FILE)
    return ADMIN1_FILE


# Natural Earth quirks: Bogota D.C. shares CO-CUN with Cundinamarca (ISO 3166-2 code is CO-DC),
# and tiny disputed features carry placeholder codes like 'CO-X01~' with no name.
ID_FIXES = {("CO-CUN", "Bogota"): "CO-DC"}


def fix_admin1(gdf):
    gdf = gdf[gdf["name"].notna() & ~gdf["id"].astype(str).str.contains("~")].copy()
    gdf["id"] = [ID_FIXES.get((i, n), i) for i, n in zip(gdf["id"], gdf["name"])]
    if gdf["id"].duplicated().any():  # merge any remaining duplicate codes into one region
        gdf = gdf.dissolve(by="id", aggfunc="first").reset_index()
    return gdf


def load_regions(countries: list[str]):
    """Return a GeoDataFrame with columns id, name, country, type, geometry (EPSG:4326)."""
    import geopandas as gpd
    import pandas as pd
    from shapely.geometry import box

    admin1 = fix_admin1(gpd.read_file(ADMIN1_FILE))
    admin1 = admin1[admin1["country"].isin(countries)].copy()
    admin1["type"] = "admin1"
    parts = [admin1[["id", "name", "country", "type", "geometry"]]]
    for cc in countries:
        geom = admin1[admin1["country"] == cc].geometry.union_all()
        parts.append(gpd.GeoDataFrame([{"id": cc, "name": C.COUNTRY_NAMES.get(cc, cc), "country": cc, "type": "country", "geometry": geom}], crs=4326))
    demos = [
        {"id": d["id"], "name": d["name"], "country": d["country"], "type": "demo", "geometry": box(*d["bbox"])}
        for d in C.DEMO_REGIONS
        if d["country"] in countries
    ]
    if demos:
        parts.append(gpd.GeoDataFrame(demos, crs=4326))
    return gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), crs=4326)


def regions_json(regions) -> list[dict]:
    out = []
    for r in regions.itertuples(index=False):
        b = r.geometry.bounds
        out.append(
            {
                "id": r.id,
                "name": r.name,
                "country": r.country,
                "type": r.type,
                "bbox": [round(b[0], 2), round(b[1], 2), round(b[2], 2), round(b[3], 2)],
            }
        )
    return out


def map_cells_to_regions(cells, regions):
    """Map unique 0.01 deg cells (polars frame with cell_lat, cell_lon) to region ids by cell centre.

    Returns a polars frame (cell_lat, cell_lon, region_id), many-to-many (admin-1 + country + demo).
    """
    import geopandas as gpd
    import polars as pl

    pdf = cells.select(["cell_lat", "cell_lon"]).unique().to_pandas()
    if pdf.empty:
        return pl.DataFrame(schema={"cell_lat": pl.Int32, "cell_lon": pl.Int32, "region_id": pl.Utf8})
    pts = gpd.GeoDataFrame(
        pdf,
        geometry=gpd.points_from_xy((pdf["cell_lon"] + 0.5) / 100.0, (pdf["cell_lat"] + 0.5) / 100.0),
        crs=4326,
    )
    joined = gpd.sjoin(pts, regions[["id", "geometry"]], how="inner", predicate="within")
    out = pl.from_pandas(joined[["cell_lat", "cell_lon", "id"]].rename(columns={"id": "region_id"}))
    return out.with_columns(pl.col("cell_lat").cast(pl.Int32), pl.col("cell_lon").cast(pl.Int32), pl.col("region_id").cast(pl.Utf8))


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description="Download Natural Earth admin-1 boundaries")
    ap.add_argument("--countries", default="CO,AR")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    download_boundaries([c.strip().upper() for c in args.countries.split(",")], force=args.force)


if __name__ == "__main__":
    main()
