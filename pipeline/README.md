# Data pipeline: harmonized MODIS + VIIRS fire calendar

Offline Python pipeline that turns NASA FIRMS active-fire detections into the static JSON files
served by the web app from `web/public/data/`.

The method follows `docs/PROJECT_SPEC.md` (sections 4 and 5) as amended by
`docs/REPORT_ALIGNMENT.md`. Where the two conflict, `REPORT_ALIGNMENT.md` wins.

## Setup

```bash
cd pipeline
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # Windows (.venv/bin/python on macOS/Linux)
```

### FIRMS MAP_KEY

1. Request a free key at https://firms.modaps.eosdis.nasa.gov/api/map_key/ (it arrives by email).
2. Copy `.env.example` to `.env` and set `FIRMS_MAP_KEY=...`, or export the env var instead.
   `.env` is gitignored. The scripts never print or log the key.

## Run order

```bash
# 1. Admin-1 boundaries (Natural Earth, public domain). process.py also fetches them if missing.
python regions.py --countries CO,AR

# 2. FIRMS detections through the area API. The download is resumable: re-run to continue
#    or to retry failed chunks.
python download_firms.py --countries CO --start 2000-11-01 --end 2026-11-13
python download_firms.py --countries AR --start 2000-11-01 --end 2026-11-13
#    --sources MODIS,VIIRS_SNPP,VIIRS_NOAA20 (default), or explicit sources such as MODIS_SP
#    --dry-run prints the chunk plan only
#    You can run one process per source family in parallel; they share the key's budget.

# 3. Optional wind context (NASA POWER, no login)
python wind.py --countries CO,AR --start 2001 --end 2025

# 4. Process and export to ../web/public/data/
#    ONI (ENSO) is downloaded automatically and cached under data/raw/oni/.
python process.py
python process.py --from-archive path/to/archive_csvs           # add FIRMS Archive Download CSVs
python process.py --from-archive path/to/archive_csvs --no-raw  # archive CSVs only
#    --countries CO,AR  --cells-from-year 2001  --ranking-months 36  --no-forecast

# Tests
python -m pytest -q
```

### Downloader details

- **Endpoint:** `/api/area/csv/{KEY}/{SOURCE}/{west,south,east,north}/{days 1-5}/{YYYY-MM-DD}`.
- **Date ranges:** `/api/data_availability/csv/{KEY}/ALL` gives each source's range. Each family
  uses the standard product (`*_SP`) inside its archive, and the NRT product only for later
  dates. Example: MODIS_SP up to 2026-08-31, then MODIS_NRT.
- **Files:** 5-day chunks are saved as `data/raw/{SOURCE}/{COUNTRY}/{start}_{n}d.csv`. Chunks
  that already exist are skipped.
- **Transaction budget:** a country-sized 5-day request costs about 10 of the key's 5000
  transactions per 10-minute window. The downloader therefore:
  - checks `mapkey_status` every 10 requests,
  - pauses while the window is above 4000,
  - treats FIRMS "invalid key" answers during an exhausted window as rate limiting,
  - retries 5xx, 429 and timeouts with exponential backoff.
- **Throughput:** about 40 chunks per minute, so a full country takes 60–90 minutes.
- **Configuration:** bounding boxes and demo regions live in `config.py`.

## Method

1. **Cleaning** (`harmonize.clean_detections`)
   - Keep `type == 0` where the field exists. NRT files have no `type`.
   - Confidence: MODIS >= 30. VIIRS nominal or high; both `n`/`h` and `nominal`/`high` are
     accepted.
   - Static sources: for each satellite and year, drop a 0.01° cell that has detections on 50 or
     more distinct days that year. This rule also covers NRT data, which lacks `type`.
   - Satellite codes `T`/`Terra`, `A`/`Aqua`, `N`, `N20`/`1` are all accepted. NOAA-21 is
     ignored.
   - Dates are FIRMS UTC acquisition dates.
2. **Unit: fire cell-day.** A fire cell-day is one unique combination of 0.01° cell, UTC date,
   day/night and satellite. Cell-days are aggregated per satellite to region × month and to
   0.1° cell × month.
3. **Count calibration** (`harmonize.calibrate`). One ratio is computed per region, calendar
   month and day/night. Only months fully covered by both satellites are used.

   | Ratio | Definition | Overlap |
   |---|---|---|
   | `gamma` | Σ S-NPP / Σ Aqua | 2012–2019 |
   | `k2` | Σ NOAA-20 / Σ S-NPP | 2018–2026 |
   | Terra/Aqua | Σ Terra / Σ Aqua | 2003–2008 |

   - **Shrinkage:** the first level whose denominator has at least 30 cell-days wins. The order
     is region-month, region-annual, country-month, country-annual, pooled.
   - **Uncertainty:** p5 and p95 of the annual ratios at the chosen level.
4. **Harmonized series in VIIRS S-NPP equivalents**
   - `N_MODIS` is one MODIS satellite on the Aqua scale: Aqua, or Terra / (Terra/Aqua) when only
     Terra observes.
   - `N_VIIRS` is one VIIRS satellite on the S-NPP scale: S-NPP, or NOAA-20 / k2 after S-NPP
     ends on 2026-11-02. Satellites are never summed.
   - The value depends on which sensors observe the month:

     | Sensors observing | Harmonized value |
     |---|---|
     | MODIS only | `gamma·N_MODIS` |
     | MODIS and VIIRS | `0.5·gamma·N_MODIS + 0.5·N_VIIRS` |
     | VIIRS only | `N_VIIRS` |

   - Day and night are computed separately and then summed.
   - A sensor family takes part only if it covers as many days of the month as the best-covered
     family. For example, Jan 2012 is MODIS only, because S-NPP starts on the 20th.
   - Months with no active sensor are `null`, never 0.
5. **FRP power law**
   - Fit `ln FRP_SNPP = ln alpha + beta · ln FRP_Aqua` by OLS on monthly regional FRP sums,
     2012–2019 overlap.
   - Regions with fewer than 24 paired months use the country fit, then the pooled fit.
   - `frp_harmonized` follows the same blend: `alpha·FRP_MODIS^beta`, blended 50/50 with VIIRS
     FRP in the overlap, then VIIRS FRP alone. Terra FRP and NOAA-20 FRP are bridged with
     ratio-of-sums factors.
6. **HFAI z**
   - Per-sensor z on `log1p` counts: `(x − mu) / (sigma + 1e-5)` per region and calendar month.
     The baseline is 2003–2022 for MODIS (Aqua scale) and 2012–2025 for VIIRS (S-NPP scale).
   - HFAI is the MODIS z when only MODIS observes, the mean of both z in the overlap, and the
     VIIRS z when only VIIRS observes.
   - Classes:

     | Class | z range |
     |---|---|
     | `below` | z < −0.5 |
     | `normal` | −0.5 ≤ z ≤ 1 |
     | `moderate` | 1 < z ≤ 2 |
     | `critical` | z > 2 |

   - Partial months get `z = null`.
   - Consistency check: `validation.json → z_agreement` holds the correlation between HFAI z and
     z computed on the harmonized series with one 2003–2022 baseline.
7. **Fire Severity Index (FSI)**
   - For each country and month, active 0.1° cells (8-neighbour contiguity) are grouped into
     clusters. The month's VIIRS satellite is used, or MODIS before 2012.
   - Score: `FSI = 0.45·FRP_norm + 0.35·A_norm + 0.20·D_norm`.
     - Each term is min-max scaled to 0–100 across the clusters of that country-month.
     - FRP uses a log1p scale.
     - A is the number of cells.
     - D is the longest run of consecutive days with detections.
     - If every cluster has the same value, the term is set to 100.
   - FSI is a composite index. It is not burned area.
8. **Climatology:** median, p10, p90, mean and n_years per calendar month over 2003–2022 of the
   harmonized series. Partial months are excluded.
9. **Validation**
   - Leave-one-year-out, 2012–2019: refit gamma without the year and predict S-NPP from Aqua.
     Report MAPE for raw (Aqua as-is) and harmonized (gamma·Aqua), plus Pearson r. Admin-1
     region-months with at least 10 S-NPP cell-days are pooled.
   - 2012 seam: mean annual total for 2012–2014 divided by 2009–2011, for raw (the naive merged
     record), harmonized and Aqua-only.
10. **Forecast (predictive lab)**
    - Model: Prophet with yearly seasonality on `log1p(harmonized)` and an 80 % interval. Any
      region where Prophet fails falls back to SARIMA (1,0,1)(1,1,1,12); the `model` field
      records which one ran.
    - Backtest: train on 2001–2015, predict from 2016 to the last complete month, and compare
      against harmonized observed values.
    - Outlook: refit on all complete months and forecast the next 3 months. `p_above_z1` and
      `p_above_z2` come from a normal predictive distribution on log1p, against the harmonized
      2003–2022 baseline.
    - Alerts: yellow if P(z>1) > 0.60, red if P(z>2) > 0.75. These alerts are experimental
      statistical outlooks, not operational warnings.
    - Regions with too little fire history get `status: "insufficient_data"`.
11. **ENSO**
    - Input: NOAA CPC ONI. Each 3-month season is assigned to its centre month (DJF → January).
    - Phase: El Niño when ONI ≥ 0.5, La Niña when ONI ≤ −0.5, neutral otherwise.
    - For each region, Pearson and Spearman correlation between ONI leading by 0–6 months and
      monthly HFAI z (2001 onwards). The best lag is the one with the largest |r|, and mean z is
      reported per phase at that lag.
12. **Wind**
    - Source: NASA POWER monthly `WS10M` and `WD10M` on the MERRA-2 grid (0.5° × 0.625°).
    - Wind is converted to u/v. The exported grid is subsampled to about 1° × 1.25°, keeping
      points within 0.5° of the country.
    - Per-region climatology over 2001–2025: mean speed and vector-mean prevailing direction.

## Output schema (`web/public/data/`)

All MAPE values are fractions (0.18 = 18 %). Counts are fire cell-days. `null` means no
observation, never zero.

### `meta.json`

```jsonc
{ "version": "0.1.0", "generated_at": "...",
  "source_date_ranges": { "Terra": ["2000-11-01", "2026-11-13"], "Aqua": [...], "S-NPP": [...], "NOAA-20": [...] },
  "last_month": { "year": 2026, "month": 11, "partial": true },
  "last_complete_month": { "year": 2026, "month": 10 },
  "countries": ["CO", "AR"], "units": "...; harmonized = VIIRS S-NPP equivalents",
  "blend_w_modis": 0.5, "cells_from_year": 2001, "n_cell_files": 1500,
  "ranking_files": ["CO/2023-12", "..."], "forecast_regions": 61 }
```

### `regions.json`

```jsonc
[{ "id": "CO-VID", "name": "Vichada", "country": "CO", "type": "admin1", "bbox": [-71.1, 2.6, -67.4, 6.4] }]
```

- `type` is `admin1`, `country` or `demo`.
- Country ids are `CO` and `AR`.
- Demo ids are `DEMO-CHILECITO` (a 60 km box around Chilecito, La Rioja) and `DEMO-SNSM`.
- Bogotá D.C. is `CO-DC`.

### `monthly/{region_id}.json`

There is one row per month from 2000-11 to the last month.

```jsonc
{ "year": 2014, "month": 2,
  "raw_terra": 310, "raw_aqua": 799, "raw_snpp": 4308, "raw_noaa20": null,
  "raw_modis": 799, "raw_viirs": 4308,
  "harmonized": 4459.22, "harmonized_p5": 4174.54, "harmonized_p95": 5054.6,
  "source": "MODIS_AQUA+VIIRS_SNPP", "factor": 5.77, "w": 0.5, "regime": "R3", "partial": false,
  "frp_raw_modis": 34379.8, "frp_raw_viirs": 53582.4, "frp_harmonized": 53927.5,
  "z": 1.08, "z_class": "moderate" }
```

- `raw_terra`, `raw_aqua`, `raw_snpp`, `raw_noaa20`: each satellite's own count, or `null` when
  that satellite was not observing.
- `raw_modis`: the count of one MODIS satellite, Aqua when it observes, else Terra.
- `raw_viirs`: the count of one VIIRS satellite, S-NPP, else NOAA-20.
- `source`: `MODIS_TERRA`, `MODIS_AQUA`, `MODIS_AQUA+VIIRS_SNPP`, `MODIS_AQUA+VIIRS_NOAA20`,
  `VIIRS_SNPP` or `VIIRS_NOAA20`.
- `factor`: the effective gamma applied to the MODIS count. In VIIRS-only months it is the
  multiplier on the VIIRS count (1 for S-NPP, 1/k2 for NOAA-20).
- `w`: the MODIS weight, 1, 0.5 or 0.
- `regime`: R1 is Terra only, R2 is Terra+Aqua, R3 is any VIIRS active.
- `partial`: true when the sensors did not cover the whole month.
- `frp_*`: FRP sums in MW.
- `z_class`: `below`, `normal`, `moderate` or `critical`.

### `climatology/{region_id}.json`

There are 12 rows, computed on the harmonized series over 2003–2022:

```jsonc
[{ "month": 3, "median": 640.5, "p10": 210.0, "p90": 1320.0, "mean": 701.3, "n_years": 20 }]
```

### `validation.json`

```jsonc
{ "loyo": [{ "year": 2015, "mape_raw": 0.83, "mape_harmonized": 0.39, "r": 0.98, "n": 300 }],
  "loyo_summary": { "mape_raw_mean": 0.83, "mape_harmonized_mean": 0.39, "r_mean": 0.98 },
  "seam_2012": { "raw_ratio": 4.95, "harmonized_ratio": 1.05, "aqua_ratio": 1.06 },
  "seam_2012_by_region": { "CO-VID": { "raw_ratio": 0, "harmonized_ratio": 0, "aqua_ratio": 0 } },
  "z_agreement": { "all_admin1": { "r": 0.88, "n": 4092 }, "CO": { "r": 0, "n": 0 }, "AR": { "r": 0, "n": 0 } },
  "frp_calibration": { "CO-VID": { "alpha": 2.79, "beta": 0.95, "r2": 0.97, "n": 96, "level": "region",
                                   "terra_over_aqua": 0.75, "noaa20_over_snpp": 1.02 } },
  "factors": { "gamma_snpp_over_aqua": [{ "region_id": "CO", "month": 1, "daynight": "D",
                                          "k": 4.1, "k_p5": 3.6, "k_p95": 4.7, "level": "region_month" }],
               "k2_noaa20_over_snpp": [], "terra_over_aqua": [] },
  "notes": "..." }
```

`factors` lists the country regions only.

### `cells/{region_id}/{year}.json`

There is one file per region and year, for every region id. A country file holds the cells of
all its admin-1 regions. Only cells with fire are listed.

```jsonc
{ "group": "CO", "year": 2014, "cell_size": 0.1, "regions": ["CO-ANT", "CO-VID"], "null_months": [],
  "format": "[lon_center, lat_center, region_index, month, value, month, value, ...]",
  "cells": [[-69.45, 4.25, 1, 3, 124, 4, 21]] }
```

- `value` is the harmonized cell-day count, rounded to an integer, in VIIRS S-NPP equivalents
  with the region's blend.
- Months missing from a cell are 0, except the months in `null_months`, which had no active
  sensor.
- Cell values use admin-1 factors, so their sum can differ slightly from the country series.

### `ranking/{country}/{YYYY-MM}.json`

There is one file per country for each of the last 36 months.

```jsonc
{ "country": "CO", "year": 2026, "month": 3, "sensor": "VIIRS_SNPP", "partial": false,
  "label": "Fire Severity Index (composite, 0-100)",
  "clusters": [{ "rank": 1, "fsi": 78.5, "frp_mw": 225.9, "cells": 22, "days": 4,
                 "centroid": [-72.94, 8.62], "admin1_id": "CO-NSA", "admin1_name": "Norte de Santander",
                 "bbox": [-73.4, 8.2, -72.7, 8.9] }] }
```

`clusters` holds the top 20.

### `forecast/{region_id}.json`

```jsonc
{ "region_id": "CO-VID", "status": "ok", "model": "prophet", "outlook_model": "prophet",
  "train": [2001, 2015], "units": "harmonized fire cell-days (VIIRS S-NPP equivalents)",
  "label": "Experimental - statistical outlook, not an operational warning",
  "backtest": [{ "year": 2016, "month": 1, "observed": 3120.5, "predicted": 2890.1, "lo": 1700.2, "hi": 4800.9 }],
  "metrics": { "mape": 0.35, "mape_n": 120, "annual_mape": 0.11, "coverage_80": 0.91, "n": 128, "note": "..." },
  "outlook": [{ "year": 2026, "month": 11, "predicted": 150.2, "lo": 80.1, "hi": 270.3,
                "p_above_z1": 0.13, "p_above_z2": 0.02, "alert": null }],
  "alert_rules": { "yellow": "P(z>1) > 0.60", "red": "P(z>2) > 0.75" } }
```

- `status` is `ok`, `insufficient_data` or `model_failed`.
- `alert` is `null`, `"yellow"` or `"red"`.

### `oni.json`

```jsonc
[{ "year": 2015, "month": 12, "oni": 2.64, "phase": "el_nino" }]
```

There is one row per month from 2000 onwards. `phase` is `el_nino`, `la_nina` or `neutral`.

### `climate/{region_id}.json`

```jsonc
{ "region_id": "CO-VID",
  "enso": { "best_lag": 1, "r": 0.31, "p": 0.0001, "spearman": 0.29, "n": 300, "r2": 0.096,
            "by_lag": [{ "lag": 0, "r": 0.28, "p": 0.001, "spearman": 0.27, "n": 301 }],
            "mean_z_el_nino": 0.4, "mean_z_la_nina": -0.3, "mean_z_neutral": 0.0, "note": "..." },
  "wind": [{ "month": 1, "speed": 2.53, "dir_from_deg": 50, "u": -1.88, "v": -1.59, "n_points": 25 }] }
```

- In `enso`, ONI leads the fire anomaly by `best_lag` months.
- In `wind`, `dir_from_deg` is the meteorological "from" direction and u/v are in m/s.
- `enso` and `wind` are `null` when their source is unavailable.

### `wind/{country}/{year}.json`

```jsonc
{ "country": "CO", "year": 2020, "source": "NASA POWER (MERRA-2) monthly WS10M/WD10M",
  "points": [[-75.0, 2.0]],
  "format": "months[m-1][i] = [u, v] m/s at points[i] = [lon, lat]; ...",
  "months": [[[-0.56, -0.45]]] }
```

- `months` has 12 entries.
- Each `[u, v]` pair gives the direction the wind blows towards.
- A `null` pair means the value is missing.

## Limitations

- Fire cell-days and FSI are not burned area. Hectares are never derived from hot spots.
- gamma, k2 and the FRP power law are empirical sensor relations, not physical equivalences.
  - The confidence thresholds are a design choice.
  - Shrinkage hides local differences where data are scarce.
- MODIS orbital drift after about 2020 is not corrected; gamma is fitted on 2012–2019. The 50/50
  blend keeps using MODIS while it is still delivering data.
- Coverage is inferred from the data: first and last date per satellite, clipped to mission
  windows. A month with no detections over the whole download area counts as an outage. Short
  gaps inside a month are not detected.
- Months are built from UTC dates; local dates are not computed.
- The static-source rule is applied per satellite and year. It may remove persistent burning in a
  few cells.
- The HFAI z uses `log1p` counts, a documented deviation from the report, because counts are
  skewed and zero-inflated. z is null for partial months.
- Forecasts are statistical, seasonal-only outlooks with no weather inputs. ONI is not used as a
  forecast regressor, because future ONI is unknown at forecast time and the regressor was not
  validated.
- The analysis grid is a 0.1° square grid. H3 is future work.

## AI usage

This pipeline was written with an AI coding assistant (Claude Code), which also drafted this
README. The team defined the method in `docs/PROJECT_SPEC.md` and `docs/REPORT_ALIGNMENT.md` and
reviewed the code. Every number in the output comes from running this code on public data. The
web app's assistant uses a language model that only reads these generated files through tools.

**Data sources**

- Fire detections: NASA FIRMS (MODIS C6.1, VIIRS 375 m).
- Boundaries: Natural Earth (public domain).
- ENSO: NOAA CPC Oceanic Niño Index.
- Wind: NASA POWER.
