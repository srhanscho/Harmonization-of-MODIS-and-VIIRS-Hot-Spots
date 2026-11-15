/**
 * Pure analytics over the data contract. Shared by the UI and the assistant tools.
 * Null always means "no data / no active sensor" and is never coerced to 0.
 */
import type { CalendarMetric, ClimatologyRow, DisplayMode, MonthlyRow } from "./types";

export const FIRST_YEAR = 2001;
export const VIIRS_START_YEAR = 2012;
export const BASELINE: [number, number] = [2003, 2022];

export const key = (year: number, month: number) => `${year}-${month}`;

export function indexRows(rows: MonthlyRow[]): Map<string, MonthlyRow> {
  const m = new Map<string, MonthlyRow>();
  for (const r of rows) m.set(key(r.year, r.month), r);
  return m;
}

/** Value shown for a row in the given mode. Raw = MODIS until 2011, VIIRS from 2012. */
export function displayValue(row: MonthlyRow | undefined, mode: DisplayMode): number | null {
  if (!row) return null;
  if (mode === "harmonized") return row.harmonized ?? null;
  return row.year < VIIRS_START_YEAR ? (row.raw_modis ?? null) : (row.raw_viirs ?? null);
}

export function rawSensorLabel(year: number): "MODIS" | "VIIRS" {
  return year < VIIRS_START_YEAR ? "MODIS" : "VIIRS";
}

export function yearRange(rows: MonthlyRow[], lastYear?: number): number[] {
  const maxYear = Math.max(lastYear ?? 0, ...rows.map((r) => r.year), FIRST_YEAR);
  const years: number[] = [];
  for (let y = FIRST_YEAR; y <= maxYear; y++) years.push(y);
  return years;
}

export function lastObserved(rows: MonthlyRow[]): { year: number; month: number } | null {
  let best: MonthlyRow | null = null;
  for (const r of rows) {
    if (r.harmonized == null && r.raw_modis == null && r.raw_viirs == null) continue;
    if (!best || r.year * 12 + r.month > best.year * 12 + best.month) best = r;
  }
  return best ? { year: best.year, month: best.month } : null;
}

/** Percentile rank (0..100) of `value` within `sample` (mid-rank method). */
export function percentileRank(value: number, sample: number[]): number | null {
  if (sample.length === 0) return null;
  let below = 0;
  let equal = 0;
  for (const s of sample) {
    if (s < value) below++;
    else if (s === value) equal++;
  }
  return ((below + 0.5 * equal) / sample.length) * 100;
}

export function baselineSample(rows: MonthlyRow[], month: number): number[] {
  return rows
    .filter((r) => r.month === month && r.year >= BASELINE[0] && r.year <= BASELINE[1] && r.harmonized != null)
    .map((r) => r.harmonized as number);
}

export interface Anomaly {
  year: number;
  month: number;
  value: number | null;
  median: number | null;
  diff: number | null;
  diffPct: number | null;
  percentile: number | null;
  nYears: number;
}

export function anomaly(
  rows: MonthlyRow[],
  clim: ClimatologyRow[] | null,
  year: number,
  month: number,
): Anomaly {
  const row = rows.find((r) => r.year === year && r.month === month);
  const value = row?.harmonized ?? null;
  const c = clim?.find((x) => x.month === month);
  const sample = baselineSample(rows, month);
  const median = c?.median ?? null;
  const diff = value != null && median != null ? value - median : null;
  return {
    year,
    month,
    value,
    median,
    diff,
    diffPct: diff != null && median ? (diff / median) * 100 : null,
    percentile: value != null ? percentileRank(value, sample) : null,
    nYears: c?.n_years ?? sample.length,
  };
}

export function peakMonth(clim: ClimatologyRow[] | null): number | null {
  if (!clim || clim.length === 0) return null;
  let best: ClimatologyRow | null = null;
  for (const c of clim) if (c.median != null && (!best || (c.median ?? 0) > (best.median ?? 0))) best = c;
  return best?.month ?? null;
}

/** Months whose climatological mean is >= 10% of the annual climatological total. */
export function seasonMonths(clim: ClimatologyRow[] | null): number[] {
  if (!clim || clim.length === 0) return [];
  const total = clim.reduce((s, c) => s + (c.mean ?? 0), 0);
  if (total <= 0) return [];
  return clim.filter((c) => (c.mean ?? 0) >= 0.1 * total).map((c) => c.month).sort((a, b) => a - b);
}

export interface YearTotal {
  year: number;
  total: number | null;
  months: number;
}

export function yearTotals(rows: MonthlyRow[], years: number[], mode: DisplayMode): YearTotal[] {
  const idx = indexRows(rows);
  return years.map((year) => {
    let total = 0;
    let months = 0;
    for (let m = 1; m <= 12; m++) {
      const v = displayValue(idx.get(key(year, m)), mode);
      if (v != null) {
        total += v;
        months++;
      }
    }
    return { year, total: months > 0 ? total : null, months };
  });
}

export function monthTotals(rows: MonthlyRow[], years: number[], mode: DisplayMode): (number | null)[] {
  const idx = indexRows(rows);
  const out: (number | null)[] = [];
  for (let m = 1; m <= 12; m++) {
    let total = 0;
    let n = 0;
    for (const y of years) {
      const v = displayValue(idx.get(key(y, m)), mode);
      if (v != null) {
        total += v;
        n++;
      }
    }
    out.push(n > 0 ? total : null);
  }
  return out;
}

/** Record year: highest annual total among complete years (a partial year counts only if it already beats them). */
export function recordYear(totals: YearTotal[]): YearTotal | null {
  const complete = totals.filter((t) => t.months === 12 && t.total != null);
  let best = complete.reduce<YearTotal | null>((b, t) => (!b || (t.total ?? 0) > (b.total ?? 0) ? t : b), null);
  for (const t of totals) {
    if (t.months < 12 && t.total != null && (!best || t.total > (best.total ?? 0))) best = t;
  }
  return best;
}

export interface RankEntry {
  year: number;
  value: number;
}

/** Rank of (year, month) among the same calendar month of all years (1 = highest). */
export function sameMonthRanking(rows: MonthlyRow[], month: number, mode: DisplayMode = "harmonized") {
  const entries: RankEntry[] = rows
    .filter((r) => r.month === month)
    .map((r) => ({ year: r.year, value: displayValue(r, mode) }))
    .filter((e): e is RankEntry => e.value != null)
    .sort((a, b) => b.value - a.value);
  return entries;
}

export type Satellite = "Terra" | "Aqua" | "S-NPP" | "NOAA-20";

/** Satellites with an active fire product for a given month (known mission dates). */
export function activeSatellites(year: number, month: number): { name: Satellite; note?: string }[] {
  const t = year * 12 + (month - 1);
  const at = (y: number, m: number) => y * 12 + (m - 1);
  const out: { name: Satellite; note?: string }[] = [];
  if (t >= at(2000, 11)) out.push({ name: "Terra" });
  if (t >= at(2002, 7)) out.push({ name: "Aqua" });
  if (t >= at(2012, 1) && t <= at(2026, 11)) {
    out.push(t === at(2026, 11) ? { name: "S-NPP", note: "until Nov 2" } : { name: "S-NPP" });
  }
  if (t >= at(2018, 1)) out.push({ name: "NOAA-20" });
  return out;
}

export function regimeFor(year: number, month: number): "R1" | "R2" | "R3" | null {
  const t = year * 12 + month;
  if (t < 2000 * 12 + 11) return null;
  if (t < 2002 * 12 + 7) return "R1";
  if (year < 2012) return "R2";
  return "R3";
}

export const fmt = (v: number | null | undefined, digits = 0): string =>
  v == null || Number.isNaN(v)
    ? "—"
    : v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const fmtSigned = (v: number | null | undefined, digits = 0): string =>
  v == null || Number.isNaN(v) ? "—" : `${v >= 0 ? "+" : "−"}${fmt(Math.abs(v), digits)}`;

export function ordinal(n: number, lang: "en" | "es"): string {
  if (lang === "es") return `${n}.º`;
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Value shown by the calendar for a metric. Activity/FRP follow Raw/Harmonized; HFAI z does not. */
export function metricValue(row: MonthlyRow | undefined, metric: CalendarMetric, mode: DisplayMode): number | null {
  if (!row) return null;
  if (metric === "activity") return displayValue(row, mode);
  if (metric === "anomaly") return row.z ?? null;
  if (mode === "harmonized") return row.frp_harmonized ?? null;
  return row.year < VIIRS_START_YEAR ? (row.frp_raw_modis ?? null) : (row.frp_raw_viirs ?? null);
}

/** True when at least one published row carries the metric (otherwise the UI disables it). */
export function hasMetric(rows: MonthlyRow[] | null, metric: CalendarMetric): boolean {
  if (!rows) return false;
  if (metric === "activity") return true;
  if (metric === "anomaly") return rows.some((r) => r.z != null);
  return rows.some((r) => r.frp_harmonized != null || r.frp_raw_modis != null || r.frp_raw_viirs != null);
}

export const ymKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;
