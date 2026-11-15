/**
 * Data contract types. Field names mirror docs/PROJECT_SPEC.md section 5 exactly.
 * Do not rename fields without coordinating with the pipeline team.
 */

export type Bbox = [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]

export interface Region {
  id: string;
  name: string;
  country: string;
  bbox: Bbox;
}

export type Regime = "R1" | "R2" | "R3";

export interface MonthlyRow {
  year: number;
  month: number; // 1..12
  /** Observed MODIS cell-days (Terra + Aqua depending on period). */
  raw_modis: number | null;
  /** Observed VIIRS cell-days (null before 2012). */
  raw_viirs: number | null;
  /** Estimated VIIRS S-NPP equivalent cell-days (report Eq. 3). */
  harmonized: number | null;
  harmonized_p5: number | null;
  harmonized_p95: number | null;
  source: string | null;
  factor: number | null;
  regime: Regime | string | null;
  /** FRP sums in MW (report Eq. 1-2). Optional: absent until the pipeline publishes them. */
  frp_raw_modis?: number | null;
  frp_raw_viirs?: number | null;
  frp_harmonized?: number | null;
  /** Harmonized Fire Activity Index (report Eq. 4, on log1p) and its class. */
  z?: number | null;
  z_class?: ZClass | null;
}

/** Report classes: Z < -0.5 below; -0.5..1.0 normal; 1.0..2.0 moderate alert; > 2.0 critical. */
export type ZClass = "below" | "normal" | "moderate" | "critical";

export type CalendarMetric = "activity" | "anomaly" | "frp";

export interface ClimatologyRow {
  month: number;
  median: number | null;
  p10: number | null;
  p90: number | null;
  mean: number | null;
  n_years: number;
}

export interface LoyoRow {
  year: number;
  mape_raw: number | null;
  mape_harmonized: number | null;
  r: number | null;
}

export interface FrpCalibration {
  region_id: string;
  alpha: number | null;
  beta: number | null;
  r2: number | null;
  n: number | null;
}

export interface Validation {
  loyo: LoyoRow[];
  seam_2012: { raw_ratio: number | null; harmonized_ratio: number | null };
  /** Normalized by lib/contract.ts from validation.json -> frp_calibration (array or object keyed by region). */
  frp_calibration?: FrpCalibration[];
}

/* ---------- Report-alignment files (all optional) ---------- */

/** ranking/{country}/{year}-{month}.json: one FSI cluster (report Eq. 5). */
export interface FsiCluster {
  rank: number;
  fsi: number;
  frp_mw: number | null;
  cells: number | null;
  days: number | null;
  centroid: [number, number] | null; // [lon, lat]
  admin1_name: string | null;
  bbox: Bbox | null;
}

export interface YearMonth {
  year: number;
  month: number;
}

export interface BacktestRow extends YearMonth {
  observed: number | null;
  predicted: number | null;
  lo: number | null;
  hi: number | null;
}

export type AlertLevel = "yellow" | "red";

export interface OutlookRow extends YearMonth {
  predicted: number | null;
  lo: number | null;
  hi: number | null;
  /** Probabilities 0..1 of HFAI Z > 1 and Z > 2. */
  p_above_z1: number | null;
  p_above_z2: number | null;
  alert: AlertLevel | null;
}

export interface ForecastMetrics {
  /** Fraction (0.18 = 18%). */
  mape: number | null;
  /** Share of test months inside the interval, 0..1. */
  coverage: number | null;
  /** Nominal interval level, 0..1 (default 0.8). */
  interval: number;
  n_test: number | null;
  train_end: YearMonth | null;
}

/** forecast/{region_id}.json */
export interface Forecast {
  model: string | null;
  backtest: BacktestRow[];
  metrics: ForecastMetrics;
  outlook: OutlookRow[];
}

export type EnsoPhase = "el_nino" | "la_nina" | "neutral";

/** oni.json row (3-month season mapped to its center month). */
export interface OniRow extends YearMonth {
  oni: number | null;
  phase: EnsoPhase;
}

export interface EnsoLink {
  best_lag: number | null;
  r: number | null;
  p: number | null;
  n: number | null;
  mean_z_el_nino: number | null;
  mean_z_la_nina: number | null;
  mean_z_neutral: number | null;
}

export interface WindClimRow {
  month: number;
  speed: number | null;
  direction: number | null; // degrees, meteorological "from"
}

/** climate/{region_id}.json */
export interface ClimateLink {
  enso: EnsoLink | null;
  wind: WindClimRow[];
}

/** wind/{country}/{year}.json row. u/v in m/s, toward east/north. */
export interface WindRow {
  lat: number;
  lon: number;
  month: number;
  u: number;
  v: number;
  speed: number;
}

/* ---------- Sensor footprints (optional demo data) ---------- */

export type Sensor = "MODIS" | "VIIRS";

/** pixels/{region_id}/{YYYY}-{MM}.json row: one active-fire detection at its true pixel size. */
export interface PixelDetection {
  lon: number;
  lat: number;
  sensor: Sensor;
  /** Terra, Aqua, S-NPP, NOAA-20, NOAA-21 (normalized from FIRMS codes). */
  sat: string | null;
  date: string | null;
  /** "D" day / "N" night. */
  dn: "D" | "N" | null;
  /** Along-scan and along-track pixel size in km (FIRMS scan / track). */
  scan_km: number;
  track_km: number;
  frp: number | null;
  /** Confidence as published: 0-100 (MODIS) or low / nominal / high (VIIRS). */
  conf: string | null;
}

/** pixels/index.json entry. months are "YYYY-MM". */
export interface PixelIndexEntry {
  region_id: string;
  months: string[];
  subsampled: boolean;
}

export interface CellRow {
  cell: string;
  lat: number;
  lon: number;
  year: number;
  month: number;
  harmonized: number | null;
  /** Optional normal for this cell and calendar month (median over the baseline). */
  median?: number | null;
}

/**
 * meta.json is produced by the pipeline. Its shape is not fixed in the spec,
 * so every field is optional and the UI degrades gracefully.
 */
export interface Meta {
  generated_at?: string;
  /** Last month with data, e.g. { year: 2026, month: 11 }. */
  last_month?: { year: number; month: number };
  baseline?: [number, number];
  overlap?: [number, number];
  unit?: string;
  sources?: string[];
  notes?: string;
  [key: string]: unknown;
}

export type DisplayMode = "raw" | "harmonized";

export type LoadResult<T> =
  | { status: "ok"; data: T }
  | { status: "missing" }
  | { status: "error"; message: string };
