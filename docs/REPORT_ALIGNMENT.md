# Alignment with the team's technical report

Source: the team's report "Informe Técnico de Arquitectura, Armonización Matemática y Modelado Predictivo" (Spanish). This document is the delta between that report and the current implementation (PROJECT_SPEC.md). Where they conflict, THIS document wins.

## Decisions (what changes)

### 1. Harmonization target scale: VIIRS-equivalent (report Eq. 3)
Express the harmonized series in **VIIRS S-NPP equivalents** (not MODIS-Aqua equivalents):
- Count scale factor `gamma[region, calendar_month, daynight]` = Σ VIIRS S-NPP fire cell-days / Σ Aqua MODIS fire cell-days over the 2012–2019 overlap (same strata and shrinkage as before; this is the old `k`).
- Harmonized count `N~`:
  - t < 2012-01: `gamma * N_MODIS` (Terra-only months first bridged to Aqua as before).
  - 2012-01 ≤ t ≤ end of MODIS in the data: `w * (gamma * N_MODIS) + (1 - w) * N_VIIRS`, with `w = 0.5`.
  - after MODIS ends: `N_VIIRS`.
- `N_VIIRS` is ONE VIIRS satellite on a single scale, never a sum of satellites: S-NPP until 2026-11-02, then NOAA-20 scaled to S-NPP with `k2` (NOAA-20/S-NPP overlap ratio). Do not add S-NPP + NOAA-20 + NOAA-21.
- Keep `harmonized_p5/p95` (now from the spread of annual gamma across overlap years), `source`, `factor` (= gamma or blend), `regime`.
- Keep the 0.1° analysis grid (the report proposes H3 res 5–6; we keep the square grid for speed and render it as a smooth heatmap; H3 is listed as future work).

### 2. FRP power-law calibration (report Eq. 1–2)
- Aggregate FRP sum (MW) per cell/region × period and sensor (Eq. 1).
- Fit `ln(FRP_VIIRS) = ln(alpha_r) + beta_r * ln(FRP_MODIS)` per region r on overlap months where both > 0 (OLS on logs; shrink to country fit when < 24 paired months). Harmonized FRP `FRP_hat = alpha_r * FRP_MODIS^beta_r` before 2012, same blend rule as counts after.
- Export per region: `alpha`, `beta`, `r2`, `n` in `validation.json` → `frp_calibration`.
- Add `frp_raw_modis`, `frp_raw_viirs`, `frp_harmonized` (MW, 1 decimal) to each monthly row.

### 3. Harmonized Fire Activity Index (HFAI) z-score (report Eq. 4 + classes)
- Per-sensor standardized anomaly as in the report: `Z = (X - mu) / (sigma + 1e-5)` per region, calendar month and sensor, against that sensor's own baseline (MODIS 2003–2022; VIIRS 2012–2025). Apply on `log1p(X)` because counts are skewed and zero-inflated (documented deviation from the report).
- HFAI for a month = MODIS Z before 2012, mean of MODIS Z and VIIRS Z during the overlap, VIIRS Z after MODIS ends.
- Also compute Z on the harmonized series with a single 2003–2022 baseline, and report the agreement between both in validation (correlation of the two Z series in the overlap). This is our check that the per-sensor method is consistent.
- Classes (report table): `Z < -0.5` below normal; `-0.5 ≤ Z ≤ 1.0` expected; `1.0 < Z ≤ 2.0` moderate alert; `Z > 2.0` critical.
- Add `z` (HFAI, 2 decimals) and `z_class` (`below|normal|moderate|critical`) to each monthly row.

### 4. Fire Severity Index (FSI) ranking (report Eq. 5)
- For a selected month, group contiguous active 0.1° cells (8-neighbour) into clusters C.
- `FSI(C) = 0.45*FRP_norm + 0.35*A_norm + 0.20*D_norm`, each normalized 0–100 (FRP on a log scale) across clusters of that month in the country; A = number of cells; D = max consecutive days with detections in the cluster within the month.
- Label: "Fire Severity Index (composite, 0–100)". Never show hectares.
- Export `ranking/{country}/{year}-{month}.json`: top 20 clusters `{rank, fsi, frp_mw, cells, days, centroid:[lon,lat], admin1_name, bbox}` for the last 36 months (keep size small).

### 5. Predictive lab (report section 4) — reduced scope for the deadline
IN scope:
- **Backtest chart:** per region, fit a seasonal model on the harmonized series 2001–2015 (statsmodels SARIMA (1,0,1)(1,1,1,12) on log1p, or Prophet if it installs quickly), forecast 2016–2026 with 80% interval, and compare with observed harmonized values (MAPE, coverage of the interval). This visually shows that the historical model predicts the modern VIIRS-era record. Export `forecast/{region_id}.json` with `backtest` (month, observed, predicted, lo, hi) and `metrics`.
- **Seasonal outlook (next 3 months):** same model refit on all data → `outlook` (month, predicted, lo, hi, p_above_z1 = probability of Z > 1, p_above_z2 = probability of Z > 2 derived from the predictive distribution).
- **Experimental alerts:** Yellow if p_above_z1 > 0.60, Red if p_above_z2 > 0.75 (report thresholds). Always labelled "Experimental — statistical outlook, not an operational warning".
OUT of scope (listed as future work): LightGBM/XGBoost spatial risk map with NDVI/soil moisture, SHAP explanations, SARIMAX with exogenous weather, file uploads to the assistant.

### 6. Ocean–climate context: ENSO / ONI (P1)
- Download NOAA CPC ONI (https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt; fallback https://psl.noaa.gov/data/correlation/oni.data). Map 3-month seasons to the center month.
- Export `oni.json`: `[{year, month, oni, phase}]` with phase `el_nino` (ONI ≥ +0.5), `la_nina` (≤ −0.5), `neutral`.
- Per region: Pearson/Spearman correlation between ONI (lags 0–6 months) and monthly HFAI z (2001–latest), best lag, r, p-value, n; and mean z in El Niño vs La Niña months. Export into `climate/{region_id}.json` → `{enso: {best_lag, r, p, n, mean_z_el_nino, mean_z_la_nina, mean_z_neutral}}`.
- Use ONI as an optional Prophet regressor only if it improves backtest MAPE.

### 7. Wind context (P2)
- Source: NASA POWER API (no login), monthly regional endpoint, parameters `WS10M` (wind speed, m/s) and `WD10M` (direction, degrees), community `AG` or `RE`, covering Colombia and Argentina bboxes (split into tiles allowed by the API). Verify the current endpoint shape in the POWER docs before coding.
- Convert to u/v components; export `wind/{country}/{year}.json`: `[{lat, lon, month, u, v, speed}]` on the POWER grid (~0.5°), rounded to 2 decimals; only years 2001–latest needed by the UI, keep total small (subsample to 1° if large).
- Per region: monthly climatological mean wind speed and prevailing direction in `climate/{region_id}.json` → `wind`.

## Web changes (after the redesign lands)
- ENSO band on the calendar (El Niño / La Niña / neutral per month, colorblind-safe, with legend) and an "Ocean–climate link" card: "In {region}, El Niño explains r² of fire anomaly variation (lag N months)".
- Wind layer (P2): toggle that draws monthly mean wind as subtle arrows or short streamlines over the map for the selected month; must not overpower the fire heatmap.
- Calendar metric selector: **Activity** (harmonized count, fire ramp) | **Anomaly (HFAI Z)** (diverging, colorblind-safe palette mapped to the 4 report classes; legend with the class names) | **FRP**.
- Layer selector already exists (MODIS / VIIRS / Harmonized); keep it.
- **Ranking panel**: FSI top clusters for the selected month, click → fly to cluster bbox.
- **Predictive lab tab**: backtest chart (observed vs predicted with band, metrics), 3-month outlook, experimental alert badges per region.
- Assistant tools: add `get_ranking_fsi`, `get_forecast`, and include `z`/`z_class` in series/anomaly tools.
- Method tab: add the equations (Eq. 1–5) in plain language plus the deviations listed above.
