"use client";

import { useId } from "react";
import { useI18n } from "@/lib/i18n";
import { SENSOR } from "@/lib/palette";

/**
 * "One fire, two sensors": the same fire footprint seen by one 1 km MODIS pixel and by the
 * 375 m VIIRS lattice. The VIIRS count is computed from the geometry, not typed in, so the
 * picture and the number always agree. Pure SVG, so it can be exported for the pitch deck.
 */

const KM = 200; // px per km in each panel
const V = KM * 0.375; // VIIRS pixel, 75 px
const PANEL = 260;
const CX = PANEL / 2;
const CY = 128;

/** Irregular burn footprint (~0.78 × 0.56 km), the same shape in both panels. */
const FIRE: [number, number][] = Array.from({ length: 72 }, (_, i) => {
  const a = (i / 72) * Math.PI * 2;
  const r = 1 + 0.13 * Math.sin(3 * a + 0.6) + 0.07 * Math.cos(5 * a) + 0.04 * Math.sin(9 * a);
  const x = 78 * r * Math.cos(a);
  const y = 56 * r * Math.sin(a);
  const rot = -0.32;
  return [CX + x * Math.cos(rot) - y * Math.sin(rot), CY + x * Math.sin(rot) + y * Math.cos(rot)];
});
const FIRE_PATH = "M" + FIRE.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z";

function inside(x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = FIRE.length - 1; i < FIRE.length; j = i++) {
    const [xi, yi] = FIRE[i];
    const [xj, yj] = FIRE[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// VIIRS lattice anchored so the fire straddles cell boundaries, as it does in reality.
const GX0 = CX - 1.62 * V;
const GY0 = CY - 1.45 * V;
const VCELLS: { x: number; y: number; on: boolean }[] = [];
for (let i = 0; i < 4; i++) {
  for (let j = 0; j < 4; j++) {
    const x = GX0 + i * V;
    const y = GY0 + j * V;
    let on = false;
    for (let sx = 2; sx < V && !on; sx += 3) for (let sy = 2; sy < V && !on; sy += 3) on = inside(x + sx, y + sy);
    VCELLS.push({ x, y, on });
  }
}
const N_VIIRS = VCELLS.filter((c) => c.on).length;

function Panel({ dx, title, sub, land, clip, children }: { dx: number; title: string; sub: string; land: string; clip: string; children: React.ReactNode }) {
  return (
    <g transform={`translate(${dx},0)`}>
      <rect x="0.5" y="0.5" width={PANEL - 1} height={PANEL - 1} rx="8" fill={`url(#${land})`} stroke="#c4ceda" />
      <g clipPath={`url(#${clip})`}>{children}</g>
      <text x="14" y="24" fontSize="13" fontWeight="600" fill="#0b1f3a">
        {title}
      </text>
      <text x="14" y="41" fontSize="11" fill="#5b6a7e">
        {sub}
      </text>
    </g>
  );
}

export function TwoSensors({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const uid = useId().replace(/:/g, "");
  const grad = `fire-${uid}`;
  const land = `land-${uid}`;
  const clip = `clip-${uid}`;

  const fire = <path d={FIRE_PATH} fill={`url(#${grad})`} />;

  return (
    <figure className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${PANEL * 2 + 40} ${PANEL + 46}`}
        className="h-auto w-full"
        role="img"
        aria-label={t("twoSensorsAlt", { n: N_VIIRS })}
        fontFamily="inherit"
      >
        <defs>
          <radialGradient id={grad} cx="46%" cy="52%" r="62%">
            <stop offset="0" stopColor="#fff1c1" />
            <stop offset="0.35" stopColor="#fdb85a" />
            <stop offset="0.7" stopColor="#f05a28" />
            <stop offset="1" stopColor="#a8161b" />
          </radialGradient>
          <linearGradient id={land} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#eef1e4" />
            <stop offset="1" stopColor="#e2e8d6" />
          </linearGradient>
          <clipPath id={clip}>
            <rect x="1" y="1" width={PANEL - 2} height={PANEL - 2} rx="7.5" />
          </clipPath>
        </defs>

        {/* MODIS: one 1 km pixel swallows the whole fire. */}
        <Panel dx={0} land={land} clip={clip} title={t("twoSensorsModis")} sub={t("twoSensorsModisSub")}>
          {[-1, 0, 1].map((k) => (
            <g key={k} stroke="rgba(11,31,58,0.13)" strokeWidth="1" strokeDasharray="3 3">
              <line x1={CX - KM / 2 + k * KM} y1="0" x2={CX - KM / 2 + k * KM} y2={PANEL} />
              <line x1="0" y1={CY - KM / 2 + k * KM} x2={PANEL} y2={CY - KM / 2 + k * KM} />
            </g>
          ))}
          <rect x={CX - KM / 2} y={CY - KM / 2} width={KM} height={KM} fill={SENSOR.modis} fillOpacity="0.12" />
          {fire}
          <rect x={CX - KM / 2} y={CY - KM / 2} width={KM} height={KM} fill="none" stroke="rgba(11,31,58,0.45)" strokeWidth="5" />
          <rect x={CX - KM / 2} y={CY - KM / 2} width={KM} height={KM} fill="none" stroke={SENSOR.modis} strokeWidth="2.5" />
        </Panel>

        {/* VIIRS: the 375 m lattice flags every pixel the fire touches. */}
        <Panel dx={PANEL + 40} land={land} clip={clip} title={t("twoSensorsViirs")} sub={t("twoSensorsViirsSub")}>
          {VCELLS.map((c, i) => (
            <rect key={i} x={c.x} y={c.y} width={V} height={V} fill="none" stroke="rgba(11,31,58,0.13)" strokeDasharray="3 3" />
          ))}
          {fire}
          {VCELLS.filter((c) => c.on).map((c, i) => (
            <rect key={i} x={c.x + 1} y={c.y + 1} width={V - 2} height={V - 2} fill="#d3301f" fillOpacity="0.55" stroke="#fff" strokeWidth="1.5" />
          ))}
          <path d={FIRE_PATH} fill="none" stroke="rgba(11,31,58,0.55)" strokeWidth="1" strokeDasharray="2 2" />
        </Panel>

        {/* Counts under each panel. */}
        <g fontSize="13" fill="#0b1f3a">
          <text x={PANEL / 2} y={PANEL + 30} textAnchor="middle" fontWeight="600">
            {t("twoSensorsOne")}
          </text>
          <text x={PANEL * 1.5 + 40} y={PANEL + 30} textAnchor="middle" fontWeight="600">
            {t("twoSensorsMany", { n: N_VIIRS })}
          </text>
          <text x={PANEL + 20} y={CY + 5} textAnchor="middle" fontSize="18" fill="#5b6a7e">
            =
          </text>
        </g>
        {/* Scale bar: 1 km. */}
        <g transform={`translate(14 ${PANEL - 18})`} fontSize="10" fill="#3b4a60">
          <line x1="0" y1="0" x2={KM / 2} y2="0" stroke="#0b1f3a" strokeWidth="1.5" />
          <line x1="0" y1="-4" x2="0" y2="4" stroke="#0b1f3a" strokeWidth="1.5" />
          <line x1={KM / 2} y1="-4" x2={KM / 2} y2="4" stroke="#0b1f3a" strokeWidth="1.5" />
          <text x={KM / 4} y="-6" textAnchor="middle">
            500 m
          </text>
        </g>
      </svg>
      <figcaption className={`max-w-[68ch] text-[var(--text-2)] ${compact ? "text-[12px]" : "text-[13px]"}`}>
        {t("twoSensorsCaption", { n: N_VIIRS })}
      </figcaption>
    </figure>
  );
}
