/**
 * One visual system for map, calendar and legends, tuned for a light UI.
 *
 * Data color is one sequential fire ramp, pale yellow → amber → orange → red → maroon
 * (YlOrRd family). Lightness falls monotonically, so it stays ordered under deuteranopia and
 * protanopia; the low end is a saturated pale yellow (not cream) so it stays visible on
 * green and brown satellite imagery, and there is no black end. The same ramp colors the 0.1° pixel
 * mosaic, the sensor footprints and the calendar. UI chrome uses cool neutrals plus one
 * science blue (ACCENT) that is never a data color.
 */

/** Data ramp, low → high. */
export const FIRE = ["#ffe45c", "#fec94a", "#fda63a", "#f97d2e", "#ec5326", "#cf2e21", "#a3171f", "#6e0d1a"];

/** CSS gradient for legends, identical stops to the calendar and the map. */
export const FIRE_GRADIENT = `linear-gradient(90deg, ${FIRE.join(", ")})`;

/** MapLibre color expression over a 0..1 property, evenly spaced FIRE stops. */
export function fireExpr(prop: string): unknown[] {
  const stops: unknown[] = [];
  FIRE.forEach((c, i) => stops.push(i / (FIRE.length - 1), c));
  return ["interpolate", ["linear"], ["get", prop], ...stops];
}

/** Time-series hues: harmonized wears a deep ramp crimson; raw sensors an ochre / teal pair (CVD-safe). */
export const SERIES = {
  modis: "#a3792a",
  viirs: "#1f8790",
  harmonized: "#b5324f",
};

/** Science blue: the single UI accent (selection, peak/record marks, focus). */
export const ACCENT = "#00d2ff";

/** Cool neutral ramp mirrored from globals.css for canvas renderers (ECharts, MapLibre). */
export const UI = {
  ground: "#030816",
  surface: "rgba(8, 20, 42, 0.88)",
  text1: "#f1f5f9",
  text2: "#cbd5e1",
  text3: "#94a3b8",
  line: "rgba(56, 189, 248, 0.25)",
  grid: "rgba(56, 189, 248, 0.12)",
  cellGap: "#061228",
  tooltip: "rgba(8, 20, 42, 0.95)",
};

export const NO_DATA = "rgba(15, 29, 58, 0.5)";
export const HATCH = "rgba(56, 189, 248, 0.25)";

/**
 * HFAI anomaly classes (report Eq. 4): a diverging blue / neutral / amber / vermilion scale.
 * Blue vs orange is the colorblind-safe opposition; moderate vs critical also differ strongly
 * in lightness, so the four classes stay distinct under deuteranopia and protanopia on white.
 */
export const ANOMALY: Record<"below" | "normal" | "moderate" | "critical", string> = {
  below: "#3f7cbf",
  normal: "#dfe5ec",
  moderate: "#f0a43a",
  critical: "#b8321f",
};

/** ENSO phase strip (ONI): La Niña blue, El Niño orange, neutral a faint rule. */
export const ENSO: Record<"el_nino" | "la_nina" | "neutral", string> = {
  el_nino: "#e0763a",
  la_nina: "#3d80c4",
  neutral: "rgba(56, 189, 248, 0.18)",
};

/** Experimental outlook badges: the warm alert hues. */
export const ALERT = { yellow: "#fbbf24", red: "#ff4b4b" };

/** Forecast chart: the model is drawn in science blue so the observed series leads. */
export const MODEL = { line: "#00d2ff", band: "rgba(0, 210, 255, 0.18)", train: "rgba(0, 210, 255, 0.06)" };

/** Wind arrows: white hairlines over the imagery. */
export const WIND = "rgba(255,255,255,0.85)";

/** Sensor identity (outline / legend chips), kept out of the fire ramp. */
export const SENSOR = { modis: "#a3792a", viirs: "#1f8790" };

/** Sample the data ramp at t in [0, 1]. */
export function fireAt(t: number): string {
  const i = Math.max(0, Math.min(FIRE.length - 1, Math.round(t * (FIRE.length - 1))));
  return FIRE[i];
}
