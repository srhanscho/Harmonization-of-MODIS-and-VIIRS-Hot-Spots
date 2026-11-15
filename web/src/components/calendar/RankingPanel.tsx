"use client";

import { Crosshair } from "lucide-react";
import { InfoTip } from "@/components/ui/InfoTip";
import { DataState } from "@/components/hud/DataState";
import { loadRanking, rankingPath } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { fireAt } from "@/lib/palette";
import { fmt } from "@/lib/series";
import { useLoad, useStore } from "@/lib/store";

const COUNTRY_NAMES: Record<string, string> = { CO: "Colombia", AR: "Argentina" };

/** FSI top clusters (report Eq. 5) for the selected month and country; a row click flies the map there. */
export function RankingPanel({ country, year, month }: { country: string; year: number; month: number }) {
  const { t, monthLong } = useI18n();
  const { state, dispatch } = useStore();
  const res = useLoad(`${country}:${year}-${month}`, () => loadRanking(country, year, month));
  const focused = state.focus?.bbox;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div>
        <p className="flex items-center gap-1 text-[13px] font-medium text-[var(--text-1)]">
          {t("fsiTitle")} <InfoTip k="infoFsi" label={t("fsiTitle")} />
        </p>
        <p className="t-caption mt-0.5">
          {COUNTRY_NAMES[country] ?? country} · {monthLong(month)} {year}
        </p>
      </div>
      {res?.status !== "ok" ? (
        res?.status === "missing" ? (
          <p className="py-2 text-[13px] text-[var(--text-3)]" role="status">
            {t("rankingMissing")}
          </p>
        ) : (
          <DataState result={res} file={rankingPath(country, year, month)} />
        )
      ) : (
        <>
          <table className="num w-full text-xs">
            <thead className="text-[var(--text-3)]">
              <tr>
                <th className="w-6 py-1 text-left font-normal">#</th>
                <th className="text-left font-normal">{t("area")}</th>
                <th className="w-[26%] text-left font-normal">{t("fsi")}</th>
                <th className="text-right font-normal">{t("frpMw")}</th>
                <th className="hidden text-right font-normal sm:table-cell">{t("cells")}</th>
                <th className="text-right font-normal">{t("days")}</th>
              </tr>
            </thead>
            <tbody>
              {res.data.slice(0, 20).map((c) => {
                const active = focused && c.bbox && focused.join() === c.bbox.join();
                const name = c.admin1_name ?? "—";
                return (
                  <tr
                    key={`${c.rank}-${c.centroid?.join()}`}
                    className={`border-t border-[var(--line)] transition-colors duration-150 ${
                      c.bbox ? "cursor-pointer hover:bg-[var(--ink-2)]" : ""
                    } ${active ? "bg-[var(--ink-3)]" : ""}`}
                    onClick={() => c.bbox && dispatch({ type: "focusBbox", bbox: c.bbox })}
                  >
                    <td className="py-1.5 text-[var(--text-3)]">{c.rank}</td>
                    <td className="max-w-[9rem] min-w-[6rem] truncate pr-2">
                      {c.bbox ? (
                        <button
                          className="inline-flex max-w-full items-center gap-1 truncate text-left text-[var(--text-1)] hover:underline"
                          aria-label={t("showOnMap", { name })}
                          onClick={(e) => {
                            e.stopPropagation();
                            dispatch({ type: "focusBbox", bbox: c.bbox! });
                          }}
                        >
                          <span className="truncate">{name}</span>
                          {active && <Crosshair className="size-3 shrink-0 text-[var(--sci)]" aria-hidden />}
                        </button>
                      ) : (
                        name
                      )}
                    </td>
                    <td className="pr-2">
                      <span className="flex items-center gap-2">
                        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--ink-3)]" aria-hidden>
                          <span
                            className="absolute inset-y-0 left-0 rounded-full"
                            style={{ width: `${Math.max(2, Math.min(100, c.fsi))}%`, background: fireAt(0.35 + (c.fsi / 100) * 0.65) }}
                          />
                        </span>
                        <span className="w-7 text-right text-[var(--text-1)]">{fmt(c.fsi, 0)}</span>
                      </span>
                    </td>
                    <td className="text-right">{fmt(c.frp_mw, 0)}</td>
                    <td className="hidden text-right sm:table-cell">{fmt(c.cells, 0)}</td>
                    <td className="text-right">{fmt(c.days, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="t-caption">{t("fsiExplain")}</p>
        </>
      )}
    </div>
  );
}
