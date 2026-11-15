"use client";

import { useMemo } from "react";
import { EChart, type EChartsOption } from "./EChart";
import { useI18n } from "@/lib/i18n";
import { ACCENT, UI } from "@/lib/palette";
import { fmt, ordinal, sameMonthRanking } from "@/lib/series";
import type { MonthlyRow } from "@/lib/types";

interface Props {
  rows: MonthlyRow[];
  years: number[];
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
}

/** Rank of a chosen month among the same calendar month of every year (harmonized). */
export function EventMode({ rows, years, year, month, onChange }: Props) {
  const { t, lang, monthShort, monthLong } = useI18n();
  const ranking = useMemo(() => sameMonthRanking(rows, month, "harmonized"), [rows, month]);
  const pos = ranking.findIndex((e) => e.year === year);

  const option = useMemo<EChartsOption>(() => {
    const byYear = [...ranking].sort((a, b) => a.year - b.year);
    return {
      animation: false,
      textStyle: { fontFamily: "var(--font-sans), system-ui, sans-serif" },
      grid: { left: 40, right: 8, top: 8, bottom: 22 },
      tooltip: {
        trigger: "axis",
        backgroundColor: UI.tooltip,
        borderColor: UI.line,
        extraCssText: "border-radius:6px;font-variant-numeric:tabular-nums;",
        textStyle: { color: UI.text1, fontSize: 12 },
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(56,189,248,0.08)" } },
        valueFormatter: (v: number) => fmt(v, 1),
      },
      xAxis: {
        type: "category",
        data: byYear.map((e) => String(e.year)),
        axisLabel: { color: UI.text3, fontSize: 9 },
        axisLine: { lineStyle: { color: UI.line } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: UI.text3, fontSize: 9, formatter: (v: number) => (v >= 1000 ? `${v / 1000}k` : String(v)) },
        splitLine: { lineStyle: { color: UI.grid } },
      },
      series: [
        {
          type: "bar",
          name: t("harmonized"),
          data: byYear.map((e) => ({
            value: e.value,
            itemStyle: { color: e.year === year ? ACCENT : "rgba(56, 189, 248, 0.25)", borderRadius: [2, 2, 0, 0] },
          })),
        },
      ],
    };
  }, [ranking, year, t]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="t-label">{t("month")}</span>
          <select className="field w-24" value={month} onChange={(e) => onChange(year, Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i + 1}>
                {monthShort(i + 1)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="t-label">{t("year")}</span>
          <select className="field w-24" value={year} onChange={(e) => onChange(Number(e.target.value), month)}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-[13px] text-[var(--text-2)]" aria-live="polite">
        {pos >= 0 ? (
          <>
            <span className="num mr-1 text-lg font-semibold text-[var(--sci)]">
              #{pos + 1}
            </span>{" "}
            {t("eventRank", {
              month: monthLong(month),
              year,
              rank: ordinal(pos + 1, lang),
              n: ranking.length,
            })}{" "}
            <span className="text-[var(--text-3)]">({t("harmonized").toLowerCase()})</span>
          </>
        ) : (
          t("eventNoData")
        )}
      </p>
      {ranking.length > 0 && (
        <EChart option={option} style={{ width: "100%", height: 130 }} ariaLabel={t("eventMode")} />
      )}
    </div>
  );
}
