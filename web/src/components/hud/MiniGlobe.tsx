"use client";

import { useI18n } from "@/lib/i18n";
import { useRegionAnalytics } from "@/lib/analytics";
import { FIRE_GRADIENT } from "@/lib/palette";
import { useRegion } from "@/lib/store";

const R = 46;
const C = 50;
const L0 = (-62 * Math.PI) / 180;
const P0 = (-16 * Math.PI) / 180;

function project(lon: number, lat: number): [number, number] | null {
  const l = (lon * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  const cosc = Math.sin(P0) * Math.sin(p) + Math.cos(P0) * Math.cos(p) * Math.cos(l - L0);
  if (cosc < 0) return null;
  const x = R * Math.cos(p) * Math.sin(l - L0);
  const y = R * (Math.cos(P0) * Math.sin(p) - Math.sin(P0) * Math.cos(p) * Math.cos(l - L0));
  return [C + x, C - y];
}

function path(points: [number, number][]): string {
  let d = "";
  let pen = false;
  for (const [lon, lat] of points) {
    const pt = project(lon, lat);
    if (!pt) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

// Very coarse, schematic South America outline (decorative only).
const SA: [number, number][] = [
  [-80, -3], [-81, -6], [-77, -12], [-71, -18], [-70, -24], [-72, -33], [-74, -42], [-75, -50], [-68, -55],
  [-65, -55], [-68, -50], [-65, -42], [-57, -38], [-53, -34], [-48, -28], [-41, -22], [-39, -13], [-35, -8],
  [-35, -5], [-44, -2], [-50, 0], [-52, 4], [-60, 8], [-63, 10], [-72, 12], [-76, 9], [-77, 7], [-79, 2], [-80, -3],
];

const graticule: string[] = [];
for (let lon = -180; lon < 180; lon += 30) {
  const pts: [number, number][] = [];
  for (let lat = -90; lat <= 90; lat += 5) pts.push([lon, lat]);
  graticule.push(path(pts));
}
for (let lat = -60; lat <= 60; lat += 30) {
  const pts: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += 5) pts.push([lon, lat]);
  graticule.push(path(pts));
}
const SA_PATH = path(SA) + "Z";

/** Orientation globe + active date + the map's color key, in one quiet card. */
export function MiniGlobe() {
  const { t, monthShort } = useI18n();
  const region = useRegion();
  const { selected } = useRegionAnalytics();
  const center = region ? [(region.bbox[0] + region.bbox[2]) / 2, (region.bbox[1] + region.bbox[3]) / 2] : null;
  const pt = center ? project(center[0], center[1]) : null;

  return (
    <div className="panel pointer-events-auto flex flex-col gap-3 p-3" aria-label={t("activeDate")}>
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 100 100" className="size-16 shrink-0" aria-hidden>
          <circle cx={C} cy={C} r={R} fill="#e8eef5" stroke="rgba(11,31,58,0.28)" strokeWidth="0.8" />
          {graticule.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="rgba(11,31,58,0.09)" strokeWidth="0.5" />
          ))}
          <path d={SA_PATH} fill="rgba(11,92,173,0.10)" stroke="rgba(11,31,58,0.45)" strokeWidth="0.6" />
          {pt && (
            <g>
              <circle cx={pt[0]} cy={pt[1]} r="5.5" fill="none" stroke="var(--sci)" strokeWidth="0.8" opacity="0.6" />
              <circle cx={pt[0]} cy={pt[1]} r="2" fill="var(--sci)" />
            </g>
          )}
        </svg>
        <dl className="num grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1">
          <dt className="t-label">{t("activeDate")}</dt>
          <dd className="text-[14px] font-medium text-[var(--text-1)]">
            {selected ? `${monthShort(selected.month)} ${selected.year}` : "—"}
          </dd>
          <dt className="t-label">{t("center")}</dt>
          <dd className="text-[12px] text-[var(--text-2)]">
            {center
              ? `${Math.abs(center[1]).toFixed(2)}°${center[1] < 0 ? "S" : "N"}  ${Math.abs(center[0]).toFixed(2)}°${center[0] < 0 ? "W" : "E"}`
              : "—"}
          </dd>
        </dl>
      </div>
      <div className="border-t border-[var(--line)] pt-2.5">
        <p className="t-label mb-1.5">{t("activity")}</p>
        <div className="h-1.5 rounded-full" style={{ background: FIRE_GRADIENT }} aria-hidden />
        <div className="t-caption mt-1 flex justify-between">
          <span>{t("low")}</span>
          <span>{t("high")}</span>
        </div>
      </div>
    </div>
  );
}
