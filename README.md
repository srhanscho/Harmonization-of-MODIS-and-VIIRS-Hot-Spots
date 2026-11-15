# K-Fire

**Harmonized MODIS + VIIRS Burning Activity Calendar**  
NASA Space Apps Challenge 2026 — *"Harmonization of MODIS and VIIRS Hot Spots"*

> **Did the fire change, or the satellite?**  
> **K-Fire** unifies 25+ years of active-fire detections from **MODIS** (1 km, since Nov 2000) and **VIIRS** (375 m, since Jan 2012) into a single, calibrated time series in VIIRS S-NPP equivalents, displayed as an interactive month × year calendar over a 3D globe.

---

## Project Structure

- `web/` — Next.js + TypeScript + Tailwind CSS + MapLibre GL + ECharts frontend.
- `pipeline/` — Python pipeline for NASA FIRMS ingestion, harmonization, validation, climate/wind context, and seasonal forecasts.
- `docs/` — Technical specification (`PROJECT_SPEC.md`) and report alignment (`REPORT_ALIGNMENT.md`).

---

## Quick Start

### 1. Run the Web App (`web/`)

Precomputed data is already included in `web/public/data/`.

```bash
cd web
npm install
npm run dev
```

Open **http://localhost:3000**.

*(Optional)* For the AI assistant, copy `web/.env.example` to `web/.env.local` and set `ANTHROPIC_API_KEY=sk-ant-...`.

### 2. Run the Python Pipeline (`pipeline/`)

Only required if you want to run tests or regenerate `web/public/data/` from raw NASA FIRMS detections.

```bash
cd pipeline
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt   # Windows (.venv/bin/python on macOS/Linux)

# Run tests
.venv\Scripts\python regions.py --countries CO,AR
.venv\Scripts\python -m pytest -v

# Regenerate data (requires FIRMS_MAP_KEY in pipeline/.env)
.venv\Scripts\python download_firms.py --countries CO,AR --start 2000-11-01 --end 2026-11-13
.venv\Scripts\python wind.py --countries CO,AR --start 2001 --end 2025
.venv\Scripts\python process.py
```

---

## Data Sources

- **Active Fires:** NASA FIRMS — MODIS C6.1 (`MCD14ML`) & VIIRS 375 m (`VNP14IMG`, `VJ114IMG`).
- **Climate & Wind:** NOAA CPC (Oceanic Niño Index) & NASA POWER (MERRA-2 10 m wind).
- **Boundaries & Basemap:** Natural Earth Admin-1, EOX Sentinel-2 cloudless (CC BY-NC-SA 4.0), © OpenFreeMap / © OpenStreetMap contributors.
