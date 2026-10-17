"""End-to-end view tests with all upstream HTTP mocked."""

import json
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs

import httpx
import pytest
import respx
from django.test import AsyncClient, override_settings

from routing.services.weather import floor_hour

from .test_routing_providers import DEST, EAST, ORIGIN, STRAIGHT, WEST, osrm_route

OM = "https://api.open-meteo.com/v1/forecast"


def departure(hours_ahead=3):
    tz = __import__("datetime").timezone(timedelta(hours=-5))
    return (floor_hour(datetime.now(UTC)) + timedelta(hours=hours_ahead)).astimezone(tz)


def body(**over):
    b = {
        "origin": {"lat": ORIGIN[1], "lon": ORIGIN[0], "label": "A"},
        "destination": {"lat": DEST[1], "lon": DEST[0], "label": "B"},
        "departure": departure().isoformat(),
        "load_lb": 42000,
        "interval_mi": 25,
    }
    b.update(over)
    return b


def mock_osrm():
    def handler(request):
        coords = request.url.path.split("/driving/")[1].split(";")
        if len(coords) == 2:
            return httpx.Response(200, json={"code": "Ok", "routes": [osrm_route(STRAIGHT, 3 * 3600, "I 27")]})
        via_lon = float(coords[1].split(",")[0])
        r = osrm_route(WEST if via_lon < ORIGIN[0] else EAST, (3.5 if via_lon < ORIGIN[0] else 3.2) * 3600)
        return httpx.Response(200, json={"code": "Ok", "routes": [r]})

    respx.get(url__startswith="https://router.project-osrm.org").mock(side_effect=handler)


def mock_weather(wind_by_lon=lambda lon: 10.0):
    """Wind depends on longitude so routes can be made to differ."""

    def handler(request):
        q = parse_qs(request.url.query.decode())
        lons = [float(x) for x in q["longitude"][0].split(",")]
        start = datetime.strptime(q["start_hour"][0], "%Y-%m-%dT%H:%M")
        end = datetime.strptime(q["end_hour"][0], "%Y-%m-%dT%H:%M")
        n = int((end - start).total_seconds() // 3600) + 1
        times = [(start + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(n)]
        locs = [
            {
                "hourly": {
                    "time": times,
                    "wind_speed_10m": [wind_by_lon(lon)] * n,
                    "wind_gusts_10m": [wind_by_lon(lon) + 10] * n,
                    "rain": [0.0] * n,
                    "showers": [0.0] * n,
                    "snowfall": [0.0] * n,
                    "temperature_2m": [55.0] * n,
                    "weather_code": [1] * n,
                }
            }
            for lon in lons
        ]
        return httpx.Response(200, json=locs if len(locs) > 1 else locs[0])

    return respx.get(OM).mock(side_effect=handler)


async def post(path, payload):
    return await AsyncClient().post(path, data=json.dumps(payload), content_type="application/json")


async def test_health():
    with override_settings(ORS_API_KEY=""):
        r = await AsyncClient().get("/api/health")
    assert r.status_code == 200 and r.json() == {"ok": True, "routing_provider": "osrm"}


@respx.mock
@override_settings(ORS_API_KEY="")
async def test_routes_contract_and_recommendation():
    mock_osrm()
    # Strong wind east of -99.7: the east route (fastest detour) gets High -> Severe with 42k lb.
    mock_weather(lambda lon: 38.0 if lon > -99.7 else 10.0)
    r = await post("/api/routes", body())
    assert r.status_code == 200, r.content
    d = r.json()
    assert set(d) == {
        "departure",
        "interval_mi",
        "load_lb",
        "routing_provider",
        "recommended_route_id",
        "no_safe_route",
        "explanation",
        "warnings",
        "routes",
    }
    assert d["routing_provider"] == "osrm" and d["interval_mi"] == 25 and d["load_lb"] == 42000
    ids = [x["id"] for x in d["routes"]]
    assert ids == ["A", "B", "C"]
    durations = [x["duration_s"] for x in d["routes"]]
    assert durations == sorted(durations)
    by_id = {x["id"]: x for x in d["routes"]}
    # A = straight (3.0 h), B = east (3.2 h), C = west (3.5 h)
    assert by_id["B"]["summary"]["max_level"] == 3
    assert d["recommended_route_id"] == "A"
    assert by_id["A"]["rank"] == 1 and by_id["B"]["rank"] == 3  # B has Severe miles; C is Low but slower
    assert sorted(x["rank"] for x in d["routes"]) == [1, 2, 3]
    assert sum(x["recommended"] for x in d["routes"]) == 1
    for route in d["routes"]:
        assert set(route) == {
            "id",
            "name",
            "description",
            "geometry",
            "distance_mi",
            "duration_s",
            "arrival",
            "rank",
            "recommended",
            "summary",
            "checkpoints",
        }
        assert route["geometry"]["type"] == "LineString"
        cps = route["checkpoints"]
        assert cps[0]["distance_mi"] == 0 and cps[-1]["distance_mi"] == pytest.approx(route["distance_mi"], abs=0.01)
        assert sum(c["owned_miles"] for c in cps) == pytest.approx(route["distance_mi"], abs=0.05)
        assert sum(route["summary"]["miles_by_level"].values()) == pytest.approx(route["distance_mi"], abs=0.05)
        assert cps[0]["eta"] == d["departure"] and cps[-1]["eta"] == route["arrival"]
        c = cps[1]
        assert set(c) == {
            "idx",
            "lat",
            "lon",
            "distance_mi",
            "eta",
            "owned_miles",
            "weather",
            "levels",
            "level",
            "level_label",
            "drivers",
        }
        assert set(c["weather"]) == {"wind_mph", "gust_mph", "rain_in_hr", "snow_in_hr", "temp_f", "weather_code"}
        assert set(c["levels"]) == {"wind", "wind_load_adjusted", "rain", "snow"}
    severe_cp = next(c for c in by_id["B"]["checkpoints"] if c["level"] == 3)
    assert severe_cp["level_label"] == "Severe"
    assert severe_cp["drivers"] == ["Wind 38 mph + 42,000 lb load -> Severe"]
    assert "recommended" in d["explanation"]


@respx.mock
@override_settings(ORS_API_KEY="")
async def test_routes_no_safe_route():
    mock_osrm()
    mock_weather(lambda lon: 60.0)
    d = (await post("/api/routes", body())).json()
    assert d["no_safe_route"] is True
    assert any("No Travel" in w for w in d["warnings"])
    assert all(r["summary"]["max_level"] == 4 for r in d["routes"])


@pytest.mark.parametrize(
    "over,msg",
    [
        ({"load_lb": 0}, "load_lb"),
        ({"load_lb": 80001}, "load_lb"),
        ({"interval_mi": 30}, "interval_mi"),
        ({"departure": "2026-10-18T08:00:00"}, "UTC offset"),
        ({"departure": "not a date"}, "departure"),
        ({"departure": (datetime.now(UTC) - timedelta(hours=2)).isoformat()}, "past"),
        ({"departure": (datetime.now(UTC) + timedelta(days=20)).isoformat()}, "horizon"),
        ({"origin": {"lat": 95, "lon": 0}}, "origin.lat"),
        ({"destination": {"lat": ORIGIN[1], "lon": ORIGIN[0]}}, "same place"),
    ],
)
async def test_routes_validation(over, msg):
    r = await post("/api/routes", body(**over))
    assert r.status_code == 400
    assert msg in r.json()["error"]


@respx.mock
@override_settings(ORS_API_KEY="")
async def test_routes_trip_ending_beyond_horizon():
    from routing.services.weather import forecast_horizon_end

    mock_osrm()
    dep = (forecast_horizon_end() - timedelta(hours=2)).isoformat()
    r = await post("/api/routes", body(departure=dep))
    assert r.status_code == 400 and "forecast horizon" in r.json()["error"]


async def test_bad_json_and_method():
    r = await AsyncClient().post("/api/routes", data="{", content_type="application/json")
    assert r.status_code == 400 and r.json()["error"] == "request body must be valid JSON"
    r = await AsyncClient().get("/api/routes")
    assert r.status_code == 405 and r.json() == {"error": "method GET not allowed"} and r["Allow"] == "POST"
    r = await AsyncClient().get("/api/nope")
    assert r.status_code == 404 and r.json() == {"error": "not found"}


@respx.mock
@override_settings(ORS_API_KEY="")
async def test_routes_upstream_failure_is_502():
    respx.get(url__startswith="https://router.project-osrm.org").mock(side_effect=httpx.ConnectError("down"))
    r = await post("/api/routes", body())
    assert r.status_code == 502 and "OSRM" in r.json()["error"]


@respx.mock
@override_settings(ORS_API_KEY="", WEATHER_MAX_LOCATIONS=5)
async def test_routes_over_weather_budget_is_400_before_any_weather_call():
    mock_osrm()
    om = mock_weather()
    r = await post("/api/routes", body(interval_mi=10))
    assert r.status_code == 400
    err = r.json()["error"]
    assert "weather lookups at a 10 mi interval" in err and "more than the 5" in err
    assert om.call_count == 0


def test_weather_budget_suggests_a_workable_interval():
    from routing.services.http import InputError
    from routing.services.planner import check_weather_budget

    with override_settings(WEATHER_MAX_LOCATIONS=500):
        check_weather_budget(500, 10)  # at the limit is fine
        with pytest.raises(InputError, match="choose a 25 mi checkpoint interval"):
            check_weather_budget(717, 10)  # NY -> LA at 10 mi
        with pytest.raises(InputError, match="choose a 50 mi checkpoint interval"):
            check_weather_budget(1300, 10)
        with pytest.raises(InputError, match="choose a shorter trip"):
            check_weather_budget(600, 50)
    with override_settings(WEATHER_MAX_LOCATIONS=0):
        check_weather_budget(10_000, 10)  # 0 disables the cap (paid key)


@respx.mock
@override_settings(ORS_API_KEY="")
async def test_weather_failure_is_502():
    mock_osrm()
    respx.get(OM).mock(return_value=httpx.Response(429, json={"error": True}))
    r = await post("/api/routes", body())
    assert r.status_code == 502 and "rate limit" in r.json()["error"]


@respx.mock
async def test_heatmap_endpoint():
    mock_weather()
    payload = {"departure": departure().isoformat(), "load_lb": 30000, "lines": [[list(c) for c in STRAIGHT[::4]]]}
    r = await post("/api/heatmap", payload)
    assert r.status_code == 200, r.content
    d = r.json()
    assert set(d) == {"start", "hours", "spacing_deg", "points"}
    assert len(d["hours"]) == 49 and d["points"]
    assert all(len(p["risk"]) == 49 for p in d["points"])


async def test_heatmap_validation():
    r = await post("/api/heatmap", {"departure": departure().isoformat(), "load_lb": 1, "lines": []})
    assert r.status_code == 400 and "lines" in r.json()["error"]


@respx.mock
async def test_geocode():
    photon = respx.get("https://photon.komoot.io/api/").mock(
        return_value=httpx.Response(
            200,
            json={
                "features": [
                    {
                        "geometry": {"coordinates": [-87.62, 41.87]},
                        "properties": {"name": "Chicago", "state": "Illinois", "countrycode": "US"},
                    },
                    {
                        "geometry": {"coordinates": [-87.62, 41.87]},
                        "properties": {"name": "Chicago", "state": "Illinois", "countrycode": "US"},
                    },
                    {
                        "geometry": {"coordinates": [-87.6, 41.5]},
                        "properties": {"name": "Chicago Heights", "state": "Illinois", "countrycode": "us"},
                    },
                ]
            },
        )
    )
    r = await AsyncClient().get("/api/geocode", {"q": "Chicago", "limit": 5})
    assert r.status_code == 200
    assert r.json() == {
        "results": [
            {"label": "Chicago, Illinois, US", "lat": 41.87, "lon": -87.62},
            {"label": "Chicago Heights, Illinois, US", "lat": 41.5, "lon": -87.6},
        ]
    }
    assert photon.calls[0].request.url.params["q"] == "Chicago"
    # cached
    await AsyncClient().get("/api/geocode", {"q": "Chicago", "limit": 5})
    assert photon.call_count == 1


async def test_geocode_short_query_returns_empty_without_upstream():
    r = await AsyncClient().get("/api/geocode", {"q": "ch"})
    assert r.json() == {"results": []}


@respx.mock
async def test_geocode_upstream_failure():
    respx.get("https://photon.komoot.io/api/").mock(return_value=httpx.Response(500))
    r = await AsyncClient().get("/api/geocode", {"q": "Chicago"})
    assert r.status_code == 502 and "Photon" in r.json()["error"]


@override_settings(DEBUG=True)
async def test_dev_cors_preflight():
    r = await AsyncClient().options("/api/routes", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 204 and r["Access-Control-Allow-Origin"] == "http://localhost:5173"


@respx.mock
async def test_geocode_label_prefers_name_then_address():
    respx.get("https://photon.komoot.io/api/").mock(
        return_value=httpx.Response(
            200,
            json={
                "features": [
                    {
                        "geometry": {"coordinates": [-87.6, 41.8]},
                        "properties": {
                            "name": "Union Station",
                            "housenumber": "225",
                            "street": "S Canal St",
                            "city": "Chicago",
                            "state": "Illinois",
                            "countrycode": "US",
                        },
                    },
                    {
                        "geometry": {"coordinates": [-87.6, 41.8]},
                        "properties": {
                            "housenumber": "100",
                            "street": "Main St",
                            "city": "Chicago",
                            "state": "Illinois",
                            "countrycode": "US",
                        },
                    },
                ]
            },
        )
    )
    r = await AsyncClient().get("/api/geocode", {"q": "station"})
    assert [x["label"] for x in r.json()["results"]] == [
        "Union Station, Chicago, Illinois, US",
        "100 Main St, Chicago, Illinois, US",
    ]


@respx.mock
@override_settings(ORS_API_KEY="")
async def test_routes_snapped_far_from_the_requested_places_are_rejected():
    """OSRM snaps unreachable ends (e.g. across an ocean) onto some other road network."""
    far = [(lon, lat + 3.0) for lon, lat in STRAIGHT]
    respx.get(url__startswith="https://router.project-osrm.org").mock(
        return_value=httpx.Response(200, json={"code": "Ok", "routes": [osrm_route(far, 3 * 3600)]})
    )
    r = await post("/api/routes", body())
    assert r.status_code == 400 and "no drivable road route" in r.json()["error"]
