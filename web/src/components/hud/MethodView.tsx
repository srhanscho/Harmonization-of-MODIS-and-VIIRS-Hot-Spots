"use client";

import { useEffect, useState, type ReactNode } from "react";
import { TwoSensors } from "../explainer/TwoSensors";
import { DataState } from "./DataState";
import { loadValidation } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { fmt } from "@/lib/series";
import { useStore } from "@/lib/store";
import type { LoadResult, Validation } from "@/lib/types";

/** MAPE values in validation.json are fractions (1.0 = 100%). */
const pct = (v: number | null | undefined) => (v == null ? "—" : `${fmt(v * 100, 0)}%`);

const COPY = {
  en: {
    title: "Method",
    intro:
      "MODIS (Terra since Nov 2000, Aqua since Jul 2002) and VIIRS (S-NPP since 2012, NOAA-20 since 2018) see the same fires with very different eyes: VIIRS pixels are smaller and detect many more hot spots. Stitching the two raw records together creates a false jump in 2012. We convert everything into one consistent unit so that the sensor of origin no longer matters.",
    steps: [
      ["Clean", "Keep vegetation fires only (type 0), confidence filters (MODIS ≥ 30, VIIRS nominal/high), drop static sources (≥ 50 days a year in the same ~1 km cell), split day and night."],
      ["Count cell-days, not pixels", "Each detection is snapped to a ~1 km grid. The unit is one 1 km cell × day × day/night × satellite with at least one detection, aggregated to 0.1° × month. A sharper camera no longer inflates the count."],
      ["Calibrate (the 'exchange rate')", "Reference: Aqua MODIS, which passes at the same afternoon time as VIIRS. Factor k = Σ VIIRS cell-days / Σ Aqua cell-days per region, calendar month and day/night over the 2012–2019 overlap, with shrinkage to annual or national factors when data are sparse. NOAA-20 is tied to S-NPP the same way; Terra-only months are scaled with the Aqua/Terra ratio of 2003–2008."],
      ["Harmonize", "Every month is expressed in VIIRS S-NPP equivalents (estimated): γ × MODIS before 2012, a 50/50 blend of γ × MODIS and VIIRS while both fly, VIIRS alone afterwards. The p5–p95 band comes from the year-to-year spread of γ. Raw values stay available and are labeled as observed."],
      ["Calendar & anomalies", "Fixed baseline 2003–2022 per calendar month: median, p10, p90, mean. A month's anomaly is its difference from the median and its percentile within the baseline, always with the number of years behind it. The HFAI z-score adds a scale-free anomaly with four classes."],
    ],
    validation: "Validation",
    loyo: "Leave-one-year-out (2012–2019): recompute k without one year, predict that year's Aqua from VIIRS, measure the error.",
    seam: "2012 seam test: mean ratio between 2012–2014 and 2009–2011. A value near 1.0 means the false jump is gone.",
    year: "Year",
    mapeRaw: "MAPE raw",
    mapeHarm: "MAPE harmonized",
    r: "r",
    mean: "Mean",
    seamRaw: "Raw series",
    seamHarm: "Harmonized series",
    limitations: "Limitations",
    lims: [
      "Hot-spot counts are not burned area. We never convert detections into hectares.",
      "Harmonized values are estimates; raw values are observations. Both are always labeled.",
      "Months without an active sensor are shown as empty (hatched), never as zero.",
      "Confidence thresholds are documented design choices, not an official equivalence between sensors.",
      "MODIS orbital drift after ~2020 and the end of S-NPP (Nov 2, 2026) add uncertainty to recent years.",
      "Predictive lab outlooks are experimental statistics, not operational warnings. The AI assistant only reports numbers returned by its data tools.",
      "ENSO correlations describe association, not cause.",
    ],
    equations: "Equations from the team report, in plain language",
    eqs: [
      ["Eq. 1 · FRP aggregation", "Fire radiative power (MW) is summed over every detection that falls in a region r, period t and sensor s."],
      ["Eq. 2 · MODIS to VIIRS power law", "Per region, a straight line on log–log axes links MODIS and VIIRS FRP over overlap months where both see fire. α sets the level, β the curvature. Regions with fewer than 24 paired months borrow the country fit."],
      ["Eq. 3 · VIIRS-equivalent counts", "Before 2012, MODIS counts are multiplied by γ (the VIIRS / Aqua exchange rate per region, calendar month and day/night). While both sensors fly, the two estimates are averaged with w = 0.5. After MODIS ends, VIIRS is used directly. One VIIRS satellite on one scale, never a sum of satellites."],
      ["Eq. 4 · HFAI anomaly", "How many standard deviations a month sits from the mean of the same calendar month, computed per sensor against its own baseline (MODIS 2003–2022, VIIRS 2012–2025) on log(1 + X), then combined. Classes: below normal (z < −0.5), expected (−0.5 to 1), moderate alert (1 to 2), critical (z > 2)."],
      ["Eq. 5 · Fire Severity Index", "Contiguous active 0.1° cells (8-neighbour) form a cluster C. Each cluster gets FRP (log scale), area A (cells) and duration D (longest run of consecutive days) rescaled to 0–100 among that month's clusters in the country, then weighted 45 / 35 / 20. A relative score, never hectares."],
    ],
    deviations: "Where we deviate from the report",
    devs: [
      "Z is computed on log(1 + X), not raw counts, because monthly counts are skewed and often zero.",
      "We also compute Z on the harmonized series with one 2003–2022 baseline and check that it agrees with the per-sensor HFAI in the overlap.",
      "We keep the square 0.1° grid (drawn as a smooth heatmap) instead of H3 resolution 5–6; H3 is future work.",
      "VIIRS is one chain on the S-NPP scale: S-NPP until 2 Nov 2026, then NOAA-20 tied to S-NPP with its own overlap ratio.",
      "The p5–p95 band comes from the spread of annual γ across overlap years.",
      "Predictive scope is reduced to a seasonal SARIMA on log(1 + X). Spatial LightGBM/XGBoost risk maps, SHAP explanations, weather covariates and file uploads are future work.",
    ],
    frpCal: "FRP calibration per region (Eq. 2)",
    region: "Region",
    sources: "Data sources & attributions",
    srcs: [
      "Fire data: NASA FIRMS archive — MODIS Collection 6.1 (MCD14ML) and VIIRS 375 m (VNP14IMG, VJ114IMG).",
      "Administrative boundaries: Natural Earth admin-1 (public domain).",
      "Oceanic Niño Index (ONI): NOAA Climate Prediction Center.",
      "Wind (WS10M, WD10M): NASA POWER, monthly.",
      "Basemap: Sentinel-2 cloudless by EOX (non-commercial use, CC BY-NC-SA 4.0).",
      "Vector boundaries: © OpenFreeMap © OpenStreetMap contributors.",
      "AI assistant: Claude (Anthropic) via tool calling over the published JSON files. Answers are labeled AI-generated.",
    ],
  },
  es: {
    title: "Método",
    intro:
      "MODIS (Terra desde nov 2000, Aqua desde jul 2002) y VIIRS (S-NPP desde 2012, NOAA-20 desde 2018) ven los mismos fuegos con ojos muy distintos: los píxeles de VIIRS son más pequeños y detectan muchos más puntos de calor. Unir los dos registros crudos crea un salto falso en 2012. Convertimos todo a una sola unidad consistente para que el sensor de origen ya no importe.",
    steps: [
      ["Limpiar", "Solo fuegos de vegetación (type 0), filtros de confianza (MODIS ≥ 30, VIIRS nominal/alta), se eliminan fuentes estáticas (≥ 50 días al año en la misma celda de ~1 km), se separa día y noche."],
      ["Contar celdas-día, no píxeles", "Cada detección se asigna a una grilla de ~1 km. La unidad es una celda de 1 km × día × día/noche × satélite con al menos una detección, agregada a 0,1° × mes. Una cámara más nítida ya no infla el conteo."],
      ["Calibrar (el 'tipo de cambio')", "Referencia: Aqua MODIS, que pasa a la misma hora de la tarde que VIIRS. Factor k = Σ celdas-día VIIRS / Σ celdas-día Aqua por región, mes calendario y día/noche en el solape 2012–2019, con contracción al factor anual o nacional cuando hay pocos datos. NOAA-20 se enlaza con S-NPP igual; los meses solo-Terra se escalan con la razón Aqua/Terra de 2003–2008."],
      ["Armonizar", "Cada mes se expresa en equivalentes VIIRS S-NPP (estimado): γ × MODIS antes de 2012, una mezcla 50/50 de γ × MODIS y VIIRS mientras ambos vuelan, y solo VIIRS después. La banda p5–p95 sale de la dispersión interanual de γ. Los valores crudos siguen disponibles y se rotulan como observados."],
      ["Calendario y anomalías", "Línea base fija 2003–2022 por mes calendario: mediana, p10, p90, media. La anomalía de un mes es su diferencia frente a la mediana y su percentil dentro de la línea base, siempre con el número de años que la sustentan. El z-score HFAI agrega una anomalía sin escala con cuatro clases."],
    ],
    validation: "Validación",
    loyo: "Dejar un año fuera (2012–2019): se recalcula k sin un año, se predice el Aqua de ese año desde VIIRS y se mide el error.",
    seam: "Prueba de la costura de 2012: razón media entre 2012–2014 y 2009–2011. Un valor cercano a 1,0 indica que el salto falso desapareció.",
    year: "Año",
    mapeRaw: "MAPE crudo",
    mapeHarm: "MAPE armonizado",
    r: "r",
    mean: "Media",
    seamRaw: "Serie cruda",
    seamHarm: "Serie armonizada",
    limitations: "Limitaciones",
    lims: [
      "Los conteos de puntos de calor no son área quemada. Nunca convertimos detecciones en hectáreas.",
      "Los valores armonizados son estimados; los crudos son observados. Siempre se rotulan.",
      "Los meses sin sensor activo se muestran vacíos (con trama), nunca como cero.",
      "Los umbrales de confianza son decisiones de diseño documentadas, no una equivalencia oficial entre sensores.",
      "La deriva orbital de MODIS después de ~2020 y el fin de S-NPP (2 nov 2026) agregan incertidumbre a los años recientes.",
      "Las perspectivas del laboratorio predictivo son estadísticas experimentales, no alertas operativas. El asistente de IA solo reporta cifras devueltas por sus herramientas de datos.",
      "Las correlaciones con ENSO describen asociación, no causa.",
    ],
    equations: "Ecuaciones del informe del equipo, en lenguaje simple",
    eqs: [
      ["Ec. 1 · Agregación de FRP", "La potencia radiativa del fuego (MW) se suma sobre cada detección que cae en una región r, período t y sensor s."],
      ["Ec. 2 · Ley de potencia MODIS a VIIRS", "Por región, una recta en ejes log–log une el FRP de MODIS y de VIIRS en los meses de solape donde ambos ven fuego. α fija el nivel y β la curvatura. Las regiones con menos de 24 meses pareados usan el ajuste del país."],
      ["Ec. 3 · Conteos equivalentes VIIRS", "Antes de 2012, los conteos MODIS se multiplican por γ (el tipo de cambio VIIRS / Aqua por región, mes calendario y día/noche). Mientras ambos sensores vuelan, las dos estimaciones se promedian con w = 0,5. Cuando termina MODIS se usa VIIRS directamente. Un solo satélite VIIRS en una sola escala, nunca una suma de satélites."],
      ["Ec. 4 · Anomalía HFAI", "Cuántas desviaciones estándar se aleja un mes de la media del mismo mes calendario, calculado por sensor frente a su propia línea base (MODIS 2003–2022, VIIRS 2012–2025) sobre log(1 + X), y luego combinado. Clases: bajo lo normal (z < −0,5), esperado (−0,5 a 1), alerta moderada (1 a 2), crítico (z > 2)."],
      ["Ec. 5 · Índice de Severidad del Fuego", "Celdas activas contiguas de 0,1° (8 vecinos) forman un conglomerado C. Cada uno recibe FRP (escala log), área A (celdas) y duración D (racha más larga de días consecutivos) reescalados a 0–100 entre los conglomerados del mes en el país, y se ponderan 45 / 35 / 20. Es un puntaje relativo, nunca hectáreas."],
    ],
    deviations: "Dónde nos apartamos del informe",
    devs: [
      "Z se calcula sobre log(1 + X), no sobre conteos crudos, porque los conteos mensuales son asimétricos y a menudo cero.",
      "También calculamos Z sobre la serie armonizada con una sola línea base 2003–2022 y verificamos que coincide con el HFAI por sensor en el solape.",
      "Mantenemos la grilla cuadrada de 0,1° (dibujada como mapa de calor suave) en lugar de H3 resolución 5–6; H3 queda como trabajo futuro.",
      "VIIRS es una sola cadena en la escala de S-NPP: S-NPP hasta el 2 nov 2026 y luego NOAA-20 enlazado a S-NPP con su propia razón de solape.",
      "La banda p5–p95 sale de la dispersión de γ anual entre los años de solape.",
      "El alcance predictivo se reduce a un SARIMA estacional sobre log(1 + X). Mapas espaciales de riesgo con LightGBM/XGBoost, explicaciones SHAP, covariables meteorológicas y carga de archivos quedan como trabajo futuro.",
    ],
    frpCal: "Calibración de FRP por región (Ec. 2)",
    region: "Región",
    sources: "Fuentes de datos y atribuciones",
    srcs: [
      "Datos de fuego: archivo de NASA FIRMS — MODIS Colección 6.1 (MCD14ML) y VIIRS 375 m (VNP14IMG, VJ114IMG).",
      "Límites administrativos: Natural Earth admin-1 (dominio público).",
      "Índice Oceánico del Niño (ONI): NOAA Climate Prediction Center.",
      "Viento (WS10M, WD10M): NASA POWER, mensual.",
      "Mapa base: Sentinel-2 cloudless by EOX (uso no comercial, CC BY-NC-SA 4.0).",
      "Límites vectoriales: © OpenFreeMap © OpenStreetMap contributors.",
      "Asistente de IA: Claude (Anthropic) con herramientas sobre los JSON publicados. Las respuestas se rotulan como generadas por IA.",
    ],
  },
};

/* Formulas: plain HTML (italic variables, sub/superscripts), identical in both languages. */
const V = ({ children }: { children: ReactNode }) => <var className="font-normal italic">{children}</var>;
const Frac = ({ num, den }: { num: ReactNode; den: ReactNode }) => (
  <span className="mx-1 inline-flex flex-col items-center align-middle leading-tight">
    <span className="border-b border-[var(--text-3)] px-1 pb-0.5">{num}</span>
    <span className="px-1 pt-0.5">{den}</span>
  </span>
);
const FORMULAS: ReactNode[] = [
  <>
    FRP<sub>r,t,s</sub> = Σ<sub>i ∈ (r,t,s)</sub> FRP<sub>i</sub>
  </>,
  <span key="eq2" className="flex flex-col gap-1.5">
    <span>
    ln FRP<sub>VIIRS</sub> = ln <V>α</V>
    <sub>r</sub> + <V>β</V>
    <sub>r</sub> · ln FRP<sub>MODIS</sub>
    </span>
    <span>
    <span className="mr-2 text-[var(--text-3)]">⇒</span>
    FRP&#770; = <V>α</V>
    <sub>r</sub> · FRP<sub>MODIS</sub>
    <sup>
      <V>β</V>
      <sub>r</sub>
    </sup>
    </span>
  </span>,
  <>
    <V>Ñ</V>
    <sub>t</sub> = <V>w</V> · (<V>γ</V> · <V>N</V>
    <sub>MODIS</sub>) + (1 − <V>w</V>) · <V>N</V>
    <sub>VIIRS</sub>
    <span className="ml-3 text-[var(--text-3)]">
      <V>w</V> = 0.5
    </span>
  </>,
  <>
    <V>Z</V> =
    <Frac
      num={
        <>
          log(1 + <V>X</V>) − <V>μ</V>
        </>
      }
      den={
        <>
          <V>σ</V> + 10<sup>−5</sup>
        </>
      }
    />
  </>,
  <>
    FSI(<V>C</V>) = 0.45 · FRP<sub>norm</sub> + 0.35 · <V>A</V>
    <sub>norm</sub> + 0.20 · <V>D</V>
    <sub>norm</sub>
  </>,
];

export function MethodView() {
  const { lang, t } = useI18n();
  const { regions } = useStore();
  const c = COPY[lang];
  const regionName = (id: string) => (regions?.status === "ok" ? regions.data.find((r) => r.id === id)?.name : undefined) ?? id;
  const [val, setVal] = useState<LoadResult<Validation> | null>(null);
  useEffect(() => {
    loadValidation().then(setVal);
  }, []);
  const loyo = val?.status === "ok" ? val.data.loyo : [];
  const mean = (k: "mape_raw" | "mape_harmonized" | "r") => {
    const v = loyo.map((x) => x[k]).filter((x): x is number => x != null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };

  return (
    <article className="panel panel-solid pointer-events-auto mx-auto max-h-full w-full max-w-4xl overflow-y-auto px-5 py-6 text-[14px] leading-relaxed text-[var(--text-2)] sm:px-9 sm:py-8">
      <h2 className="mb-3 text-[24px] leading-tight font-semibold tracking-[-0.02em] text-[var(--text-1)]">{c.title}</h2>
      <p className="max-w-[68ch] text-[15px] text-[var(--text-1)]/90">{c.intro}</p>
      <section className="mt-7 rounded-xl border border-[var(--line)] bg-[var(--ink-2)] p-4 sm:p-5">
        <h3 className="mb-3 text-[16px] font-semibold tracking-[-0.01em] text-[var(--text-1)]">{t("twoSensorsTitle")}</h3>
        <TwoSensors />
      </section>
      {/* The pipeline is a true sequence, so the step numbers carry information. */}
      <ol className="mt-6 grid gap-x-8 sm:grid-cols-2">
        {c.steps.map(([h, b], i) => (
          <li key={h} className="grid grid-cols-[1.5rem_1fr] gap-x-2 border-t border-[var(--line)] py-4">
            <span className="num pt-px text-[13px] text-[var(--text-3)]">{i + 1}</span>
            <div>
              <p className="font-semibold text-[var(--text-1)]">{h}</p>
              <p className="mt-1 text-[13px]">{b}</p>
            </div>
          </li>
        ))}
      </ol>

      <h3 className="mt-9 mb-3 text-[16px] font-semibold tracking-[-0.01em] text-[var(--text-1)]">{c.equations}</h3>
      <ol className="flex flex-col">
        {c.eqs.map(([h, b], i) => (
          <li key={h} className="grid gap-x-8 gap-y-2 border-t border-[var(--line)] py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div>
              <p className="font-semibold text-[var(--text-1)]">{h}</p>
              <p className="mt-1 text-[13px]">{b}</p>
            </div>
            <div className="num flex items-center overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--ink-2)] px-4 py-3 text-[15px] whitespace-nowrap text-[var(--text-1)]">
              <span>{FORMULAS[i]}</span>
            </div>
          </li>
        ))}
      </ol>

      <h3 className="mt-9 mb-3 text-[16px] font-semibold tracking-[-0.01em] text-[var(--text-1)]">{c.deviations}</h3>
      <ul className="max-w-[72ch] list-disc space-y-1.5 pl-5 marker:text-[var(--text-3)] text-[var(--text-2)]">
        {c.devs.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>

      <h3 className="mt-9 mb-3 text-[16px] font-semibold tracking-[-0.01em] text-[var(--text-1)]">{c.validation}</h3>
      {val?.status !== "ok" ? (
        <DataState result={val} file="/data/validation.json" />
      ) : (
        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="mb-2 text-[var(--text-2)]">{c.loyo}</p>
            <table className="num w-full text-xs">
              <thead className="text-[var(--text-3)]">
                <tr>
                  <th className="py-1 text-left font-normal">{c.year}</th>
                  <th className="text-right font-normal">{c.mapeRaw}</th>
                  <th className="text-right font-normal">{c.mapeHarm}</th>
                  <th className="text-right font-normal">{c.r}</th>
                </tr>
              </thead>
              <tbody>
                {loyo.map((r) => (
                  <tr key={r.year} className="border-t border-[var(--line)]">
                    <td className="py-1">{r.year}</td>
                    <td className="text-right text-[var(--text-2)]">{pct(r.mape_raw)}</td>
                    <td className="text-right text-[var(--sci)]">{pct(r.mape_harmonized)}</td>
                    <td className="text-right">{fmt(r.r, 2)}</td>
                  </tr>
                ))}
                <tr className="border-t border-[var(--line-strong)] font-semibold">
                  <td className="py-1">{c.mean}</td>
                  <td className="text-right text-[var(--text-2)]">{pct(mean("mape_raw"))}</td>
                  <td className="text-right text-[var(--sci)]">{pct(mean("mape_harmonized"))}</td>
                  <td className="text-right">{fmt(mean("r"), 2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <p className="mb-2 text-[var(--text-2)]">{c.seam}</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-[var(--line)] p-4">
                <p className="t-label">{c.seamRaw}</p>
                <p className="t-figure num mt-1 !text-[32px] !text-[var(--text-2)]">×{fmt(val.data.seam_2012.raw_ratio, 2)}</p>
              </div>
              <div className="rounded-lg border border-[var(--line)] p-4">
                <p className="t-label">{c.seamHarm}</p>
                <p className="t-figure num mt-1 !text-[32px] !text-[var(--sci)]">×{fmt(val.data.seam_2012.harmonized_ratio, 2)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {val?.status === "ok" && (val.data.frp_calibration?.length ?? 0) > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-[var(--text-2)]">{c.frpCal}</p>
          <table className="num w-full max-w-xl text-xs">
            <thead className="text-[var(--text-3)]">
              <tr>
                <th className="py-1 text-left font-normal">{c.region}</th>
                <th className="text-right font-normal">α</th>
                <th className="text-right font-normal">β</th>
                <th className="text-right font-normal">R²</th>
                <th className="text-right font-normal">n</th>
              </tr>
            </thead>
            <tbody>
              {val.data.frp_calibration!.map((r) => (
                <tr key={r.region_id} className="border-t border-[var(--line)]">
                  <td className="py-1">{regionName(r.region_id)}</td>
                  <td className="text-right">{fmt(r.alpha, 3)}</td>
                  <td className="text-right">{fmt(r.beta, 2)}</td>
                  <td className="text-right">{fmt(r.r2, 2)}</td>
                  <td className="text-right">{fmt(r.n, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="mt-9 mb-3 text-[16px] font-semibold tracking-[-0.01em] text-[var(--text-1)]">{c.limitations}</h3>
      <ul className="max-w-[72ch] list-disc space-y-1.5 pl-5 marker:text-[var(--text-3)] text-[var(--text-2)]">
        {c.lims.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>

      <h3 className="mt-9 mb-3 text-[16px] font-semibold tracking-[-0.01em] text-[var(--text-1)]">{c.sources}</h3>
      <ul className="max-w-[72ch] list-disc space-y-1.5 pl-5 marker:text-[var(--text-3)] text-[var(--text-2)]">
        {c.srcs.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </article>
  );
}
