/**
 * Typed client-side loaders for the static data contract in /public/data.
 *
 * Missing files resolve to { status: "missing" } so the UI can show an explicit
 * empty state. No value is ever invented here.
 */
import {
  normCellRow,
  normClimate,
  normForecast,
  normMonthly,
  normOni,
  normPixelIndex,
  normPixels,
  normRanking,
  normValidation,
  normWind,
} from "./contract";
import type {
  CellRow,
  ClimateLink,
  ClimatologyRow,
  Forecast,
  FsiCluster,
  LoadResult,
  Meta,
  MonthlyRow,
  OniRow,
  PixelDetection,
  PixelIndexEntry,
  Region,
  Validation,
  WindRow,
} from "./types";

/**
 * Fixture mode is a development aid only. The NODE_ENV check makes it
 * impossible to enable in a production build, even if the env var leaks.
 */
export const USE_FIXTURE =
  process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_USE_FIXTURE === "1";

const cache = new Map<string, Promise<LoadResult<unknown>>>();

async function fetchJson<T>(path: string): Promise<LoadResult<T>> {
  try {
    const res = await fetch(path, { cache: "force-cache" });
    if (res.status === 404) return { status: "missing" };
    if (!res.ok) return { status: "error", message: `HTTP ${res.status} for ${path}` };
    const text = await res.text();
    try {
      return { status: "ok", data: JSON.parse(text) as T };
    } catch {
      return { status: "error", message: `Invalid JSON in ${path}` };
    }
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

async function fromFixture<T>(pick: (f: typeof import("../../fixtures/synthetic")) => T | null): Promise<LoadResult<T>> {
  // Statically dead in production builds, so the fixture is never bundled there.
  if (process.env.NODE_ENV !== "production") {
    const f = await import("../../fixtures/synthetic");
    const data = pick(f);
    return data == null ? { status: "missing" } : { status: "ok", data };
  }
  return { status: "missing" };
}

/** Apply a contract normalizer; a file that normalizes to nothing counts as missing. */
function mapped<T>(p: Promise<LoadResult<unknown>>, norm: (raw: unknown) => T | null): Promise<LoadResult<T>> {
  return p.then((r) => {
    if (r.status !== "ok") return r;
    const data = norm(r.data);
    if (data == null || (Array.isArray(data) && data.length === 0)) return { status: "missing" };
    return { status: "ok", data };
  });
}

function cached<T>(key: string, load: () => Promise<LoadResult<T>>): Promise<LoadResult<T>> {
  let p = cache.get(key);
  if (!p) {
    p = load();
    cache.set(key, p);
  }
  return p as Promise<LoadResult<T>>;
}

const safeId = (id: string) => encodeURIComponent(id);

export function loadRegions(): Promise<LoadResult<Region[]>> {
  return cached("regions", () =>
    USE_FIXTURE ? fromFixture((f) => f.fixtureRegions) : fetchJson<Region[]>("/data/regions.json"),
  );
}

export function loadMonthly(regionId: string): Promise<LoadResult<MonthlyRow[]>> {
  return cached(`monthly:${regionId}`, () =>
    USE_FIXTURE
      ? mapped(fromFixture((f) => f.fixtureMonthly(regionId)), normMonthly)
      : mapped(fetchJson<unknown>(`/data/monthly/${safeId(regionId)}.json`), normMonthly),
  );
}

export function loadClimatology(regionId: string): Promise<LoadResult<ClimatologyRow[]>> {
  return cached(`clim:${regionId}`, () =>
    USE_FIXTURE
      ? fromFixture((f) => f.fixtureClimatology(regionId))
      : fetchJson<ClimatologyRow[]>(`/data/climatology/${safeId(regionId)}.json`),
  );
}

export function loadValidation(): Promise<LoadResult<Validation>> {
  return cached("validation", () =>
    mapped(USE_FIXTURE ? fromFixture((f) => f.fixtureValidation) : fetchJson<unknown>("/data/validation.json"), normValidation),
  );
}

export function loadMeta(): Promise<LoadResult<Meta>> {
  return cached("meta", () =>
    USE_FIXTURE ? fromFixture((f) => f.fixtureMeta) : fetchJson<Meta>("/data/meta.json"),
  );
}

export function loadCells(regionId: string, year: number): Promise<LoadResult<CellRow[]>> {
  return cached(`cells:${regionId}:${year}`, () =>
    USE_FIXTURE
      ? fromFixture((f) => f.fixtureCells(regionId, year))
      : fetchJson<CellRow[]>(`/data/cells/${safeId(regionId)}/${year}.json`).then((r) =>
          r.status === "ok" && Array.isArray(r.data) ? { status: "ok" as const, data: r.data.map(normCellRow) } : r,
        ),
  );
}

/* ---------- Report-alignment files (optional; missing -> empty state) ---------- */

const pad2 = (m: number) => String(m).padStart(2, "0");

/** ranking/{country}/{year}-{month}.json (month zero-padded, e.g. 2026-03). */
export function rankingPath(country: string, year: number, month: number) {
  return `/data/ranking/${safeId(country)}/${year}-${pad2(month)}.json`;
}

export function loadRanking(country: string, year: number, month: number): Promise<LoadResult<FsiCluster[]>> {
  return cached(`ranking:${country}:${year}-${month}`, async () => {
    if (USE_FIXTURE) return mapped(fromFixture((f) => f.fixtureRanking(country, year, month)), normRanking);
    const r = await mapped(fetchJson<unknown>(rankingPath(country, year, month)), normRanking);
    // Tolerate an unpadded month in the file name (2026-3.json).
    if (r.status === "missing" && month < 10)
      return mapped(fetchJson<unknown>(`/data/ranking/${safeId(country)}/${year}-${month}.json`), normRanking);
    return r;
  });
}

export function loadForecast(regionId: string): Promise<LoadResult<Forecast>> {
  return cached(`forecast:${regionId}`, () =>
    mapped(
      USE_FIXTURE ? fromFixture((f) => f.fixtureForecast(regionId)) : fetchJson<unknown>(`/data/forecast/${safeId(regionId)}.json`),
      normForecast,
    ),
  );
}

export function loadOni(): Promise<LoadResult<OniRow[]>> {
  return cached("oni", () => mapped(USE_FIXTURE ? fromFixture((f) => f.fixtureOni) : fetchJson<unknown>("/data/oni.json"), normOni));
}

export function loadClimate(regionId: string): Promise<LoadResult<ClimateLink>> {
  return cached(`climate:${regionId}`, () =>
    mapped(
      USE_FIXTURE ? fromFixture((f) => f.fixtureClimate(regionId)) : fetchJson<unknown>(`/data/climate/${safeId(regionId)}.json`),
      normClimate,
    ),
  );
}

export function loadWind(country: string, year: number): Promise<LoadResult<WindRow[]>> {
  return cached(`wind:${country}:${year}`, () =>
    mapped(
      USE_FIXTURE ? fromFixture((f) => f.fixtureWind(country, year)) : fetchJson<unknown>(`/data/wind/${safeId(country)}/${year}.json`),
      normWind,
    ),
  );
}

/* ---------- Sensor footprints (optional demo regions) ---------- */

export function loadPixelIndex(): Promise<LoadResult<PixelIndexEntry[]>> {
  return cached("pixels:index", () =>
    mapped(USE_FIXTURE ? fromFixture((f) => f.fixturePixelIndex) : fetchJson<unknown>("/data/pixels/index.json"), normPixelIndex),
  );
}

/** pixels/{region_id}/{YYYY}-{MM}.json */
export function pixelsPath(regionId: string, year: number, month: number) {
  return `/data/pixels/${safeId(regionId)}/${year}-${pad2(month)}.json`;
}

export function loadPixels(regionId: string, year: number, month: number): Promise<LoadResult<PixelDetection[]>> {
  return cached(`pixels:${regionId}:${year}-${month}`, () =>
    mapped(
      USE_FIXTURE ? fromFixture((f) => f.fixturePixels(regionId, year, month)) : fetchJson<unknown>(pixelsPath(regionId, year, month)),
      normPixels,
    ),
  );
}
