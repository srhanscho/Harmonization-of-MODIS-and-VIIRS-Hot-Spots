import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normClimate, normForecast, normMonthly, normOni, normRanking, normValidation } from "../contract";
import type { ClimateLink, ClimatologyRow, Forecast, FsiCluster, MonthlyRow, OniRow, Region, Validation } from "../types";

/** Same guard as the client: fixtures can never be used in a production build. */
const USE_FIXTURE = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_USE_FIXTURE === "1";

const DATA_DIR = path.join(process.cwd(), "public", "data");
const SAFE_ID = /^[A-Za-z0-9_.-]{1,64}$/;

const fixture = () => import("../../../fixtures/synthetic");

async function readJson<T>(...parts: string[]): Promise<T | null> {
  try {
    const text = await readFile(path.join(DATA_DIR, ...parts), "utf8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const nonEmpty = <T,>(v: T[] | null): T[] | null => (v && v.length ? v : null);

export async function getRegions(): Promise<Region[] | null> {
  if (USE_FIXTURE) return (await fixture()).fixtureRegions;
  return readJson<Region[]>("regions.json");
}

export async function getMonthly(id: string): Promise<MonthlyRow[] | null> {
  if (!SAFE_ID.test(id)) return null;
  const raw = USE_FIXTURE ? (await fixture()).fixtureMonthly(id) : await readJson<unknown>("monthly", `${id}.json`);
  return raw == null ? null : normMonthly(raw);
}

export async function getClimatology(id: string): Promise<ClimatologyRow[] | null> {
  if (!SAFE_ID.test(id)) return null;
  if (USE_FIXTURE) return (await fixture()).fixtureClimatology(id);
  return readJson<ClimatologyRow[]>("climatology", `${id}.json`);
}

export async function getValidation(): Promise<Validation | null> {
  const raw = USE_FIXTURE ? (await fixture()).fixtureValidation : await readJson<unknown>("validation.json");
  return normValidation(raw);
}

export async function getRanking(country: string, year: number, month: number): Promise<FsiCluster[] | null> {
  if (!SAFE_ID.test(country) || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  if (USE_FIXTURE) return nonEmpty(normRanking((await fixture()).fixtureRanking(country, year, month)));
  const raw =
    (await readJson<unknown>("ranking", country, `${year}-${String(month).padStart(2, "0")}.json`)) ??
    (await readJson<unknown>("ranking", country, `${year}-${month}.json`));
  return nonEmpty(normRanking(raw));
}

export async function getForecast(id: string): Promise<Forecast | null> {
  if (!SAFE_ID.test(id)) return null;
  const raw = USE_FIXTURE ? (await fixture()).fixtureForecast(id) : await readJson<unknown>("forecast", `${id}.json`);
  return normForecast(raw);
}

export async function getClimate(id: string): Promise<ClimateLink | null> {
  if (!SAFE_ID.test(id)) return null;
  const raw = USE_FIXTURE ? (await fixture()).fixtureClimate(id) : await readJson<unknown>("climate", `${id}.json`);
  return normClimate(raw);
}

export async function getOni(): Promise<OniRow[] | null> {
  const raw = USE_FIXTURE ? (await fixture()).fixtureOni : await readJson<unknown>("oni.json");
  return nonEmpty(normOni(raw));
}

export const isFixture = () => USE_FIXTURE;
