"use client";

import { createContext, useContext, useEffect, useReducer, useRef, useState, type Dispatch, type ReactNode } from "react";
import { loadClimatology, loadMeta, loadMonthly, loadRegions } from "./data";
import type { Bbox, CalendarMetric, ClimatologyRow, DisplayMode, LoadResult, Meta, MonthlyRow, Region } from "./types";

export interface Layers {
  basemap: boolean;
  boundaries: boolean;
  cells: boolean;
  outline: boolean;
  wind: boolean;
}

export interface AppState {
  regionId: string | null;
  year: number | null;
  month: number | null;
  mode: DisplayMode;
  view: "globe" | "region";
  tab: "explore" | "lab" | "method";
  metric: CalendarMetric;
  /** Map focus requested by the FSI ranking (cluster bbox). */
  focus: { bbox: Bbox; nonce: number } | null;
  layers: Layers;
  /** Incremented to request a camera flight even when the region is unchanged. */
  flyNonce: number;
  /** First-run guide card visibility. */
  guide: boolean;
}

/** Filter patch returned by the assistant's set_view tool. */
export interface ViewPatch {
  region_id?: string;
  mode?: DisplayMode;
  year?: number;
  month?: number;
}

export type Action =
  | { type: "selectRegion"; regionId: string; year?: number; month?: number }
  | { type: "selectMonth"; year: number; month: number }
  | { type: "setMode"; mode: DisplayMode }
  | { type: "setMetric"; metric: CalendarMetric }
  | { type: "focusBbox"; bbox: Bbox | null }
  | { type: "backToGlobe" }
  | { type: "setTab"; tab: AppState["tab"] }
  | { type: "toggleLayer"; layer: keyof Layers }
  | { type: "setGuide"; open: boolean }
  | { type: "applyPatch"; patch: ViewPatch };

const initial: AppState = {
  regionId: null,
  year: null,
  month: null,
  mode: "harmonized",
  view: "globe",
  tab: "explore",
  metric: "activity",
  focus: null,
  layers: { basemap: true, boundaries: true, cells: true, outline: true, wind: false },
  flyNonce: 0,
  guide: true,
};

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "selectRegion":
      return {
        ...s,
        regionId: a.regionId,
        year: a.year ?? (a.regionId === s.regionId ? s.year : null),
        month: a.month ?? (a.regionId === s.regionId ? s.month : null),
        view: "region",
        tab: s.tab === "lab" ? "lab" : "explore",
        focus: null,
        flyNonce: s.flyNonce + 1,
      };
    case "selectMonth":
      return { ...s, year: a.year, month: a.month };
    case "setMode":
      return { ...s, mode: a.mode };
    case "setMetric":
      return { ...s, metric: a.metric };
    case "focusBbox":
      return { ...s, focus: a.bbox ? { bbox: a.bbox, nonce: (s.focus?.nonce ?? 0) + 1 } : null };
    case "backToGlobe":
      return { ...s, view: "globe", focus: null, flyNonce: s.flyNonce + 1 };
    case "setTab":
      return { ...s, tab: a.tab };
    case "setGuide":
      return { ...s, guide: a.open };
    case "toggleLayer":
      return { ...s, layers: { ...s.layers, [a.layer]: !s.layers[a.layer] } };
    case "applyPatch": {
      const p = a.patch;
      const regionChanged = p.region_id && p.region_id !== s.regionId;
      return {
        ...s,
        regionId: p.region_id ?? s.regionId,
        mode: p.mode ?? s.mode,
        year: p.year ?? (regionChanged ? null : s.year),
        month: p.month ?? (regionChanged ? null : s.month),
        view: p.region_id ? "region" : s.view,
        tab: s.tab === "lab" ? "lab" : "explore",
        focus: regionChanged ? null : s.focus,
        flyNonce: regionChanged ? s.flyNonce + 1 : s.flyNonce,
      };
    }
  }
}

interface Store {
  state: AppState;
  dispatch: Dispatch<Action>;
  regions: LoadResult<Region[]> | null;
  meta: LoadResult<Meta> | null;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [regions, setRegions] = useState<LoadResult<Region[]> | null>(null);
  const [meta, setMeta] = useState<LoadResult<Meta> | null>(null);
  useEffect(() => {
    loadRegions().then(setRegions);
    loadMeta().then(setMeta);
  }, []);
  return <Ctx.Provider value={{ state, dispatch, regions, meta }}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside StoreProvider");
  return v;
}

export function useRegion(): Region | null {
  const { state, regions } = useStore();
  if (!state.regionId || regions?.status !== "ok") return null;
  return regions.data.find((r) => r.id === state.regionId) ?? null;
}

export interface RegionData {
  monthly: LoadResult<MonthlyRow[]> | null;
  clim: LoadResult<ClimatologyRow[]> | null;
}

export function useRegionData(regionId: string | null): RegionData {
  const [data, setData] = useState<{ id: string | null } & RegionData>({ id: null, monthly: null, clim: null });
  useEffect(() => {
    if (!regionId) return;
    let alive = true;
    Promise.all([loadMonthly(regionId), loadClimatology(regionId)]).then(([monthly, clim]) => {
      if (alive) setData({ id: regionId, monthly, clim });
    });
    return () => {
      alive = false;
    };
  }, [regionId]);
  if (!regionId || data.id !== regionId) return { monthly: null, clim: null };
  return { monthly: data.monthly, clim: data.clim };
}

/**
 * Generic loader hook for optional files: returns null while loading (or with no key),
 * then the LoadResult for the current key. `load` is read through a ref so callers can
 * pass an inline closure; only `key` drives reloading.
 */
export function useLoad<T>(key: string | null, load: () => Promise<LoadResult<T>>): LoadResult<T> | null {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const [res, setRes] = useState<{ key: string; value: LoadResult<T> } | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    loadRef.current().then((value) => {
      if (alive) setRes({ key, value });
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return key && res?.key === key ? res.value : null;
}
