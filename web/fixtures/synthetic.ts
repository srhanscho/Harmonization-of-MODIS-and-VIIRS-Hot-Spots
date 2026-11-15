/**
 * DEVELOPMENT-ONLY synthetic fixture.
 *
 * Loaded only when NEXT_PUBLIC_USE_FIXTURE=1 in a non-production build.
 * Every value here is SIMULATED and deterministic (seeded PRNG). It exists
 * only so the UI can be developed before the pipeline publishes real data
 * in public/data/. The UI shows a persistent red banner whenever it is used.
 */
import type {
  CellRow,
  ClimatologyRow,
  Meta,
  MonthlyRow,
  Region,
  Validation,
} from "../src/lib/types";

const LAST = { year: 2026, month: 10 };

export const fixtureRegions: Region[] = [
  { id: "CO", name: "Colombia", country: "CO", bbox: [-79.1, -4.3, -66.8, 12.5] },
  { id: "CO-VID", name: "Vichada", country: "CO", bbox: [-71.1, 2.6, -67.4, 6.4] },
  { id: "CO-MET", name: "Meta", country: "CO", bbox: [-74.9, 1.6, -71.1, 4.9] },
  { id: "CO-CAS", name: "Casanare", country: "CO", bbox: [-73.1, 4.3, -69.8, 6.4] },
  { id: "DEMO-SNSM", name: "Sierra Nevada de Santa Marta", country: "CO", bbox: [-74.3, 10.4, -73.0, 11.4] },
  { id: "AR", name: "Argentina", country: "AR", bbox: [-73.6, -55.1, -53.6, -21.8] },
  { id: "AR-LR", name: "La Rioja", country: "AR", bbox: [-69.7, -32.0, -65.4, -27.8] },
  { id: "AR-COR", name: "Córdoba", country: "AR", bbox: [-65.8, -35.0, -61.8, -29.5] },
  { id: "DEMO-CHILECITO", name: "Chilecito (La Rioja)", country: "AR", bbox: [-68.3, -29.6, -67.0, -28.6] },
];

interface Profile {
  base: number;
  peak: number; // calendar month of peak (1..12)
  width: number; // seasonal width in months
  trend: number; // relative change per year
  k: number; // VIIRS / Aqua ratio
}

const PROFILES: Record<string, Profile> = {
  CO: { base: 9000, peak: 2, width: 1.6, trend: 0.004, k: 4.1 },
  "CO-VID": { base: 3200, peak: 2, width: 1.3, trend: 0.006, k: 4.0 },
  "CO-MET": { base: 1400, peak: 2, width: 1.4, trend: 0.002, k: 3.8 },
  "CO-CAS": { base: 1700, peak: 2, width: 1.2, trend: 0.003, k: 3.9 },
  "DEMO-SNSM": { base: 260, peak: 3, width: 1.1, trend: 0.01, k: 4.4 },
  AR: { base: 7000, peak: 9, width: 2.0, trend: -0.002, k: 3.6 },
  "AR-LR": { base: 380, peak: 8, width: 1.5, trend: 0.004, k: 3.4 },
  "AR-COR": { base: 900, peak: 8, width: 1.6, trend: 0.0, k: 3.5 },
  "DEMO-CHILECITO": { base: 70, peak: 8, width: 1.4, trend: 0.006, k: 3.3 },
};

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seasonal(month: number, p: Profile): number {
  const d = Math.min(Math.abs(month - p.peak), 12 - Math.abs(month - p.peak));
  return 0.04 + Math.exp(-(d * d) / (2 * p.width * p.width));
}

const round1 = (v: number) => Math.round(v * 10) / 10;

const monthlyCache = new Map<string, MonthlyRow[] | null>();
const frpCalCache = new Map<string, { alpha: number; beta: number; n: number }>();

/** Harmonized on the VIIRS S-NPP scale (report Eq. 3): gamma*MODIS before 2012, 50/50 blend after. */
export function fixtureMonthly(regionId: string): MonthlyRow[] | null {
  if (monthlyCache.has(regionId)) return monthlyCache.get(regionId) ?? null;
  const rows = buildMonthly(regionId);
  monthlyCache.set(regionId, rows);
  return rows;
}

function buildMonthly(regionId: string): MonthlyRow[] | null {
  const p = PROFILES[regionId];
  if (!p) return null;
  const rnd = mulberry32(hash(regionId));
  const yearShock: Record<number, number> = {};
  for (let y = 2000; y <= LAST.year; y++) yearShock[y] = 0.65 + rnd() * 0.8;
  // Notable simulated events used by the demo flow.
  if (regionId === "CO-VID") yearShock[2026] = 1.25;
  if (regionId === "DEMO-CHILECITO") yearShock[2026] = 1.1;

  const W = 0.5;
  const BETA = 0.93;
  const frpPairs: { m: number; v: number }[] = [];
  const rows: MonthlyRow[] = [];
  for (let y = 2000; y <= LAST.year; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2000 && m < 11) continue;
      if (y === LAST.year && m > LAST.month) continue;
      let truth = p.base * seasonal(m, p) * yearShock[y] * (1 + p.trend * (y - 2010)) * (0.75 + rnd() * 0.5);
      if (regionId === "CO-VID" && y === 2026 && m === 3) truth *= 2.1;
      if (regionId === "DEMO-CHILECITO" && y === 2026 && m === 7) truth *= 3.2;

      const terraOnly = y < 2002 || (y === 2002 && m < 7);
      const viirsEra = y >= 2012;
      const noaa20Era = y > 2026 || (y === 2026 && m >= 11);
      const regime = terraOnly ? "R1" : viirsEra ? "R3" : "R2";
      const aqua = truth * (0.95 + rnd() * 0.1);
      const terra = truth * 0.82 * (0.95 + rnd() * 0.1);
      const raw_modis = Math.round(terraOnly ? terra : aqua + terra);
      const k = p.k * (0.93 + rnd() * 0.14);
      const raw_viirs = viirsEra ? Math.round(truth * k) : null;
      // FRP sums (MW): MODIS sees fewer, larger-footprint detections than VIIRS.
      const frp_raw_modis = round1(raw_modis * (28 + rnd() * 14));
      const frp_raw_viirs = raw_viirs != null ? round1(raw_viirs * (7 + rnd() * 4)) : null;
      if (viirsEra && y <= 2019 && frp_raw_viirs) frpPairs.push({ m: frp_raw_modis, v: frp_raw_viirs });

      const aquaEq = terraOnly ? terra / 0.82 : aqua;
      const factor = p.k;
      let harmonized: number;
      let source: string;
      if (!viirsEra) {
        harmonized = p.k * aquaEq;
        source = terraOnly ? "MODIS_TERRA" : "MODIS_AQUA";
      } else {
        harmonized = W * (p.k * aquaEq) + (1 - W) * (raw_viirs as number);
        source = noaa20Era ? "VIIRS_NOAA20" : "BLEND_AQUA_SNPP";
      }
      const spread = viirsEra ? 0.08 : terraOnly ? 0.15 : 0.1;
      rows.push({
        year: y,
        month: m,
        raw_modis,
        raw_viirs,
        harmonized: round1(harmonized),
        harmonized_p5: round1(harmonized * (1 - spread)),
        harmonized_p95: round1(harmonized * (1 + spread)),
        source,
        factor: Math.round(factor * 100) / 100,
        regime,
        frp_raw_modis,
        frp_raw_viirs,
      });
    }
  }

  // Eq. 2 power law on the overlap (log-space least squares for alpha, beta fixed).
  const lnAlpha = frpPairs.reduce((s, q) => s + Math.log(q.v) - BETA * Math.log(q.m), 0) / Math.max(1, frpPairs.length);
  const alpha = Math.exp(lnAlpha);
  frpCalCache.set(regionId, { alpha, beta: BETA, n: frpPairs.length });
  for (const r of rows) {
    const hat = alpha * Math.pow(r.frp_raw_modis ?? 0, BETA);
    r.frp_harmonized = round1(r.year < 2012 || r.frp_raw_viirs == null ? hat : W * hat + (1 - W) * r.frp_raw_viirs);
  }

  // Eq. 4 on log1p with a 2003-2022 baseline per calendar month.
  for (let m = 1; m <= 12; m++) {
    const base = rows
      .filter((r) => r.month === m && r.year >= 2003 && r.year <= 2022 && r.harmonized != null)
      .map((r) => Math.log1p(r.harmonized as number));
    const mu = base.reduce((s, v) => s + v, 0) / base.length;
    const sd = Math.sqrt(base.reduce((s, v) => s + (v - mu) ** 2, 0) / Math.max(1, base.length - 1));
    for (const r of rows) {
      if (r.month !== m || r.harmonized == null) continue;
      const z = Math.round(((Math.log1p(r.harmonized) - mu) / (sd + 1e-5)) * 100) / 100;
      r.z = z;
      r.z_class = z < -0.5 ? "below" : z <= 1 ? "normal" : z <= 2 ? "moderate" : "critical";
    }
  }
  return rows;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function fixtureClimatology(regionId: string): ClimatologyRow[] | null {
  const rows = fixtureMonthly(regionId);
  if (!rows) return null;
  const out: ClimatologyRow[] = [];
  for (let m = 1; m <= 12; m++) {
    const vals = rows
      .filter((r) => r.month === m && r.year >= 2003 && r.year <= 2022 && r.harmonized != null)
      .map((r) => r.harmonized as number)
      .sort((a, b) => a - b);
    out.push({
      month: m,
      median: round1(quantile(vals, 0.5)),
      p10: round1(quantile(vals, 0.1)),
      p90: round1(quantile(vals, 0.9)),
      mean: round1(vals.reduce((s, v) => s + v, 0) / vals.length),
      n_years: vals.length,
    });
  }
  return out;
}

/* ---------- Dense 0.1° cells (every land cell with activity), SIMULATED ---------- */

// Coarse country outlines (lon, lat), only to keep simulated cells on land.
const LAND: Record<string, [number, number][]> = {
  CO: [
    [-77.9, 7.2], [-77.3, 8.6], [-76.2, 9.4], [-75.6, 10.6], [-74.8, 11.1], [-73.3, 11.3], [-72.2, 12.0], [-71.3, 12.4],
    [-71.1, 11.6], [-72.2, 11.1], [-72.9, 10.4], [-73.1, 9.2], [-72.7, 8.3], [-72.4, 7.4], [-71.0, 7.0], [-70.1, 6.9],
    [-69.4, 6.1], [-67.8, 6.2], [-67.5, 5.5], [-67.8, 4.4], [-67.3, 3.4], [-67.8, 2.8], [-67.2, 2.0], [-67.0, 1.2],
    [-69.4, 1.1], [-69.8, 1.7], [-69.9, 0.6], [-70.0, -0.1], [-69.6, -0.6], [-69.4, -1.2], [-69.9, -4.2], [-70.6, -3.8],
    [-71.6, -2.4], [-72.9, -2.4], [-73.6, -1.2], [-75.2, -0.1], [-77.4, 0.4], [-78.8, 1.4], [-78.6, 2.6], [-77.4, 4.0],
    [-77.3, 5.6], [-77.9, 7.2],
  ],
  AR: [
    [-65.7, -22.1], [-64.4, -22.8], [-62.8, -22.0], [-61.0, -23.8], [-57.6, -25.5], [-54.6, -25.6], [-53.7, -26.1],
    [-53.8, -27.1], [-55.7, -27.9], [-57.6, -30.2], [-58.2, -32.5], [-58.4, -34.0], [-57.2, -35.3], [-56.7, -36.4],
    [-57.7, -38.2], [-62.3, -38.8], [-62.1, -40.6], [-65.0, -40.9], [-63.8, -42.0], [-64.6, -42.9], [-65.4, -45.0],
    [-67.6, -46.5], [-65.9, -48.0], [-68.4, -50.1], [-69.1, -51.6], [-68.6, -52.3], [-71.9, -52.0], [-72.3, -51.4],
    [-73.2, -50.0], [-72.5, -48.0], [-71.7, -44.0], [-71.5, -42.0], [-71.9, -40.0], [-71.1, -37.5], [-70.6, -35.0],
    [-70.0, -33.0], [-70.3, -31.0], [-69.6, -28.5], [-68.6, -27.0], [-68.3, -25.0], [-67.3, -24.0], [-67.0, -22.8],
    [-65.7, -22.1],
  ],
};

function inPoly(poly: [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const g2 = (dx: number, dy: number) => Math.exp(-(dx * dx + dy * dy) / 2);

/** Fire-proneness of a location: savanna and dry-forest belts high, Andes and Patagonia low. */
function proneness(lon: number, lat: number, country: string): number {
  const tex = 0.7 + 0.3 * Math.sin(lon * 7.3 + lat * 3.1) * Math.cos(lat * 5.7 - lon * 2.3);
  if (country === "CO") {
    const llanos = g2((lon + 70) / 2.8, (lat - 5) / 1.7);
    const amazon = 0.42 * g2((lon + 72) / 4, lat / 2.4);
    const caribe = 0.4 * g2((lon + 74.6) / 1.4, (lat - 9.6) / 1.1);
    const snsm = 0.5 * g2((lon + 73.7) / 0.5, (lat - 10.9) / 0.4);
    const andes = Math.max(0, 1 - Math.abs(lon + 75.3 - 0.25 * (lat - 4)) / 1.3);
    return Math.max(0.015, (0.05 + llanos + amazon + caribe + snsm) * (1 - 0.75 * andes)) * tex;
  }
  const chaco = g2((lon + 62.5) / 2.4, (lat + 25) / 2.6);
  const nw = 0.65 * g2((lon + 66.5) / 1.6, (lat + 28.5) / 3);
  const pampa = 0.3 * g2((lon + 61.5) / 3, (lat + 34) / 2.6);
  const delta = 0.55 * g2((lon + 59.2) / 0.9, (lat + 33.3) / 0.9);
  const south = lat < -40 ? 0.25 : 1;
  return Math.max(0.01, (0.04 + chaco + nw + pampa + delta) * south) * tex;
}

const landCache = new Map<string, { lon: number; lat: number; w: number }[]>();

/** Every 0.1° land cell of a region's country inside the region bbox, with its proneness weight. */
function landCells(regionId: string): { lon: number; lat: number; w: number }[] | null {
  const cached = landCache.get(regionId);
  if (cached) return cached;
  const region = fixtureRegions.find((r) => r.id === regionId);
  const poly = region ? LAND[region.country] : undefined;
  if (!region || !poly) return null;
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  const out: { lon: number; lat: number; w: number }[] = [];
  for (let x = Math.floor(minLon * 10); x < Math.ceil(maxLon * 10); x++) {
    for (let y = Math.floor(minLat * 10); y < Math.ceil(maxLat * 10); y++) {
      const lon = round2(x / 10 + 0.05);
      const lat = round2(y / 10 + 0.05);
      if (inPoly(poly, lon, lat)) out.push({ lon, lat, w: proneness(lon, lat, region.country) });
    }
  }
  landCache.set(regionId, out);
  return out;
}

/** Cheap deterministic noise in [0, 1) for a cell and month. */
function noise(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Dense cells: the region's monthly harmonized total spread over its land cells by proneness,
 * with month-to-month noise and patchy zeros where fire is rare. `median` is the cell's normal
 * for that calendar month (same spread of the region climatology, without noise).
 */
export function fixtureCells(regionId: string, year: number): CellRow[] | null {
  const land = landCells(regionId);
  const monthly = fixtureMonthly(regionId);
  const clim = fixtureClimatology(regionId);
  if (!land || !monthly) return null;
  const wsum = land.reduce((s, c) => s + c.w, 0) || 1;
  const wmax = Math.max(...land.map((c) => c.w), 1e-6);
  const out: CellRow[] = [];
  for (const row of monthly.filter((r) => r.year === year)) {
    if (row.harmonized == null) continue;
    const med = clim?.find((c) => c.month === row.month)?.median ?? null;
    for (const c of land) {
      const ix = Math.round(c.lon * 10);
      const iy = Math.round(c.lat * 10);
      // Spatially smooth month-to-month field (fire fronts cluster) plus a little per-cell jitter.
      const ph = year * 1.7 + row.month * 0.9;
      const smooth = 0.5 + 0.5 * Math.sin(c.lon * 2.1 + ph) * Math.cos(c.lat * 2.6 - ph * 0.7);
      const u = 0.55 * smooth + 0.45 * noise(ix, iy, year * 12 + row.month);
      if (u < 0.75 * (1 - c.w / wmax) ** 1.2) continue; // patchy where fire is rare
      const share = c.w / wsum;
      const v = row.harmonized * share * Math.exp(2.2 * (smooth - 0.5) + 0.6 * (noise(iy, ix, year * 31 + row.month) - 0.5));
      if (v < 0.005) continue;
      out.push({
        cell: `0.1_${c.lon}_${c.lat}`,
        lat: c.lat,
        lon: c.lon,
        year,
        month: row.month,
        harmonized: Math.round(v * 1000) / 1000,
        median: med != null ? Math.round(med * share * 1000) / 1000 : null,
      });
    }
  }
  return out;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export const fixtureValidation: Omit<Validation, "frp_calibration"> & { frp_calibration: unknown } = {
  loyo: [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019].map((year, i) => ({
    year,
    mape_raw: Math.round((2.9 + ((i * 37) % 7) / 10) * 100) / 100,
    mape_harmonized: Math.round((0.12 + ((i * 13) % 9) / 100) * 100) / 100,
    r: Math.round((0.9 + ((i * 7) % 6) / 100) * 100) / 100,
  })),
  seam_2012: { raw_ratio: 4.3, harmonized_ratio: 1.04 },
  // Raw pipeline shape (object keyed by region id); normalized by lib/contract.ts.
  get frp_calibration() {
    const out: Record<string, { alpha: number; beta: number; r2: number; n: number }> = {};
    for (const r of fixtureRegions) {
      fixtureMonthly(r.id);
      const c = frpCalCache.get(r.id);
      if (c) out[r.id] = { alpha: Math.round(c.alpha * 1000) / 1000, beta: c.beta, r2: Math.round((0.78 + (hash(r.id) % 17) / 100) * 100) / 100, n: c.n };
    }
    return out;
  },
};

export const fixtureMeta: Meta = {
  generated_at: "SIMULATED",
  last_month: LAST,
  baseline: [2003, 2022],
  overlap: [2012, 2019],
  unit: "fire cell-days",
};

/* ---------- Report-alignment fixtures (raw pipeline shapes, SIMULATED) ---------- */

const ymStr = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const monthIndex = (y: number, m: number) => y * 12 + (m - 1);

/** FSI clusters (report Eq. 5) for the last 36 months only, as the pipeline exports. */
export function fixtureRanking(country: string, year: number, month: number) {
  const t = monthIndex(year, month);
  const last = monthIndex(LAST.year, LAST.month);
  if (t > last || t <= last - 36) return null;
  const national = PROFILES[country];
  const admins = fixtureRegions.filter((r) => r.country === country && r.id !== country && !r.id.startsWith("DEMO"));
  if (!national || admins.length === 0) return null;
  const rnd = mulberry32(hash(`${country}-${year}-${month}-fsi`));
  const season = seasonal(month, national);
  const n = Math.max(3, Math.round(4 + season * 22 * (0.7 + rnd() * 0.6)));
  const raw = Array.from({ length: n }, () => {
    const a = admins[Math.floor(rnd() * admins.length)];
    const [x0, y0, x1, y1] = a.bbox;
    const lon = round2(x0 + rnd() * (x1 - x0));
    const lat = round2(y0 + rnd() * (y1 - y0));
    const cells = Math.max(1, Math.round(Math.exp(rnd() * 4.2 * (0.5 + season))));
    const frp = round1(cells * (18 + rnd() * 70));
    const days = Math.min(31, 1 + Math.floor(rnd() * Math.min(31, 2 + cells / 2)));
    const half = 0.05 + 0.05 * Math.sqrt(cells);
    return { lon, lat, cells, frp, days, half, admin: a.name };
  });
  const norm = (vals: number[]) => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return vals.map((v) => (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 100));
  };
  const fN = norm(raw.map((c) => Math.log(c.frp)));
  const aN = norm(raw.map((c) => c.cells));
  const dN = norm(raw.map((c) => c.days));
  return {
    country,
    period: ymStr(year, month),
    clusters: raw
      .map((c, i) => ({ ...c, fsi: Math.round((0.45 * fN[i] + 0.35 * aN[i] + 0.2 * dN[i]) * 10) / 10 }))
      .sort((a, b) => b.fsi - a.fsi)
      .slice(0, 20)
      .map((c, i) => ({
        rank: i + 1,
        fsi: c.fsi,
        frp_mw: c.frp,
        cells: c.cells,
        days: c.days,
        centroid: [c.lon, c.lat],
        admin1_name: c.admin,
        bbox: [round2(c.lon - c.half), round2(c.lat - c.half), round2(c.lon + c.half), round2(c.lat + c.half)],
      })),
  };
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26). */
function phi(x: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const y = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export function fixtureForecast(regionId: string) {
  const rows = fixtureMonthly(regionId);
  if (!rows) return null;
  const Z80 = 1.2816;
  const stats = (from: number, to: number) =>
    Array.from({ length: 12 }, (_, i) => {
      const v = rows
        .filter((r) => r.month === i + 1 && r.year >= from && r.year <= to && r.harmonized != null)
        .map((r) => Math.log1p(r.harmonized as number));
      const mu = v.reduce((s, x) => s + x, 0) / v.length;
      const sd = Math.sqrt(v.reduce((s, x) => s + (x - mu) ** 2, 0) / Math.max(1, v.length - 1));
      return { mu, sd };
    });
  const train = stats(2001, 2015);
  const trend = PROFILES[regionId].trend;
  const backtest = rows
    .filter((r) => r.year >= 2016 && r.harmonized != null)
    .map((r) => {
      const s = train[r.month - 1];
      const mu = s.mu + Math.log1p(trend * (r.year - 2008));
      return {
        month: ymStr(r.year, r.month),
        observed: r.harmonized as number,
        predicted: round1(Math.expm1(mu)),
        lo: round1(Math.expm1(mu - Z80 * s.sd)),
        hi: round1(Math.expm1(mu + Z80 * s.sd)),
      };
    });
  const ok = backtest.filter((b) => b.observed > 0);
  const mape = ok.reduce((s, b) => s + Math.abs(b.observed - b.predicted) / b.observed, 0) / ok.length;
  const coverage = backtest.filter((b) => b.observed >= b.lo && b.observed <= b.hi).length / backtest.length;

  const all = stats(2003, 2022);
  // Simulated signals so the alert badges can be developed: Colombia very high, Vichada high.
  const shift = regionId === "CO" ? 2.7 : regionId === "CO-VID" ? 1.35 : regionId === "AR-LR" ? 0.6 : 0;
  const outlook = [1, 2, 3].map((k) => {
    const t = monthIndex(LAST.year, LAST.month) + k;
    const y = Math.floor(t / 12);
    const m = (t % 12) + 1;
    const base = all[m - 1];
    const spread = regionId === "CO" ? 0.85 : 1;
    const zMean = shift * (k === 3 ? 1 : 0.7);
    const mu = base.mu + zMean * base.sd;
    const p1 = 1 - phi((1 - zMean) / spread);
    const p2 = 1 - phi((2 - zMean) / spread);
    return {
      month: ymStr(y, m),
      predicted: round1(Math.expm1(mu)),
      lo: round1(Math.expm1(mu - Z80 * spread * base.sd)),
      hi: round1(Math.expm1(mu + Z80 * spread * base.sd)),
      p_above_z1: Math.round(p1 * 100) / 100,
      p_above_z2: Math.round(p2 * 100) / 100,
      alert_yellow: p1 > 0.6,
      alert_red: p2 > 0.75,
    };
  });
  return {
    region_id: regionId,
    model: "SARIMA(1,0,1)(1,1,1,12) on log1p",
    backtest,
    metrics: {
      mape: Math.round(mape * 1000) / 1000,
      coverage: Math.round(coverage * 1000) / 1000,
      interval: 0.8,
      n_test: backtest.length,
      train_end: "2015-12",
    },
    outlook,
  };
}

export const fixtureOni = (() => {
  const rnd = mulberry32(hash("oni"));
  const out: { year: number; month: number; oni: number; phase: string }[] = [];
  for (let y = 2000; y <= LAST.year; y++) {
    for (let m = 1; m <= 12; m++) {
      // The latest 3-month season is centered one month before the last data month.
      if (y === LAST.year && m >= LAST.month) break;
      const t = monthIndex(y, m) - monthIndex(2000, 1);
      let oni = 1.15 * Math.sin((2 * Math.PI * t) / 46 + 2.4) + 0.45 * Math.sin((2 * Math.PI * t) / 19) + (rnd() - 0.5) * 0.3;
      if (y === 2015 || (y === 2016 && m <= 3)) oni += 1.1; // a strong simulated warm event
      oni = Math.round(oni * 10) / 10;
      out.push({ year: y, month: m, oni, phase: oni >= 0.5 ? "el_nino" : oni <= -0.5 ? "la_nina" : "neutral" });
    }
  }
  return out;
})();

export function fixtureClimate(regionId: string) {
  const region = fixtureRegions.find((r) => r.id === regionId);
  if (!PROFILES[regionId] || !region) return null;
  const rnd = mulberry32(hash(`${regionId}-climate`));
  const co = region.country === "CO";
  const r = Math.round((co ? 0.32 + rnd() * 0.22 : -(0.08 + rnd() * 0.2)) * 100) / 100;
  const lag = co ? 2 + Math.floor(rnd() * 3) : Math.floor(rnd() * 3);
  const s = Math.sign(r);
  return {
    enso: {
      best_lag: lag,
      r,
      p: Math.abs(r) > 0.2 ? 0.001 : 0.04,
      n: 296 - lag,
      mean_z_el_nino: Math.round(s * (0.3 + Math.abs(r)) * 100) / 100,
      mean_z_la_nina: Math.round(-s * (0.2 + Math.abs(r) * 0.8) * 100) / 100,
      mean_z_neutral: Math.round((rnd() - 0.5) * 10) / 100,
    },
    wind: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      speed: round2(co ? 3.2 + 1.2 * Math.cos(((i - 1) * Math.PI) / 6) : 4.1 + 0.8 * Math.sin(((i + 1) * Math.PI) / 6)),
      direction: co ? 70 + Math.round(rnd() * 25) : 250 + Math.round(rnd() * 40),
    })),
  };
}

/** Monthly mean 10 m wind on a 1° grid (u toward east, v toward north, m/s). */
export function fixtureWind(country: string, year: number) {
  const nat = fixtureRegions.find((r) => r.id === country);
  if (!nat || year > LAST.year || year < 2001) return null;
  const [x0, y0, x1, y1] = nat.bbox;
  const out: { lat: number; lon: number; month: number; u: number; v: number; speed: number }[] = [];
  for (let m = 1; m <= 12; m++) {
    if (year === LAST.year && m > LAST.month) break;
    for (let lat = Math.ceil(y0) + 0.5; lat < y1; lat += 1) {
      for (let lon = Math.ceil(x0) + 0.5; lon < x1; lon += 1) {
        let u: number;
        let v: number;
        if (country === "CO") {
          // North-east trades, strongest in the dry season (Dec-Mar).
          const s = 1 + 0.45 * Math.cos(((m - 2) * Math.PI) / 6);
          u = -(2.6 + 0.08 * (lat - 4)) * s + 0.4 * Math.sin(lon * 0.7);
          v = (-1.2 + 0.12 * (lon + 72)) * s * 0.6 + 0.3 * Math.cos(lat * 0.6);
        } else {
          // Westerlies in the south, northerly flow in the north.
          const south = Math.min(1, Math.max(0, (-lat - 32) / 10));
          u = 1.2 + 5.5 * south + 0.6 * Math.sin(lat * 0.5 + m);
          v = -2.2 * (1 - south) + 0.8 * Math.cos(lon * 0.4 + m * 0.5);
        }
        out.push({ lat, lon, month: m, u: round2(u), v: round2(v), speed: round2(Math.hypot(u, v)) });
      }
    }
  }
  return out;
}

/* ---------- Sensor footprints (pixels/), SIMULATED, raw FIRMS-like shapes ---------- */

const PIXEL_REGIONS = ["CO-VID", "DEMO-CHILECITO", "DEMO-SNSM"];

function lastMonths(n: number): string[] {
  const out: string[] = [];
  const last = monthIndex(LAST.year, LAST.month);
  for (let t = last - n + 1; t <= last; t++) out.push(ymStr(Math.floor(t / 12), (t % 12) + 1));
  return out;
}

/** pixels/index.json: footprints exist only for demo regions and the last 36 months. */
export const fixturePixelIndex = PIXEL_REGIONS.map((region_id) => ({ region_id, months: lastMonths(36), subsampled: false }));

/**
 * pixels/{region}/{YYYY}-{MM}.json. Each simulated fire front is seen by MODIS as a line of ~1 km
 * pixels; VIIRS sees the same flaming area as several 375 m pixels on its finer lattice. Pixel size
 * grows off-nadir (bow-tie), as in FIRMS scan/track. Field names deliberately use FIRMS spellings
 * (latitude, longitude, satellite, acq_date, daynight, scan, track, confidence) to exercise the
 * contract aliases.
 */
export function fixturePixels(regionId: string, year: number, month: number) {
  if (!PIXEL_REGIONS.includes(regionId) || !lastMonths(36).includes(ymStr(year, month))) return null;
  const region = fixtureRegions.find((r) => r.id === regionId);
  const monthly = fixtureMonthly(regionId);
  if (!region || !monthly) return null;
  const row = monthly.find((r) => r.year === year && r.month === month);
  const peak = Math.max(...monthly.map((r) => r.harmonized ?? 0), 1);
  const intensity = Math.min(1, Math.sqrt((row?.harmonized ?? 0) / peak));
  const rnd = mulberry32(hash(`${regionId}-px-${year}-${month}`));
  const [x0, y0, x1, y1] = region.bbox;
  const KM = 111.32;
  const out: Record<string, unknown>[] = [];
  const nFronts = Math.max(1, Math.round(2 + 9 * intensity));
  const day = () => `${ymStr(year, month)}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`;
  for (let f = 0; f < nFronts; f++) {
    const cx = x0 + (0.12 + 0.76 * rnd()) * (x1 - x0);
    const cy = y0 + (0.12 + 0.76 * rnd()) * (y1 - y0);
    const coslat = Math.cos((cy * Math.PI) / 180);
    const angle = rnd() * Math.PI;
    const lenKm = 4 + 16 * rnd() * (0.4 + intensity);
    const date = day();
    const dn = rnd() < 0.7 ? "D" : "N";
    // Off-nadir position of this overpass: 0 = nadir, 1 = swath edge.
    const offM = rnd();
    const offV = rnd();
    const mScan = 1 + 1.8 * offM * offM;
    const mTrack = 1 + 0.9 * offM * offM;
    const vScan = 0.375 * (1 + 1.1 * offV * offV);
    const vTrack = 0.375 * (1 + 0.6 * offV * offV);
    const nM = Math.max(1, Math.round(lenKm / mScan));
    for (let i = 0; i < nM; i++) {
      const s = (i / Math.max(1, nM - 1) - 0.5) * lenKm;
      const wob = (rnd() - 0.5) * 1.2;
      const ex = s * Math.cos(angle) - wob * Math.sin(angle);
      const ny = s * Math.sin(angle) + wob * Math.cos(angle);
      const lon = cx + ex / (KM * coslat);
      const lat = cy + ny / KM;
      const frpM = round1(8 + 220 * rnd() ** 2.2 * (0.5 + intensity));
      out.push({
        longitude: round4(lon),
        latitude: round4(lat),
        instrument: "MODIS",
        satellite: dn === "D" ? (rnd() < 0.5 ? "Terra" : "Aqua") : rnd() < 0.5 ? "T" : "A",
        acq_date: date,
        daynight: dn,
        scan: round2(mScan),
        track: round2(mTrack),
        frp: frpM,
        confidence: Math.round(45 + 55 * rnd()),
      });
      // VIIRS: the same flaming area on the 375 m lattice -> 3 to 9 pixels around the MODIS one.
      const k = 3 + Math.floor(rnd() * 7);
      const used = new Set<string>();
      for (let j = 0; j < k; j++) {
        const gx = Math.floor(rnd() * 3) - 1;
        const gy = Math.floor(rnd() * 3) - 1;
        const key = `${gx},${gy}`;
        if (used.has(key)) continue;
        used.add(key);
        const vlon = lon + (gx * vScan) / (KM * coslat);
        const vlat = lat + (gy * vTrack) / KM;
        out.push({
          longitude: round4(vlon),
          latitude: round4(vlat),
          instrument: "VIIRS",
          satellite: rnd() < 0.55 ? "N" : "N20",
          acq_date: date,
          daynight: dn,
          scan: round2(vScan),
          track: round2(vTrack),
          frp: round1((frpM / k) * (0.5 + rnd())),
          confidence: rnd() < 0.15 ? "l" : rnd() < 0.75 ? "n" : "h",
        });
      }
    }
  }
  return out;
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;
