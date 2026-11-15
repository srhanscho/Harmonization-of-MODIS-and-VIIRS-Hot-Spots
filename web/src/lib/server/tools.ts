import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getClimate, getClimatology, getForecast, getMonthly, getOni, getRanking, getRegions, getValidation } from "./data";
import { ALERT_THRESHOLDS } from "../contract";
import { anomaly, displayValue, sameMonthRanking } from "../series";
import type { DisplayMode } from "../types";

export const UNIT = "fire cell-days (1 km cell x day x day/night x satellite with >=1 detection)";
const HARM = "VIIRS S-NPP equivalent (estimated)";
export const EXPERIMENTAL = "Experimental - statistical outlook, not an operational warning";

const ym = { type: "string", description: "Year-month YYYY-MM, e.g. 2014-03" } as const;

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "list_regions",
    description:
      "List available regions (id, name, country). Use it to resolve a place name the user mentions to a region_id before calling other tools.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { country: { anyOf: [{ type: "string" }, { type: "null" }], description: "Optional ISO2 country code filter, e.g. CO or AR" } },
      required: ["country"],
      additionalProperties: false,
    },
  },
  {
    name: "get_monthly_series",
    description:
      "Monthly fire activity for one region between start and end (inclusive). mode='harmonized' returns estimated VIIRS S-NPP equivalents with p5-p95 band, plus HFAI z (anomaly z-score) and z_class (below|normal|moderate|critical) and harmonized FRP in MW when published; mode='raw' returns observed counts (MODIS until 2011, VIIRS from 2012). Null means no data / no active sensor, never zero.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        region_id: { type: "string" },
        start: ym,
        end: ym,
        mode: { type: "string", enum: ["raw", "harmonized"] },
      },
      required: ["region_id", "start", "end", "mode"],
      additionalProperties: false,
    },
  },
  {
    name: "get_anomaly",
    description:
      "Harmonized value of one month vs its 2003-2022 baseline: value, median, difference, percentile within the baseline, number of baseline years, rank among the same calendar month of all years, and the HFAI anomaly z with its class (below z<-0.5, normal -0.5..1, moderate 1..2, critical >2) when published.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        region_id: { type: "string" },
        year: { type: "integer" },
        month: { type: "integer", description: "1-12" },
      },
      required: ["region_id", "year", "month"],
      additionalProperties: false,
    },
  },
  {
    name: "get_ranking",
    description:
      "Rank regions for one month by harmonized activity ('activity') or by percentile anomaly vs baseline ('anomaly'). Returns the top N.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string", enum: ["activity", "anomaly"] },
        year: { type: "integer" },
        month: { type: "integer", description: "1-12" },
        top: { type: "integer", description: "1-20" },
      },
      required: ["metric", "year", "month", "top"],
      additionalProperties: false,
    },
  },
  {
    name: "get_validation",
    description:
      "Validation metrics of the harmonization method: leave-one-year-out MAPE (fractions, 1.0 = 100%) raw vs harmonized and correlation r for 2012-2019, plus the 2012 seam ratio raw vs harmonized.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "get_ranking_fsi",
    description:
      "Top fire clusters of one country and month by Fire Severity Index (composite, 0-100; 45% FRP on log scale, 35% extent in 0.1 deg cells, 20% longest run of days, relative to that month's clusters). Returns rank, fsi, frp_mw, cells, days, admin1_name, centroid. Published only for the last 36 months. Never convert to hectares.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        country: { type: "string", description: "ISO2 country code, CO or AR" },
        year: { type: "integer" },
        month: { type: "integer", description: "1-12" },
        top: { type: "integer", description: "1-20" },
      },
      required: ["country", "year", "month", "top"],
      additionalProperties: false,
    },
  },
  {
    name: "get_forecast",
    description:
      "Experimental statistical outlook for one region: model name, backtest metrics (model fitted on 2001-2015, tested from 2016: MAPE fraction and 80% interval coverage) and the next 3 months (expected harmonized value with 80% range, probability that HFAI z exceeds 1 and 2, alert yellow/red per report thresholds). The only source of forward-looking numbers.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { region_id: { type: "string" } },
      required: ["region_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_climate_link",
    description:
      "Ocean-climate context for one region: correlation between the Oceanic Nino Index (ONI, NOAA CPC) and monthly HFAI z (best lag in months, r, p, n), mean z in El Nino / La Nina / neutral months, monthly mean wind climatology, and optionally the ONI value and ENSO phase for a given month. Correlation, not causation.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        region_id: { type: "string" },
        year: { anyOf: [{ type: "integer" }, { type: "null" }] },
        month: { anyOf: [{ type: "integer" }, { type: "null" }], description: "1-12" },
      },
      required: ["region_id", "year", "month"],
      additionalProperties: false,
    },
  },
  {
    name: "set_view",
    description:
      "Change what the user's screen shows: select a region, display mode and the focused month (end, or start if end is null). Call it whenever your answer is about a specific region/month so the calendar follows along.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        region_id: { type: "string" },
        start: { anyOf: [ym, { type: "null" }] },
        end: { anyOf: [ym, { type: "null" }] },
        mode: { anyOf: [{ type: "string", enum: ["raw", "harmonized"] }, { type: "null" }] },
      },
      required: ["region_id", "start", "end", "mode"],
      additionalProperties: false,
    },
  },
];

export interface ViewPatch {
  region_id?: string;
  mode?: DisplayMode;
  year?: number;
  month?: number;
}

type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : NaN);
const parseYm = (s: unknown) => {
  const m = /^(\d{4})-(\d{2})$/.exec(str(s));
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
};
const noData = (what: string) => ({ no_data: true, message: `No data available for ${what}.` });

export async function runTool(name: string, input: Input): Promise<{ result: unknown; patch?: ViewPatch }> {
  switch (name) {
    case "list_regions": {
      const regions = await getRegions();
      if (!regions) return { result: noData("regions") };
      const c = str(input.country).toUpperCase();
      return { result: regions.filter((r) => !c || r.country === c).map(({ id, name, country }) => ({ id, name, country })) };
    }
    case "get_monthly_series": {
      const id = str(input.region_id);
      const rows = await getMonthly(id);
      const s = parseYm(input.start);
      const e = parseYm(input.end);
      if (!rows || !s || !e) return { result: noData(`region ${id}`) };
      const mode: DisplayMode = input.mode === "raw" ? "raw" : "harmonized";
      const lo = s.year * 12 + s.month;
      const hi = e.year * 12 + e.month;
      const sel = rows
        .filter((r) => r.year * 12 + r.month >= lo && r.year * 12 + r.month <= hi)
        .sort((a, b) => a.year - b.year || a.month - b.month)
        .slice(0, 240)
        .map((r) => ({
          period: `${r.year}-${String(r.month).padStart(2, "0")}`,
          value: displayValue(r, mode),
          ...(mode === "harmonized"
            ? { p5: r.harmonized_p5, p95: r.harmonized_p95, source: r.source, factor: r.factor, frp_mw: r.frp_harmonized ?? null }
            : { sensor: r.year < 2012 ? "MODIS" : "VIIRS" }),
          regime: r.regime,
          z: r.z ?? null,
          z_class: r.z_class ?? null,
        }));
      if (sel.length === 0) return { result: noData(`${id} ${input.start}..${input.end}`) };
      return {
        result: {
          region_id: id,
          mode,
          unit: mode === "harmonized" ? `${UNIT}, ${HARM}` : `${UNIT}, observed`,
          z_note: "z = HFAI anomaly z-score (log1p, per-sensor baseline); null if not published",
          rows: sel,
        },
      };
    }
    case "get_anomaly": {
      const id = str(input.region_id);
      const year = int(input.year);
      const month = int(input.month);
      const [rows, clim] = await Promise.all([getMonthly(id), getClimatology(id)]);
      if (!rows) return { result: noData(`region ${id}`) };
      const a = anomaly(rows, clim, year, month);
      if (a.value == null) return { result: noData(`${id} ${year}-${month}`) };
      const ranking = sameMonthRanking(rows, month);
      const c = clim?.find((x) => x.month === month);
      const row = rows.find((r) => r.year === year && r.month === month);
      return {
        result: {
          region_id: id,
          period: `${year}-${String(month).padStart(2, "0")}`,
          mode: "harmonized",
          unit: `${UNIT}, ${HARM}`,
          z: row?.z ?? null,
          z_class: row?.z_class ?? null,
          value: round(a.value),
          baseline: "2003-2022",
          median: round(a.median),
          p10: round(c?.p10 ?? null),
          p90: round(c?.p90 ?? null),
          diff_vs_median: round(a.diff),
          diff_pct: round(a.diffPct),
          percentile: round(a.percentile),
          n_years: a.nYears,
          rank_same_month: ranking.findIndex((r) => r.year === year) + 1,
          years_ranked: ranking.length,
        },
      };
    }
    case "get_ranking": {
      const year = int(input.year);
      const month = int(input.month);
      const top = Math.min(20, Math.max(1, int(input.top) || 5));
      const regions = await getRegions();
      if (!regions) return { result: noData("regions") };
      const out = [];
      for (const r of regions) {
        const [rows, clim] = await Promise.all([getMonthly(r.id), getClimatology(r.id)]);
        if (!rows) continue;
        const a = anomaly(rows, clim, year, month);
        if (a.value == null) continue;
        const zr = rows.find((x) => x.year === year && x.month === month);
        out.push({ region_id: r.id, name: r.name, value: round(a.value), percentile: round(a.percentile), median: round(a.median), z: zr?.z ?? null, z_class: zr?.z_class ?? null });
      }
      if (out.length === 0) return { result: noData(`${year}-${month}`) };
      out.sort((x, y) => (input.metric === "anomaly" ? (y.percentile ?? -1) - (x.percentile ?? -1) : (y.value ?? 0) - (x.value ?? 0)));
      return {
        result: {
          metric: input.metric,
          period: `${year}-${String(month).padStart(2, "0")}`,
          mode: "harmonized",
          unit: `${UNIT}, ${HARM}`,
          note: "Includes national and admin-1 regions; they overlap.",
          ranking: out.slice(0, top),
        },
      };
    }
    case "get_validation": {
      const v = await getValidation();
      return { result: v ?? noData("validation metrics") };
    }
    case "get_ranking_fsi": {
      const country = str(input.country).toUpperCase();
      const year = int(input.year);
      const month = int(input.month);
      const top = Math.min(20, Math.max(1, int(input.top) || 5));
      const clusters = await getRanking(country, year, month);
      if (!clusters) return { result: noData(`FSI ranking ${country} ${year}-${month} (published for the last 36 months only)`) };
      return {
        result: {
          country,
          period: `${year}-${String(month).padStart(2, "0")}`,
          index: "Fire Severity Index (composite, 0-100). Relative to that month's clusters; not burned area.",
          clusters: clusters.slice(0, top).map((c) => ({
            rank: c.rank,
            fsi: round(c.fsi),
            frp_mw: round(c.frp_mw),
            cells: c.cells,
            days: c.days,
            admin1_name: c.admin1_name,
            centroid: c.centroid,
          })),
        },
      };
    }
    case "get_forecast": {
      const id = str(input.region_id);
      const f = await getForecast(id);
      if (!f) return { result: noData(`forecast ${id}`) };
      return {
        result: {
          region_id: id,
          label: EXPERIMENTAL,
          model: f.model,
          unit: `${UNIT}, ${HARM}`,
          backtest: {
            train_end: f.metrics.train_end ? `${f.metrics.train_end.year}-${String(f.metrics.train_end.month).padStart(2, "0")}` : null,
            mape_fraction: f.metrics.mape,
            interval: f.metrics.interval,
            interval_coverage: f.metrics.coverage,
            n_test_months: f.metrics.n_test ?? f.backtest.length,
          },
          alert_rule: `yellow if P(z>1) > ${ALERT_THRESHOLDS.yellow}, red if P(z>2) > ${ALERT_THRESHOLDS.red}`,
          outlook: f.outlook.map((o) => ({
            period: `${o.year}-${String(o.month).padStart(2, "0")}`,
            expected: round(o.predicted),
            lo: round(o.lo),
            hi: round(o.hi),
            p_z_above_1: o.p_above_z1,
            p_z_above_2: o.p_above_z2,
            alert: o.alert ?? "none",
          })),
        },
      };
    }
    case "get_climate_link": {
      const id = str(input.region_id);
      const [c, oni] = await Promise.all([getClimate(id), getOni()]);
      const year = int(input.year);
      const month = int(input.month);
      const at = Number.isInteger(year) && Number.isInteger(month) ? oni?.find((o) => o.year === year && o.month === month) : undefined;
      if (!c && !at) return { result: noData(`climate link ${id}`) };
      return {
        result: {
          region_id: id,
          note: "Correlation between ONI and monthly HFAI z; association, not causation. r^2 = share of variance explained.",
          enso: c?.enso ?? null,
          wind_climatology: c?.wind.length ? c.wind : null,
          wind_units: "speed m/s at 10 m; direction in degrees the wind blows FROM",
          oni_at_month: at ? { period: `${at.year}-${String(at.month).padStart(2, "0")}`, oni: at.oni, phase: at.phase } : null,
        },
      };
    }
    case "set_view": {
      const id = str(input.region_id);
      const regions = await getRegions();
      if (!regions?.some((r) => r.id === id)) return { result: { ok: false, message: `Unknown region_id ${id}` } };
      const focus = parseYm(input.end) ?? parseYm(input.start);
      const patch: ViewPatch = { region_id: id };
      if (input.mode === "raw" || input.mode === "harmonized") patch.mode = input.mode;
      if (focus && focus.month >= 1 && focus.month <= 12) {
        patch.year = focus.year;
        patch.month = focus.month;
      }
      return { result: { ok: true, applied: patch }, patch };
    }
    default:
      return { result: { error: `Unknown tool ${name}` } };
  }
}

function round(v: number | null | undefined): number | null {
  return v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10;
}
