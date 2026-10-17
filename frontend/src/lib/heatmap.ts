import type { ExpressionSpecification } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";

import type { HeatmapResponse } from "@/api/types";
import { metresPerPixel } from "./geometry";
import { HEAT_ALPHA, type HeatMetric, metricStops, RISK, withAlpha } from "./risk";

export const HEAT_HOURS = 49;

const PREFIX: Record<HeatMetric, string> = { risk: "r", wind: "w", precip: "p", snow: "s" };

/** The flattened feature property for one metric at one hour: "r12", "w0". */
export function heatPropKey(metric: HeatMetric, hour: number): string {
  return `${PREFIX[metric]}${hour}`;
}

export type HeatProps = Record<string, number>;

/**
 * Stored for hours the backend returns as null (past the forecast horizon).
 * Every real value is >= 0, so the colour step draws this as transparent
 * instead of pretending it is Low.
 */
export const NO_DATA = -1;

/**
 * Turns the API's per-point arrays into one GeoJSON collection whose features
 * carry every hour as its own scalar property (r0..r48, w0..w48, p0..p48,
 * s0..s48). Built once per response: MapLibre would stringify arrays in
 * properties, and moving the slider then only swaps which property the paint
 * expression reads, never the data.
 */
export function buildHeatCollection(resp: HeatmapResponse): FeatureCollection<Point, HeatProps> {
  const features = resp.points.map((pt, i) => {
    const props: HeatProps = {};
    for (let h = 0; h < HEAT_HOURS; h++) {
      props[`r${h}`] = pt.risk[h] ?? NO_DATA;
      props[`w${h}`] = pt.wind[h] ?? NO_DATA;
      props[`p${h}`] = pt.precip[h] ?? NO_DATA;
      props[`s${h}`] = pt.snow[h] ?? NO_DATA;
    }
    return {
      type: "Feature" as const,
      id: i,
      geometry: { type: "Point" as const, coordinates: [pt.lon, pt.lat] },
      properties: props,
    };
  });
  return { type: "FeatureCollection", features };
}

/**
 * Colour for one metric at one hour: a `step` over the raw value using the
 * same thresholds as the checkpoint rules, mapped onto the risk palette with
 * the wash alpha baked in (one data-driven paint property, not two).
 * Wind here is the raw sustained wind, not load adjusted; `risk` is.
 * Hours without data (NO_DATA) fall below the first stop and stay transparent.
 */
export function heatColorExpression(metric: HeatMetric, hour: number): ExpressionSpecification {
  const [s1, s2, s3, s4] = metricStops(metric);
  const c = RISK.map((r, i) => withAlpha(r.fill, HEAT_ALPHA[i] ?? 0.5));
  return [
    "step",
    ["to-number", ["get", heatPropKey(metric, hour)], NO_DATA],
    "rgba(0, 0, 0, 0)",
    0,
    c[0] as string,
    s1,
    c[1] as string,
    s2,
    c[2] as string,
    s3,
    c[3] as string,
    s4,
    c[4] as string,
  ];
}

/**
 * Circle radius that covers the grid at every zoom: about 0.9 grid spacings,
 * so neighbouring blurred discs overlap into a continuous wash. Exponential
 * base 2 between zoom 0 and 22 is exact scaling with the map.
 */
export function heatRadiusExpression(spacingDeg: number, meanLat: number): ExpressionSpecification {
  const spacingM = spacingDeg * 111_320;
  const r0 = (0.9 * spacingM) / metresPerPixel(0, meanLat);
  return ["interpolate", ["exponential", 2], ["zoom"], 0, r0, 22, r0 * 2 ** 22];
}

export function meanLatitude(resp: HeatmapResponse): number {
  if (resp.points.length === 0) return 0;
  let s = 0;
  for (const p of resp.points) s += p.lat;
  return s / resp.points.length;
}

export const HEAT_METRICS: readonly { value: HeatMetric; label: string; unit: string }[] = [
  { value: "risk", label: "Risk", unit: "load adjusted" },
  { value: "wind", label: "Wind", unit: "mph" },
  { value: "precip", label: "Rain", unit: "in/hr" },
  { value: "snow", label: "Snow", unit: "in/hr" },
];
