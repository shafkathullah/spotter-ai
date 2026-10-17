/**
 * Builds src/dev/fixture.json, the dev-only sample answer for `?fixture=1`.
 *
 *   node scripts/build-fixture.ts <osrm-alternatives.json> <osrm-detour.json> src/dev/fixture.json
 *
 * Inputs are raw OSRM responses (overview=full, geometries=geojson,
 * steps=true): the first holds the provider's alternatives, the second a
 * route forced through a detour waypoint. Weather is synthetic
 * (src/dev/synthetic-weather.ts), timed to each checkpoint's ETA, and the
 * brief's risk and ranking rules are applied so the UI sees a realistic
 * contract-shaped answer. Node 22.18+ runs this file directly (type stripping).
 */
import { readFileSync, writeFileSync } from "node:fs";

import type { Checkpoint, LonLat, RiskLevel, RouteOption, RoutesResponse } from "../src/api/types.ts";
import { haversineMi, simplifyToMax } from "../src/lib/geometry.ts";
import { RISK } from "../src/lib/risk.ts";
import { assessWeather } from "../src/dev/fixture-rules.ts";
import { syntheticWeather } from "../src/dev/synthetic-weather.ts";

const [altPath, detourPath, outPath] = process.argv.slice(2);
if (!altPath || !detourPath || !outPath) throw new Error("usage: build-fixture.ts <alts.json> <detour.json> <out.json>");

const DEPARTURE = "2026-10-18T08:00:00-05:00";
const LOAD_LB = 42_000;
const INTERVAL_MI = 25;
const M_PER_MI = 1609.344;

interface OsrmStep {
  distance: number;
  duration: number;
  name: string;
}
interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { coordinates: LonLat[] };
  legs: { summary: string; steps: OsrmStep[] }[];
}

const alts = JSON.parse(readFileSync(altPath, "utf8")) as { routes: OsrmRoute[] };
const detour = JSON.parse(readFileSync(detourPath, "utf8")) as { routes: OsrmRoute[] };
const raw: OsrmRoute[] = [...alts.routes, ...detour.routes.slice(0, 1)].slice(0, 3);

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;
const depMs = new Date(DEPARTURE).getTime();

/** ISO with the departure's -05:00 offset, like the backend echoes. */
function isoAt(ms: number): string {
  const local = new Date(ms - 5 * 3600_000);
  return local.toISOString().slice(0, 19) + "-05:00";
}

function build(r: OsrmRoute) {
  const coords = r.geometry.coordinates;
  const totalMi = r.distance / M_PER_MI;

  // Geometry distance, scaled so it ends at the provider's total.
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1]! + haversineMi(coords[i - 1]!, coords[i]!));
  const scale = totalMi / cum[cum.length - 1]!;
  for (let i = 0; i < cum.length; i++) cum[i] = cum[i]! * scale;

  const pointAt = (d: number): LonLat => {
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! <= d) lo = mid;
      else hi = mid;
    }
    const a = coords[lo]!;
    const b = coords[hi]!;
    const span = cum[hi]! - cum[lo]!;
    const f = span === 0 ? 0 : (d - cum[lo]!) / span;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  };

  // Duration at a distance: the provider's per-step durations, linear within a step.
  const steps = r.legs.flatMap((l) => l.steps);
  const stepDist: number[] = [0];
  const stepDur: number[] = [0];
  for (const s of steps) {
    stepDist.push(stepDist[stepDist.length - 1]! + s.distance / M_PER_MI);
    stepDur.push(stepDur[stepDur.length - 1]! + s.duration);
  }
  const durationAt = (d: number): number => {
    for (let i = 1; i < stepDist.length; i++) {
      if (stepDist[i]! >= d) {
        const span = stepDist[i]! - stepDist[i - 1]!;
        const f = span === 0 ? 0 : (d - stepDist[i - 1]!) / span;
        return stepDur[i - 1]! + (stepDur[i]! - stepDur[i - 1]!) * f;
      }
    }
    return stepDur[stepDur.length - 1]!;
  };

  const dists: number[] = [];
  for (let d = 0; d < totalMi - 0.5; d += INTERVAL_MI) dists.push(d);
  dists.push(totalMi);

  const checkpoints: Checkpoint[] = dists.map((d, i) => {
    const [lon, lat] = pointAt(d);
    const etaMs = depMs + durationAt(d) * 1000;
    const hours = (etaMs - depMs) / 3600_000;
    const w = syntheticWeather(lon, lat, hours);
    const a = assessWeather(w, LOAD_LB);
    const left = i === 0 ? 0 : (dists[i - 1]! + d) / 2;
    const right = i === dists.length - 1 ? totalMi : (d + dists[i + 1]!) / 2;
    return {
      idx: i,
      lat: round(lat, 5),
      lon: round(lon, 5),
      distance_mi: round(d, 1),
      eta: isoAt(etaMs),
      owned_miles: round(right - left, 2),
      weather: w,
      levels: a.levels,
      level: a.level,
      level_label: RISK[a.level].label,
      drivers: a.drivers,
    };
  });

  const miles = { low: 0, moderate: 0, high: 0, severe: 0, no_travel: 0 };
  let weighted = 0;
  let max: RiskLevel = 0;
  for (const c of checkpoints) {
    miles[RISK[c.level].key] += c.owned_miles;
    weighted += c.level * c.owned_miles;
    if (c.level > max) max = c.level;
  }
  for (const k of Object.keys(miles) as (keyof typeof miles)[]) miles[k] = round(miles[k], 1);

  const names = Array.from(new Set(r.legs.flatMap((l) => l.summary.split(", ")).filter(Boolean)));
  return {
    geometry: { type: "LineString" as const, coordinates: simplifyToMax(coords, 1500).map(([x, y]) => [round(x, 5), round(y, 5)] as LonLat) },
    distance_mi: round(totalMi, 1),
    duration_s: Math.round(r.duration),
    arrival: isoAt(depMs + r.duration * 1000),
    description: `via ${names.join(", ")}`,
    summary: { max_level: max, avg_risk: round(weighted / totalMi, 2), miles_by_level: miles },
    checkpoints,
  };
}

const built = raw.map(build).sort((a, b) => a.duration_s - b.duration_s);
const ids = ["A", "B", "C"];
const routes: RouteOption[] = built.map((b, i) => ({
  id: ids[i]!,
  name: `Route ${ids[i]}`,
  rank: 0,
  recommended: false,
  ...b,
}));

const key = (r: RouteOption) => [
  round(r.summary.miles_by_level.no_travel, 1),
  round(r.summary.miles_by_level.severe, 1),
  round(r.summary.miles_by_level.high, 1),
  round(r.summary.avg_risk, 2),
  r.duration_s,
];
const ranked = [...routes].sort((a, b) => {
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
  return 0;
});
ranked.forEach((r, i) => {
  r.rank = i + 1;
  r.recommended = i === 0;
});
const win = ranked[0]!;

const KEY_TEXT = ["No Travel", "Severe", "High"];
const reasons = ranked.slice(1).map((o) => {
  const kw = key(win);
  const ko = key(o);
  const i = kw.findIndex((v, j) => v !== ko[j]);
  if (i >= 0 && i < 3) return `${o.name} has ${ko[i]} mi of ${KEY_TEXT[i]} weather against ${kw[i]} mi`;
  if (i === 3) return `${o.name} has a higher average risk (${ko[3]!.toFixed(2)} against ${kw[3]!.toFixed(2)})`;
  return `${o.name} is slower`;
});
const fastest = routes[0]!;
const explanation =
  `${win.name} has the least severe weather exposure. ${reasons.join("; ")}.` +
  (win.id !== fastest.id
    ? ` It takes ${Math.round((win.duration_s - fastest.duration_s) / 60)} minutes longer than ${fastest.name}, which is worth it for the lower risk.`
    : " It is also the fastest option.");

const response: RoutesResponse = {
  departure: DEPARTURE,
  interval_mi: INTERVAL_MI,
  load_lb: LOAD_LB,
  routing_provider: "osrm",
  recommended_route_id: win.id,
  no_safe_route: ranked.every((r) => r.summary.miles_by_level.no_travel > 0),
  explanation,
  warnings: [
    `${routes[2]!.name} was found by routing through a detour point, because the routing service returned only two alternatives.`,
  ],
  routes,
};

writeFileSync(outPath, JSON.stringify(response));
for (const r of routes) {
  console.log(r.id, r.rank, r.distance_mi, (r.duration_s / 3600).toFixed(2), JSON.stringify(r.summary), r.checkpoints.length, r.geometry.coordinates.length);
}
console.log(explanation);
