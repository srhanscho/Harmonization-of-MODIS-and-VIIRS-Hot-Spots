"use client";

import { loadClimate } from "@/lib/data";
import { InfoTip } from "@/components/ui/InfoTip";
import { useI18n } from "@/lib/i18n";
import { ENSO } from "@/lib/palette";
import { fmt, fmtSigned } from "@/lib/series";
import { useLoad, useRegion } from "@/lib/store";

const COPY = {
  en: {
    explains: (region: string, pct: string, lag: string) =>
      `In ${region}, ENSO explains about ${pct} of the variation in monthly fire anomaly, ${lag}.`,
    lag: (n: number) => (n === 0 ? "in the same month" : `with the ocean signal leading by ${n} month${n === 1 ? "" : "s"}`),
    up: "Warm-Pacific (El Niño) months tend to burn more than usual here.",
    down: "Cool-Pacific (La Niña) months tend to burn more than usual here.",
    weak: "The link is weak here; treat it as context, not a driver.",
    meanZ: "Mean fire anomaly (HFAI z) by phase",
    stats: (r: string, n: string, p: string) => `r = ${r} · n = ${n} months · p ${p}`,
    caveat: "Correlation with the Oceanic Niño Index (NOAA CPC), not causation.",
    missing: "No climate link published for this region yet.",
  },
  es: {
    explains: (region: string, pct: string, lag: string) =>
      `En ${region}, ENSO explica cerca del ${pct} de la variación de la anomalía mensual de fuego, ${lag}.`,
    lag: (n: number) => (n === 0 ? "en el mismo mes" : `con la señal del océano adelantada ${n} ${n === 1 ? "mes" : "meses"}`),
    up: "Los meses de Pacífico cálido (El Niño) tienden a quemar más de lo usual aquí.",
    down: "Los meses de Pacífico frío (La Niña) tienden a quemar más de lo usual aquí.",
    weak: "El vínculo es débil aquí; tómalo como contexto, no como causa.",
    meanZ: "Anomalía media de fuego (HFAI z) por fase",
    stats: (r: string, n: string, p: string) => `r = ${r} · n = ${n} meses · p ${p}`,
    caveat: "Correlación con el Índice Oceánico del Niño (NOAA CPC), no causalidad.",
    missing: "Aún no hay vínculo climático publicado para esta región.",
  },
};

/** "Ocean–climate link" card from climate/{region_id}.json -> enso. Words only what the file says. */
export function ClimateCard({ regionId }: { regionId: string }) {
  const { t, lang } = useI18n();
  const region = useRegion();
  const c = COPY[lang];
  const res = useLoad(`climate:${regionId}`, () => loadClimate(regionId));
  const e = res?.status === "ok" ? res.data.enso : null;

  return (
    <section aria-label={t("climateLink")} className="border-t border-cyan-500/20 px-5 pt-3.5 pb-4">
      <h2 className="mb-2 flex items-center gap-1 text-[11px] font-semibold tracking-wider text-cyan-300 uppercase">
        {t("climateLink")} <InfoTip k="infoEnso" label={t("climateLink")} />
      </h2>
      {res == null ? (
        <p className="t-caption text-slate-400">{t("loading")}</p>
      ) : !e || e.r == null ? (
        <p className="t-caption text-slate-400">{c.missing}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="text-[13.5px] leading-relaxed text-slate-200">
            {c.explains(
              region?.name ?? regionId,
              `${fmt(e.r * e.r * 100, 0)}%`,
              c.lag(e.best_lag ?? 0),
            )}{" "}
            <span className="text-cyan-300 font-medium">{Math.abs(e.r) < 0.2 ? c.weak : e.r > 0 ? c.up : c.down}</span>
          </p>
          {(e.mean_z_el_nino != null || e.mean_z_la_nina != null) && (
            <div>
              <p className="t-caption mb-1.5 text-slate-400">{c.meanZ}</p>
              <dl className="num grid grid-cols-3 gap-2">
                {(
                  [
                    ["el_nino", t("elNino"), e.mean_z_el_nino],
                    ["neutral", t("neutral"), e.mean_z_neutral],
                    ["la_nina", t("laNina"), e.mean_z_la_nina],
                  ] as const
                ).map(([k, label, v]) => (
                  <div key={k} className="min-w-0 rounded-xl border border-cyan-500/25 bg-[rgba(8,23,48,0.65)] px-2.5 py-2 shadow-sm">
                    <dt className="flex items-center gap-1 text-[10.5px] whitespace-nowrap text-slate-300">
                      <span className="h-[3px] w-3 rounded-full" style={{ background: ENSO[k] }} aria-hidden />
                      {label}
                    </dt>
                    <dd className="mt-0.5 text-[15px] font-bold text-white">{fmtSigned(v, 2)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <p className="t-caption num text-slate-400">
            {c.stats(
              fmt(e.r, 2),
              fmt(e.n, 0),
              e.p == null ? "—" : e.p < 0.001 ? "< 0.001" : `= ${fmt(e.p, 3)}`,
            )}
          </p>
          <p className="t-caption text-slate-400">{c.caveat}</p>
        </div>
      )}
    </section>
  );
}
