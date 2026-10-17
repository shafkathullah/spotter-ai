import type { LonLat } from "@/api/types";

export type BBox = [west: number, south: number, east: number, north: number];

export function bboxOf(lines: readonly (readonly LonLat[])[]): BBox | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const line of lines) {
    for (const [lon, lat] of line) {
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

/** Squared distance from p to segment ab, on an equirectangular plane scaled by cos(lat). */
function segDist2(p: LonLat, a: LonLat, b: LonLat, kx: number): number {
  const ax = a[0] * kx;
  const ay = a[1];
  const dx = b[0] * kx - ax;
  const dy = b[1] - ay;
  const px = p[0] * kx;
  const py = p[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (ax + t * dx);
  const ey = py - (ay + t * dy);
  return ex * ex + ey * ey;
}

/** Douglas-Peucker with tolerance in degrees (iterative, no recursion depth limit). */
export function douglasPeucker(points: readonly LonLat[], tolerance: number): LonLat[] {
  const n = points.length;
  if (n <= 2) return points.slice();
  let latSum = 0;
  for (const p of points) latSum += p[1];
  const kx = Math.cos(((latSum / n) * Math.PI) / 180);
  const tol2 = tolerance * tolerance;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number];
    let maxD = -1;
    let idx = -1;
    const a = points[first] as LonLat;
    const b = points[last] as LonLat;
    for (let i = first + 1; i < last; i++) {
      const d = segDist2(points[i] as LonLat, a, b, kx);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tol2) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  const out: LonLat[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i] as LonLat);
  return out;
}

/**
 * Simplifies a line to at most `maxPoints`, keeping as much shape as fits:
 * Douglas-Peucker, with the tolerance bracketed by doubling and then bisected
 * toward the smallest tolerance whose result fits. Endpoints always survive.
 */
export function simplifyToMax(points: readonly LonLat[], maxPoints: number): LonLat[] {
  if (points.length <= maxPoints) return points.slice();
  let lo = 0;
  let hi = 0.0005; // about 50 m
  let best = douglasPeucker(points, hi);
  while (best.length > maxPoints) {
    lo = hi;
    hi *= 2;
    best = douglasPeucker(points, hi);
  }
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const out = douglasPeucker(points, mid);
    if (out.length <= maxPoints) {
      hi = mid;
      best = out;
    } else {
      lo = mid;
    }
  }
  return best;
}

const EARTH_RADIUS_MI = 3958.7613;

export function haversineMi(a: LonLat, b: LonLat): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** The point at `fraction` (0..1) of a line's length. */
export function pointAlong(points: readonly LonLat[], fraction: number): LonLat {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0] as LonLat;
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push((cum[i - 1] as number) + haversineMi(points[i - 1] as LonLat, points[i] as LonLat));
  }
  const total = cum[cum.length - 1] as number;
  const target = Math.min(1, Math.max(0, fraction)) * total;
  for (let i = 1; i < points.length; i++) {
    const c = cum[i] as number;
    if (c >= target) {
      const prev = cum[i - 1] as number;
      const t = c === prev ? 0 : (target - prev) / (c - prev);
      const a = points[i - 1] as LonLat;
      const b = points[i] as LonLat;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  return points[points.length - 1] as LonLat;
}

/** MapLibre renders 512px tiles: metres per screen pixel at a zoom and latitude. */
export function metresPerPixel(zoom: number, lat: number): number {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}
