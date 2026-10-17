import json

import httpx
import pytest
import respx
from django.test import override_settings

from routing.services.geo import haversine_km
from routing.services.http import InputError, UpstreamError
from routing.services.routing_providers import (
    RawRoute,
    describe_routes,
    detour_waypoint,
    find_routes,
    is_duplicate,
    ors_routes,
    osrm_routes,
    select_routes,
)

ORIGIN = (-100.0, 35.0)
DEST = (-100.0, 37.0)
OSRM = "https://router.project-osrm.org"
ORS = "https://api.openrouteservice.org/v2/directions/driving-hgv/geojson"


def line(*waypoints, n=40):
    """Dense polyline through the given waypoints."""
    out = []
    for (x0, y0), (x1, y1) in zip(waypoints, waypoints[1:], strict=False):
        for i in range(n):
            out.append((x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n))
    out.append(waypoints[-1])
    return out


STRAIGHT = line(ORIGIN, DEST)
EAST = line(ORIGIN, (-99.4, 36.0), DEST)
WEST = line(ORIGIN, (-100.6, 36.0), DEST)
FAR_WEST = line(ORIGIN, (-101.0, 36.0), DEST)


def osrm_route(coords, duration, summary="I 27, US 87", legs=1):
    segs = len(coords) - 1
    if legs == 1:
        leg_defs = [(segs, duration, summary)]
    else:
        half = segs // 2
        leg_defs = [(half, duration / 2, summary), (segs - half, duration / 2, "US 287")]
    return {
        "geometry": {"type": "LineString", "coordinates": [list(c) for c in coords]},
        "distance": 1000.0 * len(coords),
        "duration": duration,
        "legs": [
            # annotations deliberately sum to 90% of the leg duration (turn penalties excluded)
            {"duration": d, "summary": s, "annotation": {"duration": [d * 0.9 / k] * k}}
            for k, d, s in leg_defs
        ],
    }


def raw(coords, duration, source="provider"):
    return RawRoute(coords=coords, distance_m=1e5, duration_s=duration, cum_s=[0.0] * len(coords), source=source)


def test_detour_waypoint_is_perpendicular_at_midpoint():
    left = detour_waypoint(ORIGIN, DEST, 0.08)
    right = detour_waypoint(ORIGIN, DEST, -0.08)
    assert left[1] == pytest.approx(36.0) and right[1] == pytest.approx(36.0)
    assert left[0] < -100 < right[0]  # heading north, left is west
    straight_km = haversine_km(ORIGIN, DEST)
    assert haversine_km((-100.0, 36.0), left) == pytest.approx(0.08 * straight_km, rel=0.01)
    far = detour_waypoint(ORIGIN, DEST, 0.15)
    assert haversine_km((-100.0, 36.0), far) == pytest.approx(0.15 * straight_km, rel=0.01)


def test_dedupe_identical_and_spur_routes():
    a = raw(STRAIGHT, 3600)
    same_shifted = raw([(x + 0.002, y) for x, y in STRAIGHT], 3700)  # ~180 m east
    # Detour that drives to an off-road waypoint and back: contains `a` entirely.
    spur = raw(STRAIGHT[:21] + [(-100.05, 36.0), STRAIGHT[20]] + STRAIGHT[20:], 3800, "detour")
    assert is_duplicate(same_shifted, [a])
    assert is_duplicate(spur, [a])
    assert not is_duplicate(raw(EAST, 4000), [a])


def test_partial_overlap_is_kept():
    # Shares the first half, then diverges: ~50% overlap -> distinct.
    half = raw(STRAIGHT[:21] + line((-100.0, 36.0), (-99.5, 36.5), DEST)[1:], 4000)
    assert not is_duplicate(half, [raw(STRAIGHT, 3600)])


def test_select_routes_order_dedupe_and_duration_cap():
    a = raw(STRAIGHT, 3600)
    dup = raw(STRAIGHT, 3650, "detour")
    slow = raw(FAR_WEST, 3600 * 1.7, "detour")
    east = raw(EAST, 4000, "detour")
    west = raw(WEST, 4100, "detour")
    chosen = select_routes([a, dup, slow, east, west])
    assert chosen == [a, east, west]


def test_route_description_from_road_names():
    assert describe_routes([["I 27", "", "I 27", "US 87", "US 287"]])[0] == "via I 27 / US 87"
    assert describe_routes([["I 90;I 94", "I 94"]])[0] == "via I 90 / I 94"
    # ORS bundles street name and refs; numbered routes win over street names.
    assert describe_routes([["South Dumas Avenue, US 87, US 287", "CR 40"]])[0] == "via US 87 / US 287"
    assert describe_routes([["Main Street", "I 25 EXPR", "Broadway"]])[0] == "via I 25 EXPR / Main Street"


def test_describe_routes_keeps_descriptions_distinct():
    a = ["US 287", "I 25", "Main Street"]
    b = ["US 287", "I 25", "Raton Highway", "Main Street"]
    c = ["I 35", "I 70"]
    assert describe_routes([a, b, c]) == ["via US 287 / I 25", "via US 287 / Raton Highway", "via I 35 / I 70"]
    # Identical road lists stay identical rather than inventing a difference.
    assert describe_routes([a, a]) == ["via US 287 / I 25", "via US 287 / I 25"]
    assert describe_routes([["-", ""]])[0] == ""


@respx.mock
async def test_osrm_parse_and_annotation_rescale():
    body = {"code": "Ok", "routes": [osrm_route(STRAIGHT, 7200.0, legs=2)]}
    route = respx.get(url__startswith=f"{OSRM}/route/v1/driving/").mock(return_value=httpx.Response(200, json=body))
    async with httpx.AsyncClient() as client:
        [r] = await osrm_routes(client, [ORIGIN, (-100.0, 36.0), DEST], alternatives=False)
    params = route.calls[0].request.url.params
    assert params["alternatives"] == "false" and params["annotations"] == "duration" and params["steps"] == "true"
    assert r.source == "detour"
    assert r.duration_s == 7200 and len(r.cum_s) == len(STRAIGHT)
    assert r.cum_s[-1] == pytest.approx(7200)
    mid = len(STRAIGHT) // 2
    assert r.cum_s[mid] == pytest.approx(3600)  # each leg rescaled to its own leg duration
    assert r.road_names == ["I 27", "US 87", "US 287"]


@respx.mock
async def test_osrm_no_route_is_input_error():
    respx.get(url__startswith=OSRM).mock(return_value=httpx.Response(400, json={"code": "NoRoute", "message": "x"}))
    async with httpx.AsyncClient() as client:
        with pytest.raises(InputError):
            await osrm_routes(client, [ORIGIN, DEST], alternatives=True)


@respx.mock
async def test_osrm_server_error_is_upstream_error():
    respx.get(url__startswith=OSRM).mock(return_value=httpx.Response(503, text="busy"))
    async with httpx.AsyncClient() as client:
        with pytest.raises(UpstreamError, match="OSRM"):
            await osrm_routes(client, [ORIGIN, DEST], alternatives=True)


def _osrm_handler(primary_routes, detours_by_side):
    """Answer OSRM requests: 2 coords -> primary list; 3 coords -> by via-point side and distance."""
    seen = []

    def handler(request):
        coords = request.url.path.split("/driving/")[1].split(";")
        seen.append(len(coords))
        if len(coords) == 2:
            return httpx.Response(200, json={"code": "Ok", "routes": primary_routes})
        via_lon = float(coords[1].split(",")[0])
        offset = round(via_lon - ORIGIN[0], 2)
        key = ("W" if offset < 0 else "E") + ("far" if abs(offset) > 0.2 else "near")
        r = detours_by_side.get(key)
        if r is None:
            return httpx.Response(400, json={"code": "NoRoute"})
        return httpx.Response(200, json={"code": "Ok", "routes": [r]})

    return handler, seen


@respx.mock
async def test_find_routes_fills_with_detours_and_orders_by_duration():
    handler, seen = _osrm_handler(
        [osrm_route(STRAIGHT, 3600), osrm_route(STRAIGHT, 3700)],  # provider's alt is a duplicate
        {"Wnear": osrm_route(WEST, 4200), "Enear": osrm_route(EAST, 4000)},
    )
    respx.get(url__startswith=OSRM).mock(side_effect=handler)
    with override_settings(ORS_API_KEY=""):
        async with httpx.AsyncClient() as client:
            routes, warnings = await find_routes(client, ORIGIN, DEST, 42000)
    assert [r.duration_s for r in routes] == [3600, 4000, 4200]
    assert warnings == []
    assert sorted(seen) == [2, 3, 3]  # far detours not needed


@respx.mock
async def test_find_routes_second_phase_and_warning():
    handler, seen = _osrm_handler(
        [osrm_route(STRAIGHT, 3600)],
        {"Wnear": osrm_route(STRAIGHT, 3650)},  # duplicate; E near and both far fail
    )
    respx.get(url__startswith=OSRM).mock(side_effect=handler)
    with override_settings(ORS_API_KEY=""):
        async with httpx.AsyncClient() as client:
            routes, warnings = await find_routes(client, ORIGIN, DEST, 42000)
            assert len(routes) == 1
            assert warnings and "Only 1 distinct route" in warnings[0]
            assert sorted(seen) == [2, 3, 3, 3, 3]
            # Cached: no further upstream calls.
            await find_routes(client, ORIGIN, DEST, 42000)
            assert len(seen) == 5


def ors_feature(coords, duration, steps):
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [list(c) for c in coords]},
        "properties": {
            "summary": {"distance": 200000.0, "duration": duration},
            "segments": [{"distance": 200000.0, "duration": duration, "steps": steps}],
        },
    }


@respx.mock
@override_settings(ORS_API_KEY="test-key")
async def test_ors_body_fallback_and_step_durations():
    n = len(STRAIGHT) - 1
    half = n // 2
    steps = [
        {"distance": 50000, "duration": 3000, "name": "Main St", "way_points": [0, half]},
        {"distance": 150000, "duration": 1000, "name": "I 27", "way_points": [half, n]},
        {"distance": 0, "duration": 0, "name": "-", "way_points": [n, n]},
    ]
    bodies = []

    def handler(request):
        body = json.loads(request.content)
        bodies.append(body)
        assert request.headers["Authorization"] == "test-key"
        if "alternative_routes" in body:
            return httpx.Response(
                400, json={"error": {"code": 2004, "message": "alternative routes limited to 100 km"}}
            )
        return httpx.Response(200, json={"type": "FeatureCollection", "features": [ors_feature(STRAIGHT, 4000, steps)]})

    respx.post(ORS).mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        [r] = await ors_routes(client, [ORIGIN, DEST], load_lb=44092.45, alternatives=True)
    first = bodies[0]
    assert first["options"]["vehicle_type"] == "hgv"
    assert first["options"]["profile_params"]["restrictions"]["weight"] == pytest.approx(20.0, abs=0.01)
    assert first["alternative_routes"] == {"target_count": 3, "share_factor": 0.6, "weight_factor": 1.6}
    assert first["coordinates"] == [list(ORIGIN), list(DEST)]
    assert "alternative_routes" not in bodies[1]  # retried without
    assert r.cum_s[half] == pytest.approx(3000)
    assert r.cum_s[-1] == pytest.approx(4000)
    assert r.road_names[0] == "I 27"  # dominant by distance


@respx.mock
@override_settings(ORS_API_KEY="bad")
async def test_ors_bad_key():
    respx.post(ORS).mock(return_value=httpx.Response(403, json={"error": "Access to this API has been disallowed"}))
    async with httpx.AsyncClient() as client:
        with pytest.raises(UpstreamError, match="API key"):
            await ors_routes(client, [ORIGIN, DEST], 1000, alternatives=True)


@respx.mock
@override_settings(ORS_API_KEY="k")
async def test_ors_route_not_found():
    respx.post(ORS).mock(
        return_value=httpx.Response(404, json={"error": {"code": 2009, "message": "Route could not be found"}})
    )
    async with httpx.AsyncClient() as client:
        with pytest.raises(InputError, match="No truck route"):
            await ors_routes(client, [ORIGIN, DEST], 1000, alternatives=False)


def test_description_normalizes_road_name_variants():
    assert describe_routes([["US 287", "US Highway 287", "Interstate 25"]])[0] == "via US 287 / I 25"
