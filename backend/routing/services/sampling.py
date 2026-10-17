"""Checkpoint placement, ETA interpolation and owned-mile accounting along a route.

A `Track` is the provider route reduced to what sampling needs:
  * coords:  route vertices (lon, lat)
  * cum_mi:  cumulative distance at each vertex, scaled so the last value equals the provider's
             reported route distance (so every mile figure in the API agrees with distance_mi)
  * cum_s:   cumulative travel time at each vertex, built from the provider's per-segment /
             per-step durations, so ETAs reflect slow city streets vs fast interstate stretches.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from .geo import LonLat, cumulative_miles, point_at_distance, segment_index


@dataclass
class Track:
    coords: list[LonLat]
    cum_mi: list[float]
    cum_s: list[float]

    @property
    def distance_mi(self) -> float:
        return self.cum_mi[-1]

    @property
    def duration_s(self) -> float:
        return self.cum_s[-1]

    def position_at(self, d_mi: float) -> LonLat:
        return point_at_distance(self.coords, self.cum_mi, d_mi)

    def elapsed_at(self, d_mi: float) -> float:
        """Seconds from departure to distance d, linear by distance within the containing segment."""
        cum, ts = self.cum_mi, self.cum_s
        if d_mi <= 0:
            return 0.0
        if d_mi >= cum[-1]:
            return ts[-1]
        i = segment_index(cum, d_mi)
        seg = cum[i + 1] - cum[i]
        t = 0.0 if seg <= 0 else (d_mi - cum[i]) / seg
        return ts[i] + (ts[i + 1] - ts[i]) * t


def scaled_cumulative_miles(coords: Sequence[LonLat], total_mi: float | None) -> list[float]:
    """Haversine cumulative miles, rescaled to the provider's total when one is given."""
    cum = cumulative_miles(coords)
    geo_total = cum[-1]
    if total_mi is None or geo_total <= 0:
        return cum
    k = total_mi / geo_total
    return [c * k for c in cum]


def cum_seconds_from_steps(
    coords: Sequence[LonLat], cum_mi: Sequence[float], steps: Sequence[tuple[int, int, float]]
) -> list[float]:
    """Cumulative seconds per vertex from steps given as (start_vertex, end_vertex, duration_s).

    Each step's duration is spread over its vertices in proportion to distance (linear
    interpolation by distance within the step). Vertices not covered by any step inherit the
    previous cumulative value (zero-time gaps), which keeps the series monotonic.
    """
    n = len(coords)
    seg_s = [0.0] * max(0, n - 1)
    for start, end, duration in steps:
        if end <= start or duration <= 0:
            continue
        span = cum_mi[end] - cum_mi[start]
        for j in range(start, end):
            if span > 0:
                seg_s[j] += duration * (cum_mi[j + 1] - cum_mi[j]) / span
            else:
                seg_s[j] += duration / (end - start)
    return cum_seconds_from_segments(seg_s)


def cum_seconds_from_segments(segment_seconds: Sequence[float], target_total: float | None = None) -> list[float]:
    """Cumulative seconds per vertex from per-segment durations (len = vertices - 1).

    With target_total the series is rescaled to it (e.g. OSRM annotations omit turn penalties
    that are included in the leg duration).
    """
    out = [0.0]
    for s in segment_seconds:
        out.append(out[-1] + max(0.0, s))
    if target_total is not None and out[-1] > 0:
        k = target_total / out[-1]
        out = [v * k for v in out]
    return out


def checkpoint_distances(total_mi: float, interval_mi: float) -> list[float]:
    """Origin (0), every `interval_mi`, then the destination. Never duplicates the endpoint."""
    if interval_mi <= 0:
        raise ValueError("interval must be positive")
    out = [0.0]
    k = 1
    while k * interval_mi < total_mi - 1e-9:
        out.append(k * interval_mi)
        k += 1
    if total_mi > 0:
        out.append(total_mi)
    return out


def owned_miles(distances: Sequence[float]) -> list[float]:
    """Each checkpoint owns the miles from the midpoint with its predecessor to the midpoint with
    its successor; first/last own out to the route ends. Sums exactly to the route length."""
    n = len(distances)
    if n == 0:
        return []
    if n == 1:
        return [0.0]
    out = []
    for i in range(n):
        lo = distances[0] if i == 0 else (distances[i - 1] + distances[i]) / 2
        hi = distances[-1] if i == n - 1 else (distances[i] + distances[i + 1]) / 2
        out.append(hi - lo)
    return out


@dataclass(frozen=True)
class CheckpointPlan:
    idx: int
    lon: float
    lat: float
    distance_mi: float
    eta: datetime
    owned_miles: float


def plan_checkpoints(track: Track, interval_mi: float, departure: datetime) -> list[CheckpointPlan]:
    dists = checkpoint_distances(track.distance_mi, interval_mi)
    owned = owned_miles(dists)
    plans = []
    for i, (d, own) in enumerate(zip(dists, owned, strict=False)):
        lon, lat = track.position_at(d)
        plans.append(
            CheckpointPlan(
                idx=i,
                lon=lon,
                lat=lat,
                distance_mi=d,
                eta=departure + timedelta(seconds=track.elapsed_at(d)),
                owned_miles=own,
            )
        )
    return plans
