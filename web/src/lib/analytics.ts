"use client";

import { useMemo } from "react";
import { useRegionData, useStore } from "./store";
import {
  anomaly,
  lastObserved,
  peakMonth,
  recordYear,
  seasonMonths,
  yearRange,
  yearTotals,
  type Anomaly,
  type YearTotal,
} from "./series";
import type { ClimatologyRow, LoadResult, MonthlyRow } from "./types";

export interface RegionAnalytics {
  monthly: LoadResult<MonthlyRow[]> | null;
  clim: LoadResult<ClimatologyRow[]> | null;
  rows: MonthlyRow[] | null;
  climRows: ClimatologyRow[] | null;
  years: number[];
  selected: { year: number; month: number } | null;
  anomaly: Anomaly | null;
  peak: number | null;
  season: number[];
  record: YearTotal | null;
  selectedYearTotal: YearTotal | null;
  selectedRow: MonthlyRow | null;
}

/**
 * Default month to open on: the most active month of the latest 12 observed months
 * (the peak of the most recent fire season), so the map and calendar open on visible fire
 * instead of a partial or rainy-season month.
 */
function recentPeak(rows: MonthlyRow[]): { year: number; month: number } | null {
  const observed = rows
    .filter((r) => r.harmonized != null)
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .slice(-12);
  let best: MonthlyRow | null = null;
  for (const r of observed) if (!best || (r.harmonized ?? 0) > (best.harmonized ?? 0)) best = r;
  return best && (best.harmonized ?? 0) > 0 ? { year: best.year, month: best.month } : null;
}

export function useRegionAnalytics(): RegionAnalytics {
  const { state, meta } = useStore();
  const { monthly, clim } = useRegionData(state.regionId);
  const lastMetaYear = meta?.status === "ok" ? meta.data.last_month?.year : undefined;

  return useMemo(() => {
    const rows = monthly?.status === "ok" ? monthly.data : null;
    const climRows = clim?.status === "ok" ? clim.data : null;
    const years = rows ? yearRange(rows, lastMetaYear) : [];
    let selected: { year: number; month: number } | null = null;
    if (state.year != null && state.month != null) selected = { year: state.year, month: state.month };
    else if (rows) selected = recentPeak(rows) ?? lastObserved(rows);
    const harmTotals = rows ? yearTotals(rows, years, "harmonized") : [];
    return {
      monthly,
      clim,
      rows,
      climRows,
      years,
      selected,
      anomaly: rows && selected ? anomaly(rows, climRows, selected.year, selected.month) : null,
      peak: peakMonth(climRows),
      season: seasonMonths(climRows),
      record: recordYear(harmTotals),
      selectedYearTotal: selected ? (harmTotals.find((x) => x.year === selected.year) ?? null) : null,
      selectedRow: rows && selected ? (rows.find((r) => r.year === selected.year && r.month === selected.month) ?? null) : null,
    };
  }, [monthly, clim, state.year, state.month, lastMetaYear]);
}
