"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, GeoJSONSource, Map as MaplibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Crosshair, Info, X } from "lucide-react";
import { TwoSensors } from "../explainer/TwoSensors";
import { footprintRing } from "@/lib/contract";
import { loadCells, loadPixelIndex, loadPixels, loadWind } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { ACCENT, ANOMALY, FIRE, FIRE_GRADIENT, SENSOR, WIND, fireExpr } from "@/lib/palette";
import { useRegionAnalytics } from "@/lib/analytics";
import { activeSatellites, fmt } from "@/lib/series";
import { useRegion, useStore } from "@/lib/store";
import type { Bbox, CellRow, PixelDetection, Region, WindRow } from "@/lib/types";

/** Colombia + Argentina, the two study countries. */
const HOME_BOUNDS: [[number, number], [number, number]] = [
  [-80.5, -55.5],
  [-52.5, 13],
];
const GLOBE_HOME = { center: [-64, -19] as [number, number], zoom: 2.05 };
/** Star map height relative to the map (keep in sync with `background-size: auto 140%` in globals.css). */
const STAR_SCALE = 1.4;
const isPhone = () => typeof window !== "undefined" && window.innerWidth < 768;
const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Mosaic hand-off to the native 0.1° cells (a cell that fine would be < 4 px below this zoom). */
const FINE_ZOOM = 5;
/** Below this zoom the aggregate square stays at its widest (0.5°); it shrinks continuously
 *  with zoom from here up to FINE_ZOOM, where it reaches 0.1° and hands off to the native
 *  cell layer — so the square's on-screen size changes smoothly instead of jumping between
 *  two fixed sizes. */
const COARSE_MIN_ZOOM = 2;
const COARSE_STEP = 0.5;
const NATIVE_STEP = 0.1;
/** From this zoom on, true sensor footprints become the primary layer where available. */
export const PIXEL_ZOOM = 7.5;

/** setProjection throws "Style is not done loading" if called before the style is parsed (e.g. a
 *  region opened right at startup). Try now; if the style isn't ready, retry once it is. */
function setProjectionSafe(map: MaplibreMap, type: "globe" | "mercator") {
  const apply = () => {
    if (map.getProjection()?.type !== type) map.setProjection({ type });
  };
  try {
    apply();
  } catch {
    map.once("style.load", () => {
      try {
        apply();
      } catch {
        /* style still unavailable (map removed); nothing to do */
      }
    });
  }
}

/** The aggregate square's side (in degrees) for a given zoom: COARSE_STEP at/below
 *  COARSE_MIN_ZOOM, shrinking linearly to NATIVE_STEP by FINE_ZOOM. */
function coarseStepForZoom(zoom: number): number {
  const t = Math.max(0, Math.min(1, (zoom - COARSE_MIN_ZOOM) / (FINE_ZOOM - COARSE_MIN_ZOOM)));
  return COARSE_STEP - (COARSE_STEP - NATIVE_STEP) * t;
}

type Expr = ExpressionSpecification;
const FIRE_COLOR = fireExpr("w") as Expr;
const FRP_COLOR = fireExpr("t") as Expr;
const MOSAIC_OPACITY = 0.85;
/** When footprints exist, the mosaic recedes behind them at close range. */
const MOSAIC_OPACITY_RECEDE: Expr = ["interpolate", ["linear"], ["zoom"], PIXEL_ZOOM - 0.5, MOSAIC_OPACITY, PIXEL_ZOOM + 1, 0.22];

/** Shown only where imagery has not loaded yet / when the imagery layer is switched off. */
const LAND = "#e9e6dc";
const WATER = "#b9c8d6";
/** Thin dark outline that separates mosaic squares on top of the imagery. */
const GAP = "rgba(20,10,5,0.35)";

const STYLE: StyleSpecification = {
  version: 8,
  projection: { type: "globe" },
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sky: {
    "sky-color": "#0d2342",
    "horizon-color": "#7fa9d9",
    "fog-color": "#c9d8e8",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.5,
    "fog-ground-blend": 0.9,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.85, 3, 0.6, 6, 0],
  },
  sources: {
    ofm: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
    s2: {
      type: "raster",
      tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"],
      tileSize: 256,
      maxzoom: 14,
      attribution:
        '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless by EOX</a> (Contains modified Copernicus Sentinel data 2020)',
    },
    fire: { type: "geojson", data: EMPTY_FC, attribution: "Fire data: NASA FIRMS" },
    fireCoarse: { type: "geojson", data: EMPTY_FC },
    fireHeat: { type: "geojson", data: EMPTY_FC },
    pixels: { type: "geojson", data: EMPTY_FC },
    outline: { type: "geojson", data: EMPTY_FC },
    wind: { type: "geojson", data: EMPTY_FC, attribution: "Wind: NASA POWER" },
    focus: { type: "geojson", data: EMPTY_FC },
  },
  layers: [
    // ---- Fallback vector base (under the imagery). ----
    { id: "land", type: "background", paint: { "background-color": LAND } },
    { id: "water", type: "fill", source: "ofm", "source-layer": "water", paint: { "fill-color": WATER } },
    {
      id: "waterway",
      type: "line",
      source: "ofm",
      "source-layer": "waterway",
      minzoom: 5,
      paint: { "line-color": "#bfcad3", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.3, 10, 1] },
    },
    {
      // Sentinel-2 cloudless at natural brightness: only slight desaturation, a touch of contrast.
      id: "s2",
      type: "raster",
      source: "s2",
      paint: { "raster-saturation": -0.2, "raster-contrast": 0.05, "raster-fade-duration": 200 },
    },
    {
      id: "boundaries-admin1",
      type: "line",
      source: "ofm",
      "source-layer": "boundary",
      minzoom: 3.5,
      filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
      paint: {
        "line-color": "rgba(255,255,255,0.55)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 10, 0.9],
        "line-dasharray": [3, 2],
      },
    },
    {
      id: "boundaries-country",
      type: "line",
      source: "ofm",
      "source-layer": "boundary",
      filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": "rgba(255,255,255,0.85)", "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.5, 6, 1, 10, 1.4] },
    },
    // ---- Pixel mosaic: every active harmonized cell as a tightly packed square. ----
    {
      // Side shrinks continuously with zoom (coarseStepForZoom); square polygons only, so this
      // just means the data pushed into the "fireCoarse" source gets finer-grained as you zoom.
      id: "fire-coarse-fill",
      type: "fill",
      source: "fireCoarse",
      maxzoom: FINE_ZOOM,
      paint: { "fill-color": FIRE_COLOR, "fill-opacity": MOSAIC_OPACITY, "fill-antialias": false },
    },
    {
      id: "fire-coarse-gap",
      type: "line",
      source: "fireCoarse",
      maxzoom: FINE_ZOOM,
      paint: { "line-color": GAP, "line-width": ["interpolate", ["linear"], ["zoom"], 2.5, 0, 3.5, 0.4, 5, 0.6] },
    },
    {
      // Native 0.1° cells: takes over exactly where the shrinking square above left off.
      id: "fire-fill",
      type: "fill",
      source: "fire",
      minzoom: FINE_ZOOM,
      paint: { "fill-color": FIRE_COLOR, "fill-opacity": MOSAIC_OPACITY, "fill-antialias": false },
    },
    {
      // Relief by value, shown only when the flat map is pitched.
      id: "fire-extrude",
      type: "fill-extrusion",
      source: "fire",
      minzoom: FINE_ZOOM,
      layout: { visibility: "none" },
      paint: {
        "fill-extrusion-color": FIRE_COLOR,
        "fill-extrusion-height": ["*", ["get", "w"], 18000],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.9,
      },
    },
    {
      id: "fire-gap",
      type: "line",
      source: "fire",
      minzoom: FINE_ZOOM,
      paint: { "line-color": GAP, "line-width": ["interpolate", ["linear"], ["zoom"], FINE_ZOOM, 0.4, 7, 0.6, 10, 0.9] },
    },
    // ---- Thermal view: smoothed density of the same cells (visual overview only). ----
    {
      id: "fire-heat",
      type: "heatmap",
      source: "fireHeat",
      layout: { visibility: "none" },
      paint: {
        "heatmap-weight": ["get", "w"],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 2, 0.5, 6, 0.7, 10, 1.1],
        "heatmap-radius": ["interpolate", ["exponential", 2], ["zoom"], 2, 4, 5, 14, 7, 34, 10, 90],
        "heatmap-opacity": 0.9,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0, "rgba(255,237,160,0)",
          0.15, "rgba(254,217,118,0.55)",
          0.35, "rgb(253,141,60)",
          0.6, "rgb(227,26,28)",
          0.85, "rgb(177,0,38)",
          1, "rgb(110,0,30)",
        ],
      },
    },
    // ---- True sensor footprints (close zoom, demo regions). ----
    {
      id: "px-modis-fill",
      type: "fill",
      source: "pixels",
      minzoom: PIXEL_ZOOM,
      filter: ["==", ["get", "sensor"], "MODIS"],
      paint: { "fill-color": FRP_COLOR, "fill-opacity": 0.18 },
    },
    {
      id: "px-viirs-fill",
      type: "fill",
      source: "pixels",
      minzoom: PIXEL_ZOOM,
      filter: ["==", ["get", "sensor"], "VIIRS"],
      paint: { "fill-color": FRP_COLOR, "fill-opacity": 0.92 },
    },
    {
      id: "px-viirs-line",
      type: "line",
      source: "pixels",
      minzoom: PIXEL_ZOOM,
      filter: ["==", ["get", "sensor"], "VIIRS"],
      paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], PIXEL_ZOOM, 0.2, 11, 0.8, 14, 1.1] },
    },
    {
      id: "px-modis-casing",
      type: "line",
      source: "pixels",
      minzoom: PIXEL_ZOOM,
      filter: ["==", ["get", "sensor"], "MODIS"],
      paint: { "line-color": "rgba(11,31,58,0.6)", "line-width": ["interpolate", ["linear"], ["zoom"], PIXEL_ZOOM, 1.2, 11, 3.4, 14, 4.6] },
    },
    {
      id: "px-modis-line",
      type: "line",
      source: "pixels",
      minzoom: PIXEL_ZOOM,
      filter: ["==", ["get", "sensor"], "MODIS"],
      paint: { "line-color": FRP_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], PIXEL_ZOOM, 0.6, 11, 1.8, 14, 2.6] },
    },
    {
      id: "wind",
      type: "line",
      source: "wind",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": WIND, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 6, 1, 9, 1.3] },
    },
    {
      id: "outline-casing",
      type: "line",
      source: "outline",
      layout: { "line-join": "miter" },
      paint: { "line-color": "rgba(11,31,58,0.5)", "line-width": 3.6 },
    },
    {
      id: "outline",
      type: "line",
      source: "outline",
      layout: { "line-join": "miter" },
      paint: { "line-color": "#ffffff", "line-width": 1.5 },
    },
    {
      id: "focus",
      type: "line",
      source: "focus",
      paint: { "line-color": ACCENT, "line-width": 2, "line-dasharray": [2, 1.5] },
    },
    {
      id: "labels-country",
      type: "symbol",
      source: "ofm",
      "source-layer": "place",
      minzoom: 2.2,
      maxzoom: 7,
      filter: ["==", ["get", "class"], "country"],
      layout: {
        "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 2.5, 10.5, 6, 13],
        "text-letter-spacing": 0.03,
        "text-max-width": 8,
      },
      paint: { "text-color": "#ffffff", "text-halo-color": "rgba(11,20,35,0.8)", "text-halo-width": 1.3, "text-halo-blur": 0.3 },
    },
    {
      id: "labels-state",
      type: "symbol",
      source: "ofm",
      "source-layer": "place",
      minzoom: 5,
      maxzoom: 9,
      filter: ["==", ["get", "class"], "state"],
      layout: {
        "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": 10.5,
        "text-max-width": 7,
      },
      paint: { "text-color": "rgba(255,255,255,0.92)", "text-halo-color": "rgba(11,20,35,0.75)", "text-halo-width": 1.1 },
    },
    {
      id: "labels-city",
      type: "symbol",
      source: "ofm",
      "source-layer": "place",
      minzoom: 7,
      filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
      layout: {
        "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": 10.5,
      },
      paint: { "text-color": "#ffffff", "text-halo-color": "rgba(11,20,35,0.75)", "text-halo-width": 1.1 },
    },
  ],
};

const PX_LAYERS = ["px-modis-fill", "px-viirs-fill", "px-viirs-line", "px-modis-casing", "px-modis-line"];
const CELL_LAYERS = ["fire-fill", "fire-coarse-fill"];
const MOSAIC_LAYERS = ["fire-coarse-fill", "fire-coarse-gap", "fire-fill", "fire-gap", "fire-extrude"];
const LAYER_GROUPS = {
  basemap: ["s2"],
  boundaries: ["boundaries-country", "boundaries-admin1", "labels-country", "labels-state", "labels-city"],
  cells: ["fire-coarse-fill", "fire-coarse-gap", "fire-fill", "fire-gap", ...PX_LAYERS],
  outline: ["outline-casing", "outline"],
  wind: ["wind"],
} as const;

type SensorFilter = "both" | "MODIS" | "VIIRS";

/**
 * Harmonized activity as square cells of `step` degrees (0.1 = native, 0.5 = orbit aggregate).
 * Shade `w` is the cell's quantile rank among this period's active cells, so the texture shows
 * structure instead of a few saturated dots. `m` sums the per-cell normal when published.
 */
function cellsToGeoJSON(cells: CellRow[], step: number): GeoJSON.FeatureCollection {
  const agg = new Map<string, { lat: number; lon: number; h: number; m: number | null }>();
  for (const c of cells) {
    if (c.harmonized == null || c.harmonized <= 0) continue;
    const coarse = step > 0.1;
    const lon = coarse ? Math.floor(c.lon / step) * step + step / 2 : c.lon;
    const lat = coarse ? Math.floor(c.lat / step) * step + step / 2 : c.lat;
    const key = coarse ? `${lon}_${lat}` : c.cell;
    const a = agg.get(key);
    const m = c.median ?? null;
    if (a) {
      a.h += c.harmonized;
      a.m = a.m != null && m != null ? a.m + m : null;
    } else agg.set(key, { lat, lon, h: c.harmonized, m });
  }
  const list = [...agg.values()].sort((x, y) => x.h - y.h);
  const n = list.length;
  const half = step / 2;
  const features: GeoJSON.Feature[] = list.map((a, i) => {
    const [x0, y0, x1, y1] = [a.lon - half, a.lat - half, a.lon + half, a.lat + half];
    return {
      type: "Feature",
      properties: { h: a.h, m: a.m ?? -1, w: n > 1 ? i / (n - 1) : 1, lon: a.lon, lat: a.lat, step },
      geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
    };
  });
  return { type: "FeatureCollection", features };
}

/** FRP on a log scale: 1 MW -> 0, ~300 MW -> 1. */
const frpT = (frp: number | null) => (frp == null ? 0.15 : Math.max(0, Math.min(1, Math.log10(1 + frp) / Math.log10(300))));

function pixelsToGeoJSON(px: PixelDetection[]): GeoJSON.FeatureCollection {
  const sorted = [...px].sort((a, b) => (a.sensor === b.sensor ? 0 : a.sensor === "MODIS" ? -1 : 1));
  return {
    type: "FeatureCollection",
    features: sorted.map((p, i) => ({
      type: "Feature",
      id: i,
      properties: {
        sensor: p.sensor,
        sat: p.sat ?? "",
        date: p.date ?? "",
        dn: p.dn ?? "",
        frp: p.frp ?? -1,
        conf: p.conf ?? "",
        scan: p.scan_km,
        track: p.track_km,
        lon: p.lon,
        lat: p.lat,
        t: frpT(p.frp),
      },
      geometry: { type: "Polygon", coordinates: [footprintRing(p)] },
    })),
  };
}

/** Wind vectors to arrow geometry (u east, v north), length scaled by speed. */
function windToGeoJSON(rows: WindRow[]): GeoJSON.FeatureCollection {
  if (rows.length === 0) return EMPTY_FC;
  const lats = [...new Set(rows.map((r) => r.lat))].sort((x, y) => x - y);
  let step = 1;
  for (let i = 1; i < lats.length; i++) step = Math.min(step, lats[i] - lats[i - 1] || step);
  const vmax = Math.max(...rows.map((r) => r.speed), 0.1);
  const k = (0.8 * step) / vmax;
  const features: GeoJSON.Feature[] = rows.map((r) => {
    const len = Math.hypot(r.u, r.v);
    const L = Math.max(0.25 * step, r.speed * k);
    const ux = len > 0 ? r.u / len : 0;
    const uy = len > 0 ? r.v / len : 0;
    const x0 = r.lon - (ux * L) / 2;
    const y0 = r.lat - (uy * L) / 2;
    const x1 = r.lon + (ux * L) / 2;
    const y1 = r.lat + (uy * L) / 2;
    const h = Math.min(0.35 * L, 0.18 * step);
    const head = (a: number): [number, number] => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      return [x1 - h * (ux * c - uy * s), y1 - h * (ux * s + uy * c)];
    };
    return {
      type: "Feature",
      properties: { speed: r.speed },
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [x0, y0],
            [x1, y1],
          ],
          [head(0.45), [x1, y1], head(-0.45)],
        ],
      },
    };
  });
  return { type: "FeatureCollection", features };
}

function bboxRing(bb: Bbox): GeoJSON.FeatureCollection {
  const [a, b, c, d] = bb;
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[a, b], [c, b], [c, d], [a, d], [a, b]] } }],
  };
}

const bboxOutline = (r: Region | null) => (r ? bboxRing(r.bbox) : EMPTY_FC);

/** The map column is never covered by analysis panels; leave room for the place card and timeline. */
function flightPadding(el: HTMLElement) {
  const w = el.clientWidth;
  const desktop = window.innerWidth >= 1280;
  if (w < 768) return { top: 40, bottom: 40, left: 20, right: 20 };
  return { top: 56, bottom: 110, left: desktop ? 290 : 40, right: 60 };
}

/** Most specific (smallest bbox) region containing the point. */
function regionAtPoint(regions: Region[], lat: number, lon: number): Region | undefined {
  return regions
    .filter((r) => lon >= r.bbox[0] && lon <= r.bbox[2] && lat >= r.bbox[1] && lat <= r.bbox[3])
    .sort((a, b) => (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]) - (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]))[0];
}

const fmtLatLon = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"}  ${Math.abs(lon).toFixed(2)}°${lon < 0 ? "W" : "E"}`;

type CellProps = { h: number; m: number; w: number; lon: number; lat: number; step: number };
type PxProps = { sensor: string; sat: string; date: string; dn: string; frp: number; conf: string; scan: number; track: number; lon: number; lat: number };
type Probe = { x: number; y: number } & ({ kind: "cell"; p: CellProps } | { kind: "px"; p: PxProps });

export default function GlobeMap() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const { state, dispatch, regions, meta } = useStore();
  const { t } = useI18n();
  const region = useRegion();
  const { selected } = useRegionAnalytics();
  const rotating = useRef(true);
  const viewRef = useRef(state.view);
  const [zoom, setZoom] = useState(0);
  const [sensors, setSensors] = useState<SensorFilter>("both");
  const [thermal, setThermal] = useState(false);
  const [pixels, setPixels] = useState<{ key: string; data: PixelDetection[] } | null>(null);
  const [pxRegions, setPxRegions] = useState<Set<string> | null>(null);
  const [hover, setHover] = useState<Probe | null>(null);
  const [pinned, setPinned] = useState<Probe | null>(null);
  const [howTo, setHowTo] = useState(false);
  const [size, setSize] = useState({ w: 9999, h: 9999 });
  /** Raw cells behind the "fireCoarse" source, kept around so a zoom change alone can
   *  re-aggregate them at the new step without re-fetching. */
  const coarseCellsRef = useRef<CellRow[]>([]);
  useEffect(() => {
    viewRef.current = state.view;
  }, [state.view]);

  // Create map once.
  useEffect(() => {
    if (!container.current) return;
    maplibregl.setWorkerUrl("/vendor/maplibre-gl-worker.mjs");
    const phone = isPhone();
    const map = new maplibregl.Map({
      container: container.current,
      style: phone ? { ...STYLE, projection: { type: "mercator" } } : STYLE,
      center: GLOBE_HOME.center,
      zoom: GLOBE_HOME.zoom,
      attributionControl: false,
      maxPitch: 60,
    });
    if (phone) {
      map.fitBounds(HOME_BOUNDS, { padding: 16, duration: 0 });
      rotating.current = false;
    }
    mapRef.current = map;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __map?: maplibregl.Map }).__map = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.GlobeControl(), "top-right");
    map.on("load", () => setReady(true));
    const el = container.current;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);

    const stop = () => {
      rotating.current = false;
    };
    map.on("mousedown", stop);
    map.on("touchstart", stop);
    map.on("wheel", stop);
    map.on("dragstart", stop);
    map.on("zoom", () => setZoom(Math.round(map.getZoom() * 4) / 4));
    map.on("movestart", () => setHover(null));

    // Star field parallax: the NASA star map (globals.css, .maplibregl-map::before) is an
    // equirectangular sky drawn at STAR_SCALE x the map height, so one full turn of the camera
    // around the Earth scrolls exactly one sky width; latitude tilts it within the spare height.
    const syncStars = () => {
      const c = map.getCenter();
      const skyW = el.clientHeight * STAR_SCALE * 2;
      el.style.setProperty("--stars-x", `${(-c.lng / 360) * skyW}px`);
      el.style.setProperty("--stars-y", `${50 - Math.max(-1, Math.min(1, c.lat / 90)) * 50}%`);
    };
    syncStars();
    map.on("move", syncStars);
    map.on("resize", syncStars);

    // Probing: hover (fine pointers) and click/tap (all pointers) on cells and sensor pixels.
    const probeAt = (e: maplibregl.MapMouseEvent): Probe | null => {
      const feats = map.queryRenderedFeatures(e.point, { layers: [...PX_LAYERS.filter((l) => l.endsWith("fill")), ...CELL_LAYERS].filter((l) => map.getLayer(l)) });
      const px = feats.find((f) => f.layer.id.startsWith("px-"));
      const f = px ?? feats[0];
      if (!f) return null;
      return px
        ? { kind: "px", x: e.point.x, y: e.point.y, p: f.properties as PxProps }
        : { kind: "cell", x: e.point.x, y: e.point.y, p: f.properties as CellProps };
    };
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    map.on("mousemove", (e) => {
      if (!fine) return;
      const p = probeAt(e);
      setHover(p);
      map.getCanvas().style.cursor = p ? "pointer" : "";
    });
    map.on("mouseout", () => setHover(null));
    map.on("click", (e) => {
      const p = probeAt(e);
      setPinned(p);
      setHover(null);
    });

    let raf = 0;
    const spin = () => {
      // Wait for tiles between steps: nudging every frame starves the GeoJSON tile loader.
      if (rotating.current && !map.isMoving() && map.areTilesLoaded() && map.getProjection()?.type === "globe") {
        const c = map.getCenter();
        map.setCenter([c.lng + 0.015, c.lat]);
      }
      raf = requestAnimationFrame(spin);
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce && !phone) raf = requestAnimationFrame(spin);

    loadPixelIndex().then((r) => setPxRegions(new Set(r.status === "ok" ? r.data.map((x) => x.region_id) : [])));

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Camera flights: region work happens on the flat map; home is the globe (desktop) or the flat
  // two-country frame (phones).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !container.current) return;
    setPinned(null);
    if (state.view === "region" && region) {
      rotating.current = false;
      setProjectionSafe(map, "mercator");
      const [a, b, c, d] = region.bbox;
      const el = container.current;
      // The analysis column opens in the same commit, so measure the map after layout settles.
      const id = window.setTimeout(() => {
        map.resize();
        map.fitBounds(
          [
            [a, b],
            [c, d],
          ],
          { padding: flightPadding(el), duration: 2600, maxZoom: 8, essential: true },
        );
      }, 80);
      return () => window.clearTimeout(id);
    } else if (state.view === "globe" && state.flyNonce > 0) {
      if (isPhone()) {
        map.fitBounds(HOME_BOUNDS, { padding: 16, pitch: 0, duration: 2000, essential: true });
      } else {
        setProjectionSafe(map, "globe");
        map.flyTo({ center: GLOBE_HOME.center, zoom: GLOBE_HOME.zoom, pitch: 0, duration: 2400, essential: true });
        map.once("moveend", () => {
          if (viewRef.current === "globe") rotating.current = true;
        });
      }
    }
    // flyNonce intentionally retriggers flights for the same region.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.view, state.flyNonce, region?.id]);

  // Layer visibility, sensor filter, and the pitched-relief swap.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const apply = () => {
      if (!map.isStyleLoaded()) return;
      for (const [k, ids] of Object.entries(LAYER_GROUPS)) {
        const on = state.layers[k as keyof typeof LAYER_GROUPS];
        for (const id of ids) {
          let vis = on;
          if (id.startsWith("px-modis")) vis = on && sensors !== "VIIRS";
          if (id.startsWith("px-viirs")) vis = on && sensors !== "MODIS";
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis ? "visible" : "none");
        }
      }
      const heatOn = thermal && state.layers.cells;
      if (map.getLayer("fire-heat")) map.setLayoutProperty("fire-heat", "visibility", heatOn ? "visible" : "none");
      if (thermal) for (const id of MOSAIC_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
      const flat = map.getProjection()?.type === "mercator";
      const relief = !thermal && state.layers.cells && flat && map.getPitch() > 15;
      if (map.getLayer("fire-extrude")) map.setLayoutProperty("fire-extrude", "visibility", relief ? "visible" : "none");
      if (relief && map.getLayer("fire-fill")) map.setLayoutProperty("fire-fill", "visibility", "none");
    };
    apply();
    map.on("pitchend", apply);
    map.on("projectiontransition", apply);
    return () => {
      map.off("pitchend", apply);
      map.off("projectiontransition", apply);
    };
  }, [state.layers, sensors, ready, thermal]);

  // Region outline.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("outline") as GeoJSONSource | undefined)?.setData(bboxOutline(state.view === "region" ? region : null));
  }, [region, state.view, ready]);

  // FSI ranking focus.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !container.current) return;
    const src = map.getSource("focus") as GeoJSONSource | undefined;
    if (!state.focus) {
      src?.setData(EMPTY_FC);
      return;
    }
    const [a, b, c, d] = state.focus.bbox;
    src?.setData(bboxRing(state.focus.bbox));
    rotating.current = false;
    map.fitBounds(
      [
        [a, b],
        [c, d],
      ],
      { padding: flightPadding(container.current), duration: 1800, maxZoom: 9.5, essential: true },
    );
  }, [state.focus, ready]);

  // Wind arrows.
  const windOn = state.layers.wind;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("wind") as GeoJSONSource | undefined;
    if (!windOn || state.view !== "region" || !region || !selected) {
      src?.setData(EMPTY_FC);
      return;
    }
    let alive = true;
    loadWind(region.country, selected.year).then((res) => {
      if (!alive) return;
      src?.setData(res.status === "ok" ? windToGeoJSON(res.data.filter((w) => w.month === selected.month)) : EMPTY_FC);
    });
    return () => {
      alive = false;
    };
  }, [ready, windOn, state.view, region, selected]);

  // Pixel mosaic: selected region/month, or both countries for the latest month at home.
  const last = meta?.status === "ok" ? meta.data.last_month : undefined;
  const homeYear = last?.year ?? new Date().getFullYear();
  const homeMonth = last?.month ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let alive = true;
    const set = (cells: CellRow[]) => {
      if (!alive) return;
      coarseCellsRef.current = cells;
      (map.getSource("fire") as GeoJSONSource | undefined)?.setData(cellsToGeoJSON(cells, NATIVE_STEP));
      (map.getSource("fireCoarse") as GeoJSONSource | undefined)?.setData(cellsToGeoJSON(cells, coarseStepForZoom(map.getZoom())));
      const fine = cellsToGeoJSON(cells, NATIVE_STEP);
      (map.getSource("fireHeat") as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: fine.features.map((f) => ({
          type: "Feature",
          properties: f.properties,
          geometry: { type: "Point", coordinates: [f.properties?.lon as number, f.properties?.lat as number] },
        })),
      });
    };
    if (state.view === "region" && region && selected) {
      loadCells(region.id, selected.year).then((res) => {
        set(res.status === "ok" ? res.data.filter((c) => c.month === selected.month) : []);
      });
    } else if (regions?.status === "ok") {
      const nationals = regions.data.filter((r) => r.id === r.country);
      Promise.all(nationals.map((r) => loadCells(r.id, homeYear))).then((all) => {
        const cells = all.flatMap((res) => (res.status === "ok" ? res.data : []));
        set(homeMonth ? cells.filter((c) => c.month === homeMonth) : cells);
      });
    }
    return () => {
      alive = false;
    };
  }, [ready, state.view, region, selected, regions, homeYear, homeMonth]);

  // Re-aggregate the coarse mosaic as the zoom changes, so its square shrinks continuously
  // toward the native 0.1° cell instead of jumping between two fixed sizes. `zoom` is already
  // quantized to quarter-steps (see the map's "zoom" listener below), so this is cheap.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || zoom >= FINE_ZOOM) return;
    (map.getSource("fireCoarse") as GeoJSONSource | undefined)?.setData(cellsToGeoJSON(coarseCellsRef.current, coarseStepForZoom(zoom)));
  }, [zoom, ready]);

  // True sensor footprints for the selected region/month (demo regions only; missing -> mosaic).
  const pxKey = state.view === "region" && region && selected && pxRegions?.has(region.id) ? `${region.id}:${selected.year}-${selected.month}` : null;
  useEffect(() => {
    if (!pxKey || !region || !selected) return;
    let alive = true;
    loadPixels(region.id, selected.year, selected.month).then((r) => {
      if (alive) setPixels({ key: pxKey, data: r.status === "ok" ? r.data : [] });
    });
    return () => {
      alive = false;
    };
  }, [pxKey, region, selected]);
  const px = pxKey && pixels?.key === pxKey ? pixels.data : null;
  const hasPx = !!px && px.length > 0;
  const pxGeo = useMemo(() => (hasPx ? pixelsToGeoJSON(px) : EMPTY_FC), [hasPx, px]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("pixels") as GeoJSONSource | undefined)?.setData(pxGeo);
    map.setPaintProperty("fire-fill", "fill-opacity", hasPx ? MOSAIC_OPACITY_RECEDE : MOSAIC_OPACITY);
  }, [pxGeo, hasPx, ready]);

  const counts = useMemo(() => {
    const c = { MODIS: 0, VIIRS: 0 };
    for (const p of px ?? []) c[p.sensor]++;
    return c;
  }, [px]);

  const showPixels = () => {
    const map = mapRef.current;
    if (!map || !px?.length) return;
    const best = px.filter((p) => p.sensor === "MODIS").sort((a, b) => (b.frp ?? 0) - (a.frp ?? 0))[0] ?? px[0];
    rotating.current = false;
    map.flyTo({ center: [best.lon, best.lat], zoom: 11.2, pitch: 0, duration: 2400, essential: true });
  };

  const list = regions?.status === "ok" ? regions.data : [];
  const explore = state.tab === "explore";
  const inRegion = state.view === "region" && !!region && explore;
  const close = zoom >= PIXEL_ZOOM;
  // ~111 km per degree at the equator; rounded to the nearest 5 km so it doesn't jitter every tick.
  const squareKm = String(Math.max(10, Math.round((coarseStepForZoom(zoom) * 111.32) / 5) * 5));
  const period = state.view === "region" && selected ? { year: selected.year, month: selected.month as number | null } : { year: homeYear, month: homeMonth };

  const card = (probe: Probe, mode: "hover" | "pinned") => (
    <ProbeCard
      probe={probe}
      mode={mode}
      period={period}
      regions={list}
      currentRegionId={state.view === "region" ? state.regionId : null}
      onClose={() => setPinned(null)}
      onOpenRegion={(id) => {
        setPinned(null);
        dispatch({ type: "selectRegion", regionId: id });
      }}
      bounds={size}
    />
  );

  return (
    <>
      <div ref={container} style={{ position: "absolute", inset: 0 }} aria-label="Fire activity map" role="application" />

      {explore && (
        <div
          className="seg absolute left-3 z-10 text-[12px]"
          role="group"
          aria-label={t("mapViewLabel")}
          style={{ bottom: "calc(var(--map-bottom, 0px) + 112px)" }}
        >
          <button aria-pressed={!thermal} onClick={() => setThermal(false)}>{t("viewPixels")}</button>
          <button aria-pressed={thermal} onClick={() => setThermal(true)}>{t("viewThermal")}</button>
        </div>
      )}

      {explore && (
        <button
          className="panel absolute left-3 z-10 flex w-[min(20rem,calc(100%-11rem))] min-w-[13rem] flex-col gap-1.5 px-3 py-2.5 text-left"
          style={{ bottom: "calc(var(--map-bottom, 0px) + 12px)" }}
          onClick={() => setHowTo(true)}
          aria-haspopup="dialog"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-[var(--text-1)]">{t("legendTitle")}</span>
            <Info className="size-3.5 text-[var(--sci)]" aria-label={t("howToRead")} />
          </span>
          <span className="flex items-center gap-2">
            <span className="t-caption">{t("legendLow")}</span>
            <span className="h-2 flex-1 rounded-[2px]" style={{ background: FIRE_GRADIENT }} aria-hidden />
            <span className="t-caption">{t("legendHigh")}</span>
          </span>
          <span className="text-[11px] leading-snug text-[var(--text-2)]">
            {thermal ? t("legendThermal") : t("legendLine", { km: squareKm })}
          </span>
        </button>
      )}

      {inRegion && (hasPx || close) && (
        <div className="pointer-events-none absolute top-3 right-14 left-3 z-10 flex justify-end md:left-[320px]">
          <div className="panel pointer-events-auto flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-[12px]">
            {close && hasPx ? (
              <>
                <div role="group" aria-label={t("pxSensors")} className="seg">
                  {(["both", "MODIS", "VIIRS"] as const).map((s) => (
                    <button key={s} aria-pressed={sensors === s} className="!h-6 !px-2.5 !text-[12px]" onClick={() => setSensors(s)}>
                      {s === "both" ? t("pxBoth") : s}
                    </button>
                  ))}
                </div>
                <span className="flex items-center gap-1.5 text-[var(--text-2)]">
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                    <rect x="1" y="1" width="12" height="12" fill="none" stroke={SENSOR.modis} strokeWidth="2" />
                  </svg>
                  <span className="num">MODIS {counts.MODIS}</span>
                  <svg width="14" height="14" viewBox="0 0 14 14" className="ml-1.5" aria-hidden>
                    {[0, 1].map((i) => [0, 1].map((j) => <rect key={`${i}${j}`} x={1 + i * 6.5} y={1 + j * 6.5} width="5.5" height="5.5" fill={FIRE[5]} />))}
                  </svg>
                  <span className="num">VIIRS {counts.VIIRS}</span>
                </span>
                <span className="t-caption">{t("pxLegend")}</span>
              </>
            ) : close ? (
              <span className="text-[var(--text-2)]">{t("pxUnavailable")}</span>
            ) : (
              <>
                <span className="text-[var(--text-2)]">{t("pxZoomHint")}</span>
                <button className="btn btn-primary !h-7 !px-2.5 !text-[12px]" onClick={showPixels}>
                  <Crosshair className="size-3.5" aria-hidden /> {t("pxShow")}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {hover && !pinned && card(hover, "hover")}
      {pinned && card(pinned, "pinned")}

      {howTo && <HowToRead onClose={() => setHowTo(false)} />}
    </>
  );
}

function ProbeCard({
  probe,
  mode,
  period,
  regions,
  currentRegionId,
  onClose,
  onOpenRegion,
  bounds,
}: {
  probe: Probe;
  mode: "hover" | "pinned";
  period: { year: number; month: number | null };
  regions: Region[];
  currentRegionId: string | null;
  onClose: () => void;
  onOpenRegion: (id: string) => void;
  bounds: { w: number; h: number };
}) {
  const { t, monthShort } = useI18n();
  const { lat, lon } = probe.p;
  const place = regionAtPoint(regions, lat, lon);
  const country = place ? regions.find((r) => r.id === place.country) : undefined;
  const placeName = place ? (place.id === place.country ? place.name : `${place.name}, ${country?.name ?? place.country}`) : fmtLatLon(lat, lon);
  const sats = activeSatellites(period.year, period.month ?? 12).map((s) => s.name).join(", ");
  const phoneSheet = mode === "pinned";

  let body: React.ReactNode;
  if (probe.kind === "cell") {
    const c = probe.p;
    const m = c.m >= 0 ? c.m : null;
    const ratio = m && m > 0 ? c.h / m : null;
    const vs = ratio == null ? null : ratio > 1.25 ? "above" : ratio < 0.8 ? "below" : "close";
    const pct = Math.round(c.w * 100);
    body = (
      <dl className="num grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-[var(--text-3)]">{period.month ? t("ttMonth") : t("ttYear")}</dt>
        <dd className="text-right">{period.month ? `${monthShort(period.month)} ${period.year}` : period.year}</dd>
        <dt className="text-[var(--text-3)]">{t("ttValue")}</dt>
        <dd className="text-right font-semibold text-[var(--text-1)]">{t("ttUnit", { v: fmt(c.h, c.h < 10 ? 2 : 1) })}</dd>
        {m != null && (
          <>
            <dt className="text-[var(--text-3)]">{t("ttNormal")}</dt>
            <dd className="text-right">{fmt(m, m < 10 ? 2 : 1)}</dd>
          </>
        )}
        {vs && (
          <>
            <dt className="text-[var(--text-3)]">{t("ttVs")}</dt>
            <dd className="flex items-center justify-end gap-1.5 text-right">
              <span
                className="size-2.5 rounded-[2px]"
                style={{ background: vs === "above" ? ANOMALY.moderate : vs === "below" ? ANOMALY.below : ANOMALY.normal }}
                aria-hidden
              />
              {vs === "above" ? t("ttAbove") : vs === "below" ? t("ttBelow") : t("ttClose")}
            </dd>
          </>
        )}
        <dt className="text-[var(--text-3)]">{t("ttRank")}</dt>
        <dd className="text-right">{t("ttRankValue", { p: pct })}</dd>
        <dt className="text-[var(--text-3)]">{t("ttSensors")}</dt>
        <dd className="text-right">{sats || "—"}</dd>
        <dt className="text-[var(--text-3)]">{t("ttCell")}</dt>
        <dd className="text-right">{c.step > 0.1 ? "0.5° (≈ 50 km)" : "0.1° (≈ 10 km)"}</dd>
      </dl>
    );
  } else {
    const p = probe.p;
    body = (
      <dl className="num grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-[var(--text-3)]">{t("pxSensorLabel")}</dt>
        <dd className="flex items-center justify-end gap-1.5 text-right font-semibold text-[var(--text-1)]">
          <span className="size-2.5 rounded-[1px]" style={{ background: p.sensor === "MODIS" ? SENSOR.modis : SENSOR.viirs }} aria-hidden />
          {p.sensor}
          {p.sat && <span className="font-normal text-[var(--text-3)]">· {p.sat}</span>}
        </dd>
        <dt className="text-[var(--text-3)]">{t("pxDate")}</dt>
        <dd className="text-right">
          {p.date || "—"}
          {p.dn && <span className="text-[var(--text-3)]"> · {p.dn === "N" ? t("pxNight") : t("pxDay")}</span>}
        </dd>
        <dt className="text-[var(--text-3)]">FRP</dt>
        <dd className="text-right">{p.frp >= 0 ? `${p.frp.toFixed(1)} MW` : "—"}</dd>
        <dt className="text-[var(--text-3)]">{t("pxConf")}</dt>
        <dd className="text-right">{confLabel(p.conf, t)}</dd>
        <dt className="text-[var(--text-3)]">{t("pxSize")}</dt>
        <dd className="text-right">
          {p.scan < 1 ? `${Math.round(p.scan * 1000)} × ${Math.round(p.track * 1000)} m` : `${p.scan.toFixed(2)} × ${p.track.toFixed(2)} km`}
        </dd>
      </dl>
    );
  }

  const openable = place && place.id !== currentRegionId && mode === "pinned";
  const inner = (
    <>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-[var(--text-1)]">{placeName}</p>
          <p className="t-caption num">{fmtLatLon(lat, lon)}</p>
        </div>
        {mode === "pinned" && (
          <button className="btn btn-quiet btn-icon -mt-1 -mr-1 !size-7 shrink-0" aria-label={t("close")} onClick={onClose}>
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {body}
      {openable && (
        <button className="btn btn-primary mt-3 w-full justify-center !h-8" onClick={() => onOpenRegion(place.id)}>
          {t("ttOpen", { name: place.name })}
        </button>
      )}
      {mode === "hover" && probe.kind === "cell" && <p className="t-caption mt-2">{t("ttTap")}</p>}
    </>
  );

  if (phoneSheet) {
    return (
      <>
        {/* Phones: bottom sheet. Wider screens: a card pinned next to the tapped square. */}
        <div role="dialog" aria-label={t("pxCard")} className="panel fixed inset-x-0 bottom-0 z-[65] rounded-b-none p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-[13px] md:hidden">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-[var(--line-strong)]" aria-hidden />
          {inner}
        </div>
        <div
          role="dialog"
          aria-label={t("pxCard")}
          className="panel absolute z-20 hidden w-64 p-3 text-[12px] md:block"
          style={{ left: Math.min(probe.x + 14, bounds.w - 272), top: Math.max(8, Math.min(probe.y + 14, bounds.h - 300)) }}
        >
          {inner}
        </div>
      </>
    );
  }
  return (
    <div
      role="tooltip"
      className="panel pointer-events-none absolute z-20 w-60 p-3 text-[12px]"
      style={{ left: Math.min(probe.x + 16, bounds.w - 256), top: Math.max(8, Math.min(probe.y + 16, bounds.h - 280)) }}
    >
      {inner}
    </div>
  );
}

function HowToRead({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(11,31,58,0.35)] p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="howto-title"
        className="panel max-h-[88dvh] w-full max-w-2xl overflow-y-auto rounded-b-none p-5 sm:rounded-b-[10px] sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="howto-title" className="text-[18px] font-semibold tracking-[-0.015em] text-[var(--text-1)]">
            {t("howToRead")}
          </h2>
          <button className="btn btn-quiet btn-icon -mt-1 -mr-2" aria-label={t("close")} onClick={onClose} autoFocus>
            <X className="size-4" />
          </button>
        </div>
        <ul className="flex flex-col gap-2.5 text-[13px] text-[var(--text-2)]">
          <li className="grid grid-cols-[3.5rem_1fr] items-center gap-3">
            <span className="h-2.5 rounded-[2px]" style={{ background: FIRE_GRADIENT }} aria-hidden />
            <span>{t("howToColor")}</span>
          </li>
          <li className="grid grid-cols-[3.5rem_1fr] items-center gap-3">
            <svg width="56" height="16" viewBox="0 0 56 16" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <rect key={i} x={i * 14} y="1" width="13" height="13" fill={FIRE[2 + i]} />
              ))}
            </svg>
            <span>{t("howToSquare")}</span>
          </li>
          <li className="grid grid-cols-[3.5rem_1fr] items-center gap-3">
            <svg width="56" height="16" viewBox="0 0 56 16" aria-hidden>
              <rect x="1" y="1" width="14" height="14" fill="none" stroke={SENSOR.modis} strokeWidth="2" />
              {[0, 1].map((i) => [0, 1].map((j) => <rect key={`${i}${j}`} x={24 + i * 7} y={1 + j * 7} width="6" height="6" fill={FIRE[5]} />))}
            </svg>
            <span>{t("howToPixels")}</span>
          </li>
          <li className="grid grid-cols-[3.5rem_1fr] items-start gap-3">
            <span className="t-label pt-0.5">{t("harmonized")}</span>
            <span>{t("infoHarmonized")}</span>
          </li>
        </ul>
        <div className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--ink-2)] p-4">
          <h3 className="mb-3 text-[15px] font-semibold text-[var(--text-1)]">{t("twoSensorsTitle")}</h3>
          <TwoSensors compact />
        </div>
      </div>
    </div>
  );
}

function confLabel(c: string, t: ReturnType<typeof useI18n>["t"]): string {
  if (!c) return "—";
  const s = c.toLowerCase();
  if (s === "l" || s === "low") return t("pxConfLow");
  if (s === "n" || s === "nominal") return t("pxConfNominal");
  if (s === "h" || s === "high") return t("pxConfHigh");
  return /^\d+(\.\d+)?$/.test(s) ? `${Math.round(Number(s))}%` : c;
}
