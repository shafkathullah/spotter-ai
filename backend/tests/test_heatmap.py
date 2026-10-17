from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs

import httpx
import pytest
import respx

from routing.services.geo import ProjectedPolyline
from routing.services.heatmap import CORRIDOR_KM, build_heatmap, corridor_grid
from routing.services.weather import floor_hour

LINE = [(-100.0 + i * 0.05, 35.0) for i in range(81)]  # ~365 km east-west


def test_grid_points_lie_within_corridor_and_on_snap_grid():
    g = corridor_grid([LINE], max_points=400)
    pl = ProjectedPolyline(LINE)
    assert 0 < len(g.points) <= 400
    assert all(pl.distance_km(p) <= CORRIDOR_KM + 1e-6 for p in g.points)
    assert round(g.spacing_deg / 0.05, 6) == int(round(g.spacing_deg / 0.05))
    for lon, lat in g.points:
        assert round(lon / g.spacing_deg, 6) == round(lon / g.spacing_deg)
        assert round(lat / g.spacing_deg, 6) == round(lat / g.spacing_deg)


def test_grid_excludes_points_outside_corridor():
    g = corridor_grid([LINE], max_points=400)
    lats = {lat for _, lat in g.points}
    assert max(lats) <= 35 + CORRIDOR_KM / 111 + 1e-9
    assert min(lats) >= 35 - CORRIDOR_KM / 111 - 1e-9
    # A point the bbox would include but the corridor test rejects: far beyond the line's end.
    assert all(lon <= -96.0 + CORRIDOR_KM / 90 + 1e-9 for lon, _ in g.points)


def test_grid_respects_budget_for_long_multi_route_trips():
    a = [(-97.0 + i * 0.1, 32.8 + i * 0.07) for i in range(100)]
    b = [(-97.0 + i * 0.1, 32.8 + i * 0.07 + (0.8 if 10 < i < 90 else 0)) for i in range(100)]
    for budget in (100, 300, 400):
        g = corridor_grid([a, b], max_points=budget)
        assert 0 < len(g.points) <= budget
    # Minimum spacing ~15 km for a tiny trip
    small = corridor_grid([[(-97.0, 33.0), (-96.9, 33.0)]], max_points=400)
    assert small.spacing_deg >= 0.1


def test_empty_lines():
    assert corridor_grid([], 400).points == []


@respx.mock
async def test_build_heatmap_shape_and_load_adjusted_risk():
    dep = floor_hour(datetime.now(UTC)) + timedelta(hours=3, minutes=40)
    start = floor_hour(dep)

    def handler(request):
        q = parse_qs(request.url.query.decode())
        n = len(q["latitude"][0].split(","))
        times = [(start + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(49)]
        loc = {
            "hourly": {
                "time": times,
                "wind_speed_10m": [38.0] * 49,  # High; with > 40,000 lb load -> Severe
                "wind_gusts_10m": [50.0] * 49,
                "rain": [0.1] * 49,
                "showers": [0.004] * 49,
                "snowfall": [0.0] * 49,
                "temperature_2m": [40.0] * 49,
                "weather_code": [3] * 49,
            }
        }
        return httpx.Response(200, json=[loc] * n if n > 1 else loc)

    respx.get("https://api.open-meteo.com/v1/forecast").mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        out = await build_heatmap(client, dep, 42_000, [LINE], max_points=60)
    assert out["start"] == start.isoformat()
    assert len(out["hours"]) == 49 and out["hours"][0] == out["start"]
    assert out["hours"][48] == (start + timedelta(hours=48)).isoformat()
    assert 0 < len(out["points"]) <= 60
    p = out["points"][0]
    assert set(p) == {"lat", "lon", "risk", "wind", "precip", "snow"}
    assert all(len(p[k]) == 49 for k in ("risk", "wind", "precip", "snow"))
    assert p["risk"][0] == 3 and p["wind"][0] == 38.0 and p["precip"][0] == pytest.approx(0.1)
    async with httpx.AsyncClient() as client:
        light = await build_heatmap(client, dep, 20_000, [LINE], max_points=60)
    assert light["points"][0]["risk"][0] == 2  # same wind, lighter load -> High


@respx.mock
async def test_heatmap_hour_h_uses_the_precip_total_for_h_to_h_plus_1():
    dep = floor_hour(datetime.now(UTC)) + timedelta(hours=2)
    start = floor_hour(dep)

    def handler(request):
        q = parse_qs(request.url.query.decode())
        n = len(q["latitude"][0].split(","))
        w0 = datetime.fromisoformat(q["start_hour"][0]).replace(tzinfo=UTC)
        w1 = datetime.fromisoformat(q["end_hour"][0]).replace(tzinfo=UTC)
        hours = int((w1 - w0).total_seconds() // 3600) + 1
        stamps = [w0 + timedelta(hours=h) for h in range(hours)]
        # 0.6 in/hr falling during start+3h .. start+4h -> stamped at start+4h.
        rain = [0.6 if t == start + timedelta(hours=4) else 0.0 for t in stamps]
        loc = {
            "hourly": {
                "time": [t.strftime("%Y-%m-%dT%H:%M") for t in stamps],
                "wind_speed_10m": [float((t - start).total_seconds() // 3600) for t in stamps],
                "wind_gusts_10m": [0.0] * hours,
                "rain": rain,
                "showers": [0.0] * hours,
                "snowfall": [0.0] * hours,
                "temperature_2m": [40.0] * hours,
                "weather_code": [61] * hours,
            }
        }
        return httpx.Response(200, json=[loc] * n if n > 1 else loc)

    route = respx.get("https://api.open-meteo.com/v1/forecast").mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        out = await build_heatmap(client, dep, 10_000, [LINE], max_points=20)
    q = parse_qs(route.calls[-1].request.url.query.decode())
    last = datetime.fromisoformat(q["end_hour"][0]).replace(tzinfo=UTC)
    assert last >= start + timedelta(hours=49)  # the extra hour for hour 48's precip was fetched
    p = out["points"][0]
    assert p["precip"][3] == 0.6 and p["risk"][3] == 3  # hour starting at start+3h is the wet one
    assert p["precip"][2] == 0.0 and p["precip"][4] == 0.0
    assert p["wind"][3] == 3.0  # wind stays the instantaneous value at the stamp
    assert p["risk"][48] is not None
