"""Geometry primitives. Coordinates are (lon, lat) tuples, matching GeoJSON order."""

from __future__ import annotations

import bisect
import math
from collections.abc import Sequence

EARTH_RADIUS_MI = 3958.7613
EARTH_RADIUS_KM = 6371.0088
METERS_PER_MILE = 1609.344

LonLat = tuple[float, float]


def haversine_mi(a: LonLat, b: LonLat) -> float:
    return _haversine(a, b, EARTH_RADIUS_MI)


def haversine_km(a: LonLat, b: LonLat) -> float:
    return _haversine(a, b, EARTH_RADIUS_KM)


def _haversine(a: LonLat, b: LonLat, radius: float) -> float:
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(h)))


def cumulative_miles(coords: Sequence[LonLat]) -> list[float]:
    """Cumulative haversine distance (miles) at each vertex; first entry is 0."""
    out = [0.0]
    for i in range(1, len(coords)):
        out.append(out[-1] + haversine_mi(coords[i - 1], coords[i]))
    return out


# --- Local planar projection (equirectangular around a reference latitude) ---
# Accurate to well under 1% for the ~100 km neighbourhoods used in tests below.


def _project(p: LonLat, ref_lat_rad: float) -> tuple[float, float]:
    """Project to km on a local plane."""
    lon, lat = p
    x = math.radians(lon) * math.cos(ref_lat_rad) * EARTH_RADIUS_KM
    y = math.radians(lat) * EARTH_RADIUS_KM
    return x, y


def _point_segment_dist(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    seg2 = dx * dx + dy * dy
    if seg2 == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


class ProjectedPolyline:
    """A polyline pre-projected to a local km plane for fast point-distance queries."""

    def __init__(self, coords: Sequence[LonLat]):
        if not coords:
            raise ValueError("empty polyline")
        lats = [c[1] for c in coords]
        self.ref_lat = math.radians((min(lats) + max(lats)) / 2)
        self.pts = [_project(c, self.ref_lat) for c in coords]
        xs = [p[0] for p in self.pts]
        ys = [p[1] for p in self.pts]
        self.bbox = (min(xs), min(ys), max(xs), max(ys))

    def distance_km(self, p: LonLat, cutoff_km: float | None = None) -> float:
        """Minimum distance from p to the polyline. With cutoff, returns early once below it."""
        px, py = _project(p, self.ref_lat)
        if cutoff_km is not None:
            x0, y0, x1, y1 = self.bbox
            if px < x0 - cutoff_km or px > x1 + cutoff_km or py < y0 - cutoff_km or py > y1 + cutoff_km:
                return math.inf
        pts = self.pts
        if len(pts) == 1:
            return math.hypot(px - pts[0][0], py - pts[0][1])
        best = math.inf
        for i in range(len(pts) - 1):
            ax, ay = pts[i]
            bx, by = pts[i + 1]
            # Cheap reject: segment bbox farther than current best.
            if px < min(ax, bx) - best or px > max(ax, bx) + best or py < min(ay, by) - best or py > max(ay, by) + best:
                continue
            d = _point_segment_dist(px, py, ax, ay, bx, by)
            if d < best:
                best = d
                if cutoff_km is not None and best <= cutoff_km:
                    return best
        return best


def simplify(coords: Sequence[LonLat], tolerance_km: float) -> list[LonLat]:
    """Douglas-Peucker simplification (iterative), tolerance in km on a local plane."""
    n = len(coords)
    if n <= 2:
        return list(coords)
    lats = [c[1] for c in coords]
    ref = math.radians((min(lats) + max(lats)) / 2)
    pts = [_project(c, ref) for c in coords]
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        start, end = stack.pop()
        ax, ay = pts[start]
        bx, by = pts[end]
        max_d, idx = -1.0, -1
        for i in range(start + 1, end):
            d = _point_segment_dist(pts[i][0], pts[i][1], ax, ay, bx, by)
            if d > max_d:
                max_d, idx = d, i
        if idx != -1 and max_d > tolerance_km:
            keep[idx] = True
            stack.append((start, idx))
            stack.append((idx, end))
    return [c for c, k in zip(coords, keep, strict=False) if k]


def simplify_to_max(coords: Sequence[LonLat], max_points: int) -> list[LonLat]:
    """Simplify with a growing tolerance until the result has <= max_points vertices."""
    if len(coords) <= max_points:
        return list(coords)
    tol = 0.005  # 5 m
    out = simplify(coords, tol)
    while len(out) > max_points:
        tol *= 2
        out = simplify(coords, tol)
    return out


def resample_by_count(coords: Sequence[LonLat], count: int) -> list[LonLat]:
    """`count` points evenly spaced by distance along the polyline (endpoints included)."""
    if len(coords) == 1 or count <= 1:
        return [coords[0]]
    cum = cumulative_miles(coords)
    total = cum[-1]
    if total == 0:
        return [coords[0]]
    return [point_at_distance(coords, cum, total * i / (count - 1)) for i in range(count)]


def point_at_distance(coords: Sequence[LonLat], cum: Sequence[float], d: float) -> LonLat:
    """Linearly interpolated position at distance d along a polyline with cumulative distances cum."""
    if d <= cum[0]:
        return coords[0]
    if d >= cum[-1]:
        return coords[-1]
    i = segment_index(cum, d)
    seg = cum[i + 1] - cum[i]
    t = 0.0 if seg <= 0 else (d - cum[i]) / seg
    (x0, y0), (x1, y1) = coords[i], coords[i + 1]
    return (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)


def segment_index(cum: Sequence[float], d: float) -> int:
    """Index i such that cum[i] <= d <= cum[i+1] (clamped to valid segment range)."""
    if d <= cum[0]:
        return 0
    if d >= cum[-1]:
        return max(0, len(cum) - 2)
    return bisect.bisect_right(cum, d) - 1


def overlap_fraction(
    candidate: Sequence[LonLat], existing: ProjectedPolyline, tolerance_km: float, samples: int = 120
) -> float:
    """Share of evenly spaced sample points of `candidate` lying within tolerance of `existing`."""
    pts = resample_by_count(candidate, samples)
    hits = sum(1 for p in pts if existing.distance_km(p, cutoff_km=tolerance_km) <= tolerance_km)
    return hits / len(pts)
