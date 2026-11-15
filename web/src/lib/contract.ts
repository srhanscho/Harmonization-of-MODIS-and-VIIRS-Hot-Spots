/**
 * Central field mapping for the report-alignment data files.
 *
 * The pipeline may name a field slightly differently than the spec. Every accepted alias lives
 * in ALIASES below, so matching a new pipeline output is a one-line change here. Normalizers are
 * pure (shared by the browser loaders and the assistant's server tools) and never invent values:
 * anything missing becomes null / an empty list. The only derived values are classifications
 * defined by the report thresholds (z class, ENSO phase, alert level) and u/v from speed+direction.
 */
import type {
  AlertLevel,
  BacktestRow,
  Bbox,
  CellRow,
  ClimateLink,
  EnsoLink,
  EnsoPhase,
  Forecast,
  FrpCalibration,
  FsiCluster,
  MonthlyRow,
  OniRow,
  OutlookRow,
  PixelDetection,
  PixelIndexEntry,
  Sensor,
  Validation,
  WindClimRow,
  WindRow,
  YearMonth,
  ZClass,
} from "./types";

export const ALIASES = {
  // monthly/{id}.json extra fields
  frp_raw_modis: ["frp_raw_modis", "frp_modis", "frp_modis_mw"],
  frp_raw_viirs: ["frp_raw_viirs", "frp_viirs", "frp_viirs_mw"],
  frp_harmonized: ["frp_harmonized", "frp_harm", "frp_hat", "frp_harmonized_mw"],
  z: ["z", "hfai", "hfai_z", "z_hfai"],
  z_class: ["z_class", "hfai_class", "zclass", "z_cls"],
  // ranking clusters
  fsi: ["fsi", "FSI", "score"],
  frp_mw: ["frp_mw", "frp", "frp_sum", "frp_sum_mw", "frp_total_mw"],
  cells: ["cells", "n_cells", "area_cells", "a", "area"],
  days: ["days", "max_days", "duration_days", "duration", "d"],
  admin1_name: ["admin1_name", "admin1", "adm1_name", "adm1", "name"],
  centroid: ["centroid", "center"],
  cluster_list: ["clusters", "top", "ranking", "items", "data"],
  // forecast
  model: ["model", "model_name", "model_id"],
  backtest: ["backtest", "back_test", "test"],
  outlook: ["outlook", "forecast", "future"],
  observed: ["observed", "actual", "obs", "y"],
  predicted: ["predicted", "yhat", "pred", "mean", "forecast"],
  lo: ["lo", "lower", "yhat_lower", "lo80", "pi_lo", "lo_80"],
  hi: ["hi", "upper", "yhat_upper", "hi80", "pi_hi", "hi_80"],
  p_above_z1: ["p_above_z1", "p_z1", "prob_z1", "p_gt_z1"],
  p_above_z2: ["p_above_z2", "p_z2", "prob_z2", "p_gt_z2"],
  mape: ["mape", "MAPE", "mape_test"],
  mape_pct: ["mape_pct", "mape_percent"],
  coverage: ["coverage", "coverage_80", "interval_coverage", "pi_coverage"],
  interval: ["interval", "interval_level", "pi_level", "level"],
  n_test: ["n_test", "n", "n_months"],
  train_end: ["train_end", "split", "train_until"],
  // oni / climate
  oni: ["oni", "ONI", "anom", "value"],
  phase: ["phase", "enso_phase", "enso"],
  best_lag: ["best_lag", "lag", "lag_months"],
  r: ["r", "pearson_r", "corr"],
  p: ["p", "p_value", "pvalue"],
  mean_z_el_nino: ["mean_z_el_nino", "mean_z_nino", "z_el_nino"],
  mean_z_la_nina: ["mean_z_la_nina", "mean_z_nina", "z_la_nina"],
  mean_z_neutral: ["mean_z_neutral", "z_neutral"],
  speed: ["speed", "ws", "ws10m", "WS10M", "wind_speed"],
  direction: ["direction", "dir", "wd", "wd10m", "WD10M", "prevailing_direction"],
  // validation.json -> frp_calibration
  frp_calibration: ["frp_calibration", "frp_cal", "frp"],
  alpha: ["alpha", "a"],
  beta: ["beta", "b"],
  r2: ["r2", "R2", "r_squared"],
  region_id: ["region_id", "region", "id"],
  // pixels/{region}/{YYYY}-{MM}.json
  px_lon: ["lon", "longitude", "lng", "x"],
  px_lat: ["lat", "latitude", "y"],
  px_sensor: ["sensor", "instrument", "inst"],
  px_sat: ["sat", "satellite", "platform", "spacecraft"],
  px_date: ["date", "acq_date", "datetime", "time"],
  px_dn: ["dn", "daynight", "day_night"],
  px_scan: ["scan_km", "scan", "along_scan_km"],
  px_track: ["track_km", "track", "along_track_km"],
  px_frp: ["frp", "frp_mw", "FRP"],
  px_conf: ["conf", "confidence"],
  px_list: ["pixels", "detections", "items", "data", "features"],
  px_months: ["months", "periods", "available"],
  // cells/{region}/{year}.json optional per-cell normal
  cell_median: ["median", "normal", "clim_median", "p50", "harmonized_median"],
} as const;

type Raw = Record<string, unknown>;
type AliasKey = keyof typeof ALIASES;

const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function get(o: Raw, k: AliasKey): unknown {
  for (const name of ALIASES[k]) if (o[name] !== undefined && o[name] !== null) return o[name];
  return undefined;
}
const gnum = (o: Raw, k: AliasKey) => num(get(o, k));
const gstr = (o: Raw, k: AliasKey) => {
  const v = get(o, k);
  return typeof v === "string" ? v : null;
};

/** Probabilities / coverage: accept 0..1 or 0..100. */
const frac = (v: number | null) => (v == null ? null : v > 1.0001 ? v / 100 : v);

function list(raw: unknown, key?: AliasKey): Raw[] {
  if (Array.isArray(raw)) return raw.filter(isObj);
  if (isObj(raw) && key) {
    const inner = get(raw, key);
    if (Array.isArray(inner)) return inner.filter(isObj);
  }
  return [];
}

/** Year-month from {year, month} ints or a "YYYY-MM[-DD]" string in period/date/month/ds. */
export function ym(o: Raw): YearMonth | null {
  const y = num(o.year);
  const m = num(o.month);
  if (y != null && m != null && m >= 1 && m <= 12) return { year: y, month: m };
  for (const k of ["period", "date", "month", "ym", "ds", "time"]) {
    const v = o[k];
    if (typeof v === "string") {
      const hit = /^(\d{4})-(\d{1,2})/.exec(v);
      if (hit) return { year: Number(hit[1]), month: Number(hit[2]) };
    }
  }
  return null;
}

/* ---------- classifications defined by the report ---------- */

export const Z_THRESHOLDS = { below: -0.5, moderate: 1.0, critical: 2.0 } as const;

export function classifyZ(z: number | null | undefined): ZClass | null {
  if (z == null || Number.isNaN(z)) return null;
  if (z < Z_THRESHOLDS.below) return "below";
  if (z <= Z_THRESHOLDS.moderate) return "normal";
  if (z <= Z_THRESHOLDS.critical) return "moderate";
  return "critical";
}

function zClass(v: unknown, z: number | null): ZClass | null {
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (s.startsWith("below") || s === "low") return "below";
    if (s === "normal" || s === "expected") return "normal";
    if (s.startsWith("moderate") || s === "alert") return "moderate";
    if (s.startsWith("critical") || s === "severe") return "critical";
  }
  return classifyZ(z);
}

export const ALERT_THRESHOLDS = { yellow: 0.6, red: 0.75 } as const;

export function phaseFromOni(oni: number | null): EnsoPhase {
  if (oni == null) return "neutral";
  if (oni >= 0.5) return "el_nino";
  if (oni <= -0.5) return "la_nina";
  return "neutral";
}

function phase(v: unknown, oni: number | null): EnsoPhase {
  if (typeof v === "string") {
    const s = v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (s.includes("nino") && !s.includes("nina")) return "el_nino";
    if (s.includes("nina")) return "la_nina";
    if (s === "warm") return "el_nino";
    if (s === "cold" || s === "cool") return "la_nina";
    if (s.includes("neutral")) return "neutral";
  }
  return phaseFromOni(oni);
}

/* ---------- monthly rows ---------- */

export function normMonthlyRow(r: MonthlyRow): MonthlyRow {
  const o = r as unknown as Raw;
  const z = gnum(o, "z");
  return {
    ...r,
    frp_raw_modis: gnum(o, "frp_raw_modis"),
    frp_raw_viirs: gnum(o, "frp_raw_viirs"),
    frp_harmonized: gnum(o, "frp_harmonized"),
    z,
    z_class: zClass(get(o, "z_class"), z),
  };
}

export function normMonthly(raw: unknown): MonthlyRow[] {
  return Array.isArray(raw) ? (raw as MonthlyRow[]).map(normMonthlyRow) : [];
}

/* ---------- ranking ---------- */

function bbox(v: unknown): Bbox | null {
  if (Array.isArray(v) && v.length === 4) {
    const b = v.map(num);
    if (b.every((x) => x != null)) return b as Bbox;
  }
  if (isObj(v)) {
    const b = [num(v.minLon ?? v.west), num(v.minLat ?? v.south), num(v.maxLon ?? v.east), num(v.maxLat ?? v.north)];
    if (b.every((x) => x != null)) return b as Bbox;
  }
  return null;
}

function lonLat(o: Raw): [number, number] | null {
  const c = get(o, "centroid");
  if (Array.isArray(c) && c.length >= 2) {
    const lon = num(c[0]);
    const lat = num(c[1]);
    if (lon != null && lat != null) return [lon, lat];
  }
  if (isObj(c)) {
    const lon = num(c.lon ?? c.lng ?? c.x);
    const lat = num(c.lat ?? c.y);
    if (lon != null && lat != null) return [lon, lat];
  }
  const lon = num(o.lon ?? o.centroid_lon);
  const lat = num(o.lat ?? o.centroid_lat);
  return lon != null && lat != null ? [lon, lat] : null;
}

export function normRanking(raw: unknown): FsiCluster[] {
  return list(raw, "cluster_list")
    .map((o, i): FsiCluster | null => {
      const fsi = gnum(o, "fsi");
      if (fsi == null) return null;
      const centroid = lonLat(o);
      let bb = bbox(o.bbox);
      if (!bb && centroid) bb = [centroid[0] - 0.15, centroid[1] - 0.15, centroid[0] + 0.15, centroid[1] + 0.15];
      return {
        rank: num(o.rank) ?? i + 1,
        fsi,
        frp_mw: gnum(o, "frp_mw"),
        cells: gnum(o, "cells"),
        days: gnum(o, "days"),
        centroid,
        admin1_name: gstr(o, "admin1_name"),
        bbox: bb,
      };
    })
    .filter((c): c is FsiCluster => c != null)
    .sort((a, b) => a.rank - b.rank);
}

/* ---------- forecast ---------- */

function alert(o: Raw, p1: number | null, p2: number | null): AlertLevel | null {
  const a = o.alert ?? o.alert_level ?? o.level;
  if (typeof a === "string") {
    const s = a.toLowerCase();
    if (s.startsWith("red") || s === "rojo" || s === "roja") return "red";
    if (s.startsWith("yellow") || s.startsWith("amar")) return "yellow";
    if (s === "none" || s === "" || s === "green") return null;
  }
  const red = o.alert_red ?? o.red;
  const yellow = o.alert_yellow ?? o.yellow;
  if (typeof red === "boolean" || typeof yellow === "boolean") return red === true ? "red" : yellow === true ? "yellow" : null;
  // No flags published: apply the report thresholds to the published probabilities.
  if (p2 != null && p2 > ALERT_THRESHOLDS.red) return "red";
  if (p1 != null && p1 > ALERT_THRESHOLDS.yellow) return "yellow";
  return null;
}

export function normForecast(raw: unknown): Forecast | null {
  if (!isObj(raw)) return null;
  const m = get(raw, "model");
  const model =
    typeof m === "string" ? m : isObj(m) ? (typeof m.name === "string" ? m.name : typeof m.id === "string" ? m.id : null) : null;

  const backtest: BacktestRow[] = list(get(raw, "backtest"))
    .map((o) => {
      const t = ym(o);
      return t
        ? { ...t, observed: gnum(o, "observed"), predicted: gnum(o, "predicted"), lo: gnum(o, "lo"), hi: gnum(o, "hi") }
        : null;
    })
    .filter((x): x is BacktestRow => x != null)
    .sort((a, b) => a.year - b.year || a.month - b.month);

  const outlook: OutlookRow[] = list(get(raw, "outlook"))
    .map((o) => {
      const t = ym(o);
      if (!t) return null;
      const p1 = frac(gnum(o, "p_above_z1"));
      const p2 = frac(gnum(o, "p_above_z2"));
      return { ...t, predicted: gnum(o, "predicted"), lo: gnum(o, "lo"), hi: gnum(o, "hi"), p_above_z1: p1, p_above_z2: p2, alert: alert(o, p1, p2) };
    })
    .filter((x): x is OutlookRow => x != null)
    .sort((a, b) => a.year - b.year || a.month - b.month);

  const mo = isObj(raw.metrics) ? raw.metrics : {};
  const mapePct = gnum(mo, "mape_pct");
  const te = get(mo, "train_end") ?? get(raw, "train_end");
  const trainEnd = typeof te === "string" ? ym({ period: te }) : typeof te === "number" ? { year: te, month: 12 } : null;
  return {
    model,
    backtest,
    outlook,
    metrics: {
      mape: gnum(mo, "mape") ?? (mapePct != null ? mapePct / 100 : null),
      coverage: frac(gnum(mo, "coverage")),
      interval: frac(gnum(mo, "interval")) ?? 0.8,
      n_test: gnum(mo, "n_test"),
      train_end: trainEnd,
    },
  };
}

/* ---------- ONI / climate / wind ---------- */

export function normOni(raw: unknown): OniRow[] {
  return list(raw, "cluster_list")
    .map((o) => {
      const t = ym(o);
      if (!t) return null;
      const oni = gnum(o, "oni");
      return { ...t, oni, phase: phase(get(o, "phase"), oni) };
    })
    .filter((x): x is OniRow => x != null);
}

function normEnso(v: unknown): EnsoLink | null {
  if (!isObj(v)) return null;
  const e: EnsoLink = {
    best_lag: gnum(v, "best_lag"),
    r: gnum(v, "r"),
    p: gnum(v, "p"),
    n: gnum(v, "n_test"),
    mean_z_el_nino: gnum(v, "mean_z_el_nino"),
    mean_z_la_nina: gnum(v, "mean_z_la_nina"),
    mean_z_neutral: gnum(v, "mean_z_neutral"),
  };
  return e.r == null && e.mean_z_el_nino == null ? null : e;
}

function normWindClim(v: unknown): WindClimRow[] {
  const rows: Raw[] = Array.isArray(v)
    ? v.filter(isObj)
    : isObj(v)
      ? Object.entries(v).filter(([, x]) => isObj(x)).map(([k, x]) => ({ month: Number(k), ...(x as Raw) }))
      : [];
  return rows
    .map((o) => {
      const month = num(o.month);
      return month != null && month >= 1 && month <= 12
        ? { month, speed: gnum(o, "speed"), direction: gnum(o, "direction") }
        : null;
    })
    .filter((x): x is WindClimRow => x != null)
    .sort((a, b) => a.month - b.month);
}

export function normClimate(raw: unknown): ClimateLink | null {
  if (!isObj(raw)) return null;
  const out = { enso: normEnso(raw.enso), wind: normWindClim(raw.wind) };
  return out.enso || out.wind.length ? out : null;
}

export function normWind(raw: unknown): WindRow[] {
  return list(raw, "cluster_list")
    .map((o): WindRow | null => {
      const lat = num(o.lat);
      const lon = num(o.lon);
      const month = num(o.month) ?? ym(o)?.month ?? null;
      if (lat == null || lon == null || month == null) return null;
      let u = num(o.u);
      let v = num(o.v);
      const speed = gnum(o, "speed");
      const dir = gnum(o, "direction");
      if ((u == null || v == null) && speed != null && dir != null) {
        // Meteorological direction is where the wind comes FROM.
        const rad = (dir * Math.PI) / 180;
        u = -speed * Math.sin(rad);
        v = -speed * Math.cos(rad);
      }
      if (u == null || v == null) return null;
      return { lat, lon, month, u, v, speed: speed ?? Math.hypot(u, v) };
    })
    .filter((x): x is WindRow => x != null);
}

/* ---------- validation.json ---------- */

export function normFrpCalibration(raw: unknown): FrpCalibration[] {
  const rows: Raw[] = Array.isArray(raw)
    ? raw.filter(isObj)
    : isObj(raw)
      ? Object.entries(raw).filter(([, x]) => isObj(x)).map(([k, x]) => ({ region_id: k, ...(x as Raw) }))
      : [];
  return rows
    .map((o) => {
      const id = gstr(o, "region_id");
      return id ? { region_id: id, alpha: gnum(o, "alpha"), beta: gnum(o, "beta"), r2: gnum(o, "r2"), n: gnum(o, "n_test") } : null;
    })
    .filter((x): x is FrpCalibration => x != null);
}

export function normValidation(raw: unknown): Validation | null {
  if (!isObj(raw)) return null;
  const v = raw as unknown as Validation;
  const cal = normFrpCalibration(get(raw, "frp_calibration"));
  return { ...v, loyo: Array.isArray(v.loyo) ? v.loyo : [], frp_calibration: cal };
}

/* ---------- cells ---------- */

/** Cells keep their spec fields; only the optional per-cell normal is read through aliases. */
export function normCellRow(r: CellRow): CellRow {
  const o = r as unknown as Raw;
  return { ...r, median: gnum(o, "cell_median") };
}

/* ---------- sensor footprints (pixels/) ---------- */

/** Nominal nadir pixel size when scan/track are not published. */
export const NADIR_KM: Record<Sensor, number> = { MODIS: 1, VIIRS: 0.375 };

const SAT_NAMES: Record<string, string> = {
  t: "Terra", terra: "Terra", a: "Aqua", aqua: "Aqua",
  n: "S-NPP", npp: "S-NPP", snpp: "S-NPP", "s-npp": "S-NPP", suominpp: "S-NPP",
  n20: "NOAA-20", "noaa-20": "NOAA-20", noaa20: "NOAA-20", j1: "NOAA-20",
  n21: "NOAA-21", "noaa-21": "NOAA-21", noaa21: "NOAA-21", j2: "NOAA-21",
};

function satName(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  return SAT_NAMES[v.trim().toLowerCase().replace(/[\s_]/g, "")] ?? v.trim();
}

function sensorOf(v: unknown, sat: string | null, scan: number | null): Sensor | null {
  if (typeof v === "string") {
    const s = v.toUpperCase();
    if (s.startsWith("MOD") || s === "M" || s.startsWith("C6")) return "MODIS";
    if (s.startsWith("VII") || s === "V" || s.startsWith("VNP") || s.startsWith("VJ")) return "VIIRS";
  }
  if (sat === "Terra" || sat === "Aqua") return "MODIS";
  if (sat && /NPP|NOAA/.test(sat)) return "VIIRS";
  if (scan != null) return scan >= 0.7 ? "MODIS" : "VIIRS";
  return null;
}

/** Accepts an array, {pixels:[...]}, or a GeoJSON FeatureCollection of points. */
export function normPixels(raw: unknown): PixelDetection[] {
  return list(raw, "px_list")
    .map((f): PixelDetection | null => {
      const o: Raw = isObj(f.properties) ? { ...(f.properties as Raw) } : f;
      if (isObj(f.geometry) && Array.isArray((f.geometry as Raw).coordinates)) {
        const c = (f.geometry as Raw).coordinates as unknown[];
        o.lon ??= c[0];
        o.lat ??= c[1];
      }
      const lon = gnum(o, "px_lon");
      const lat = gnum(o, "px_lat");
      if (lon == null || lat == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
      const sat = satName(get(o, "px_sat"));
      const scan = gnum(o, "px_scan");
      const sensor = sensorOf(get(o, "px_sensor"), sat, scan);
      if (!sensor) return null;
      const track = gnum(o, "px_track");
      const dnRaw = get(o, "px_dn");
      const dnU = typeof dnRaw === "string" ? dnRaw.toUpperCase() : "";
      const dn = dnU.startsWith("N") ? "N" : dnU.startsWith("D") ? "D" : null;
      const d = get(o, "px_date");
      const conf = get(o, "px_conf");
      return {
        lon,
        lat,
        sensor,
        sat,
        date: typeof d === "string" ? d.slice(0, 10) : null,
        dn,
        scan_km: scan != null && scan > 0 && scan < 10 ? scan : NADIR_KM[sensor],
        track_km: track != null && track > 0 && track < 10 ? track : NADIR_KM[sensor],
        frp: gnum(o, "px_frp"),
        conf: typeof conf === "number" ? String(conf) : typeof conf === "string" ? conf : null,
      };
    })
    .filter((x): x is PixelDetection => x != null);
}

/** pixels/index.json: [{region_id, months:["2026-03", ...], subsampled?}] (also {regions:[...]} or {id: [...]}). */
export function normPixelIndex(raw: unknown): PixelIndexEntry[] {
  const rows: Raw[] = Array.isArray(raw)
    ? raw.filter(isObj)
    : isObj(raw)
      ? Array.isArray(raw.regions)
        ? (raw.regions as unknown[]).filter(isObj)
        : Object.entries(raw).map(([k, v]): Raw => (Array.isArray(v) ? { region_id: k, months: v } : isObj(v) ? { region_id: k, ...v } : {}))
      : [];
  return rows
    .map((o) => {
      const id = gstr(o, "region_id");
      const m = get(o, "px_months");
      if (!id || !Array.isArray(m)) return null;
      const months = m
        .map((x) => (typeof x === "string" ? ym({ period: x }) : isObj(x) ? ym(x) : null))
        .filter((x): x is YearMonth => x != null)
        .map((x) => `${x.year}-${String(x.month).padStart(2, "0")}`);
      return { region_id: id, months, subsampled: o.subsampled === true };
    })
    .filter((x): x is PixelIndexEntry => x != null && x.months.length > 0);
}

/**
 * Footprint rectangle in degrees, centered on the detection: scan (cross-track, roughly E-W for
 * polar orbiters) sets the width, track (along-track, roughly N-S) the height.
 */
export function footprintRing(p: PixelDetection): [number, number][] {
  const KM_PER_DEG = 111.32;
  const hw = p.scan_km / (KM_PER_DEG * Math.max(0.05, Math.cos((p.lat * Math.PI) / 180))) / 2;
  const hh = p.track_km / KM_PER_DEG / 2;
  return [
    [p.lon - hw, p.lat - hh],
    [p.lon + hw, p.lat - hh],
    [p.lon + hw, p.lat + hh],
    [p.lon - hw, p.lat + hh],
    [p.lon - hw, p.lat - hh],
  ];
}
