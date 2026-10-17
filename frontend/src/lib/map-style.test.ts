import { describe, expect, it } from "vitest";

import type { Checkpoint, RiskLevel, RouteOption } from "@/api/types";
import { checkpointFeatureId, checkpointsCollection, routeGradientExpression } from "./map-style";
import { RISK } from "./risk";

function cp(idx: number, distance_mi: number, level: RiskLevel): Checkpoint {
  return {
    idx,
    lat: 0,
    lon: idx,
    distance_mi,
    eta: "2026-10-18T08:00:00-05:00",
    owned_miles: 0,
    weather: { wind_mph: 0, gust_mph: 0, rain_in_hr: 0, snow_in_hr: 0, temp_f: 60, weather_code: 1 },
    levels: { wind: 0, wind_load_adjusted: 0, rain: 0, snow: 0 },
    level,
    level_label: RISK[level].label,
    drivers: [],
  };
}

function route(levels: RiskLevel[], total: number): RouteOption {
  return {
    id: "A",
    name: "Route A",
    description: "",
    geometry: { type: "LineString", coordinates: [] },
    distance_mi: total,
    duration_s: 0,
    arrival: "",
    rank: 1,
    recommended: true,
    summary: { max_level: 0, avg_risk: 0, miles_by_level: { low: 0, moderate: 0, high: 0, severe: 0, no_travel: 0 } },
    checkpoints: levels.map((l, i) => cp(i, Math.min(i * 25, total), l)),
  };
}

describe("routeGradientExpression", () => {
  it("changes colour at the midpoint between checkpoints and merges runs", () => {
    // Checkpoints at 0, 25, 50, 75, 100 mi.
    const expr = routeGradientExpression(route([0, 0, 3, 3, 1], 100)) as unknown[];
    expect(expr.slice(0, 3)).toEqual(["step", ["line-progress"], RISK[0].fill]);
    // 0 -> 3 between 25 and 50 (37.5 mi), 3 -> 1 between 75 and 100 (87.5 mi).
    expect(expr.slice(3)).toEqual([0.375, RISK[3].fill, 0.875, RISK[1].fill]);
  });
  it("is a single colour when nothing changes", () => {
    const expr = routeGradientExpression(route([2, 2, 2], 50)) as unknown[];
    expect(expr[2]).toBe(RISK[2].fill);
    expect(expr[4]).toBe(RISK[2].fill);
  });
});

describe("checkpointsCollection", () => {
  it("gives every checkpoint a unique numeric id per route", () => {
    const r1 = route([0, 1], 25);
    const r2 = { ...route([2, 3], 25), id: "B" };
    const fc = checkpointsCollection([r1, r2]);
    expect(fc.features.map((f) => f.id)).toEqual([0, 1, 100_000, 100_001]);
    expect(fc.features[2]?.properties).toEqual({ route_id: "B", idx: 0, level: 2 });
    expect(checkpointFeatureId(2, 7)).toBe(200_007);
  });
});
