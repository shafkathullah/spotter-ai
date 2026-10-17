import type { ExpressionSpecification } from "maplibre-gl";
import type { FeatureCollection, LineString, Point } from "geojson";

import type { RouteOption } from "@/api/types";
import { RISK } from "./risk";

/** Feature id for a checkpoint in the shared checkpoints source (feature-state needs numbers). */
export function checkpointFeatureId(routeIndex: number, idx: number): number {
  return routeIndex * 100_000 + idx;
}

/** `match` on a 0..4 level property to the risk fill colours. */
export function levelColorExpression(prop = "level"): ExpressionSpecification {
  return [
    "match",
    ["get", prop],
    0,
    RISK[0].fill,
    1,
    RISK[1].fill,
    2,
    RISK[2].fill,
    3,
    RISK[3].fill,
    4,
    RISK[4].fill,
    RISK[0].fill,
  ];
}

export interface RouteProps {
  route_id: string;
  recommended: boolean;
}

export function routesCollection(routes: readonly RouteOption[]): FeatureCollection<LineString, RouteProps> {
  return {
    type: "FeatureCollection",
    features: routes.map((r, i) => ({
      type: "Feature",
      id: i,
      geometry: r.geometry,
      properties: { route_id: r.id, recommended: r.recommended },
    })),
  };
}

export interface CheckpointProps {
  route_id: string;
  idx: number;
  level: number;
}

export function checkpointsCollection(routes: readonly RouteOption[]): FeatureCollection<Point, CheckpointProps> {
  return {
    type: "FeatureCollection",
    features: routes.flatMap((r, ri) =>
      r.checkpoints.map((c) => ({
        type: "Feature" as const,
        id: checkpointFeatureId(ri, c.idx),
        geometry: { type: "Point" as const, coordinates: [c.lon, c.lat] },
        properties: { route_id: r.id, idx: c.idx, level: c.level },
      })),
    ),
  };
}

/**
 * The selected route's line coloured by risk along its length: a `step` on
 * `line-progress` that changes colour where one checkpoint's owned stretch
 * hands over to the next (the midpoint between them). Runs of the same level
 * merge, so a long Low stretch is one stop. Needs `lineMetrics` on the source.
 */
export function routeGradientExpression(route: RouteOption): ExpressionSpecification {
  const cps = route.checkpoints;
  const total = route.distance_mi;
  const first = cps[0];
  if (!first || total <= 0) return ["step", ["line-progress"], RISK[0].fill, 1, RISK[0].fill];

  const stops: (string | number)[] = [];
  let current = first.level;
  let lastStop = 0;
  for (let i = 1; i < cps.length; i++) {
    const cp = cps[i];
    const prev = cps[i - 1];
    if (!cp || !prev || cp.level === current) continue;
    const boundary = (prev.distance_mi + cp.distance_mi) / 2 / total;
    const at = Math.min(0.999999, Math.max(boundary, lastStop + 1e-6));
    stops.push(at, RISK[cp.level].fill);
    lastStop = at;
    current = cp.level;
  }
  if (stops.length === 0) return ["step", ["line-progress"], RISK[first.level].fill, 1, RISK[first.level].fill];
  return ["step", ["line-progress"], RISK[first.level].fill, ...stops] as ExpressionSpecification;
}
