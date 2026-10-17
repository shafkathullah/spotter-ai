"""Weather-risk heatmap over the trip corridor.

Grid: a regular lat/lon grid (same degree spacing on both axes, a multiple of the 0.05 deg
weather snap so grid points map 1:1 onto cached weather cells). Spacing starts from the corridor
area / point budget (min ~15 km) and grows until the number of points within CORRIDOR_KM of any
route is <= the budget.

Hour h means the hour starting at start + h: wind is the instantaneous value at that stamp, while
rain/snow are Open-Meteo's preceding-hour totals, so hour h reads the value stamped h + 1 (the
total for h..h+1). This is the same convention `weather.sample_at` uses for checkpoints.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

import httpx

from .geo import LonLat, ProjectedPolyline, cumulative_miles
from .risk import risk_level
from .weather import GRID_DEG, fetch_hourly, floor_hour, snap_point

CORRIDOR_KM = 40.0
MIN_SPACING_KM = 15.0
KM_PER_DEG_LAT = 111.32
HOURS = 48


@dataclass(frozen=True)
class Grid:
    spacing_deg: float
    points: list[LonLat]


def _round_up_to_snap(deg: float) -> float:
    return round(math.ceil(deg / GRID_DEG - 1e-9) * GRID_DEG, 4)


def corridor_grid(lines: Sequence[Sequence[LonLat]], max_points: int, corridor_km: float = CORRIDOR_KM) -> Grid:
    lines = [list(line) for line in lines if line]
    if not lines:
        return Grid(spacing_deg=0.0, points=[])
    polylines = [ProjectedPolyline(line) for line in lines]
    lons = [c[0] for line in lines for c in line]
    lats = [c[1] for line in lines for c in line]
    mid_lat = math.radians((min(lats) + max(lats)) / 2)
    pad_lat = corridor_km / KM_PER_DEG_LAT
    pad_lon = corridor_km / (KM_PER_DEG_LAT * max(0.1, math.cos(mid_lat)))
    lat0, lat1 = min(lats) - pad_lat, max(lats) + pad_lat
    lon0, lon1 = min(lons) - pad_lon, max(lons) + pad_lon

    # Corridor area estimate (overlap between routes ignored -> slightly conservative).
    length_km = sum(cumulative_miles(line)[-1] * 1.609344 for line in lines)
    area_km2 = max(1.0, length_km * 2 * corridor_km + math.pi * corridor_km**2)
    spacing_km = max(MIN_SPACING_KM, math.sqrt(area_km2 / max(1, max_points)))
    spacing = _round_up_to_snap(spacing_km / KM_PER_DEG_LAT)

    while True:
        points = _points_in_corridor(polylines, spacing, lat0, lat1, lon0, lon1, corridor_km)
        if len(points) <= max_points:
            return Grid(spacing_deg=spacing, points=points)
        spacing = _round_up_to_snap(spacing * 1.1 + GRID_DEG / 2)


def _points_in_corridor(polylines, spacing, lat0, lat1, lon0, lon1, corridor_km) -> list[LonLat]:
    out: list[LonLat] = []
    i0, i1 = math.ceil(lat0 / spacing), math.floor(lat1 / spacing)
    j0, j1 = math.ceil(lon0 / spacing), math.floor(lon1 / spacing)
    for i in range(i0, i1 + 1):
        lat = round(i * spacing, 4)
        for j in range(j0, j1 + 1):
            p = (round(j * spacing, 4), lat)
            if any(pl.distance_km(p, cutoff_km=corridor_km) <= corridor_km for pl in polylines):
                out.append(p)
    return out


async def build_heatmap(
    client: httpx.AsyncClient, departure: datetime, load_lb: float, lines: Sequence[Sequence[LonLat]], max_points: int
) -> dict:
    grid = corridor_grid(lines, max_points)
    start = floor_hour(departure)
    end = start + timedelta(hours=HOURS + 1)  # one extra hour: precip for hour h is stamped h + 1
    series_by_point = await fetch_hourly(client, grid.points, start, end) if grid.points else {}
    n = HOURS + 1
    out_points = []
    for p in grid.points:
        s = series_by_point[snap_point(p)]
        risk: list[int | None] = []
        wind: list[float | None] = []
        precip: list[float | None] = []
        snow: list[float | None] = []
        for h in range(n):
            w, r, sn = s.wind[h], s.rain[h + 1], s.snow[h + 1]
            if w is None or r is None or sn is None:  # beyond forecast horizon
                risk.append(None)
            else:
                risk.append(risk_level(w, r, sn, load_lb))
            wind.append(round(w, 1) if w is not None else None)
            precip.append(round(r, 2) if r is not None else None)
            snow.append(round(sn, 2) if sn is not None else None)
        out_points.append({"lat": p[1], "lon": p[0], "risk": risk, "wind": wind, "precip": precip, "snow": snow})
    return {
        "start": start.isoformat(),
        "hours": [(start + timedelta(hours=h)).isoformat() for h in range(n)],
        "spacing_deg": grid.spacing_deg,
        "points": out_points,
    }
