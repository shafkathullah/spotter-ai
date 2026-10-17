from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs

import httpx
import pytest
import respx
from django.test import override_settings

from routing.services.http import UpstreamError
from routing.services.risk import rain_level
from routing.services.weather import (
    HourlySeries,
    _value_at,
    ceil_hour,
    fetch_hourly,
    floor_hour,
    forecast_horizon_end,
    parse_location,
    sample_at,
    snap,
    snap_point,
)

OM = "https://api.open-meteo.com/v1/forecast"
T0 = floor_hour(datetime.now(UTC)) + timedelta(hours=2)


def series(start=T0, wind=None, rain=None, snow=None, code=None, n=4):
    return HourlySeries(
        start=start,
        wind=wind or [10.0] * n,
        gust=[20.0] * n,
        rain=rain or [0.0] * n,
        snow=snow or [0.0] * n,
        temp=[50.0] * n,
        code=code or [0] * n,
    )


def om_location(start: datetime, hours: int, wind=12.0, rain=0.1, showers=0.05, snow=0.0):
    times = [(start + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(hours)]
    return {
        "latitude": 0,
        "longitude": 0,
        "hourly": {
            "time": times,
            "wind_speed_10m": [wind + h for h in range(hours)],
            "wind_gusts_10m": [wind * 2] * hours,
            "rain": [rain] * hours,
            "showers": [showers] * hours,
            "snowfall": [snow] * hours,
            "temperature_2m": [40.0] * hours,
            "weather_code": [61] * hours,
        },
    }


def test_hour_rounding():
    t = datetime(2026, 10, 18, 13, 25, tzinfo=UTC)
    assert floor_hour(t) == datetime(2026, 10, 18, 13, tzinfo=UTC)
    assert ceil_hour(t) == datetime(2026, 10, 18, 14, tzinfo=UTC)
    assert ceil_hour(floor_hour(t)) == floor_hour(t)


def test_snap_grid():
    assert snap(32.7767) == 32.8
    assert snap(-96.797) == -96.8
    assert snap_point((-96.774, 32.724)) == (-96.75, 32.7)


def test_interpolates_between_bracketing_hours():
    s = series(wind=[10.0, 20.0, 30.0, 40.0], rain=[0.0, 0.2, 0.4, 0.4])
    w = sample_at(s, T0 + timedelta(minutes=90))  # halfway between hour 1 and 2
    assert w.wind_mph == pytest.approx(25.0)
    assert w.rain_in_hr == pytest.approx(0.4)  # precip: the hour 1..2 total, stamped at hour 2
    assert sample_at(s, T0).wind_mph == 10.0
    assert sample_at(s, T0 + timedelta(hours=3)).wind_mph == 40.0
    assert sample_at(s, T0 + timedelta(minutes=15)).wind_mph == pytest.approx(12.5)


def test_precip_is_read_as_the_hour_containing_the_eta():
    # 0.6 in falls 08:00-09:00, so Open-Meteo stamps it at 09:00; dry hours either side.
    start = T0.replace(hour=7)
    s = series(start=start, rain=[0.0, 0.0, 0.6, 0.0], snow=[0.0, 0.0, 2.5, 0.0])
    inside = sample_at(s, start + timedelta(hours=1, minutes=5))  # 08:05, driving through the storm
    assert inside.rain_in_hr == 0.6 and inside.snow_in_hr == 2.5
    assert rain_level(inside.rain_in_hr) == 3
    after = sample_at(s, start + timedelta(hours=2, minutes=55))  # 09:55, the rain stopped at 09:00
    assert after.rain_in_hr == 0.0 and after.snow_in_hr == 0.0
    before = sample_at(s, start + timedelta(minutes=55))  # 07:55, still dry
    assert before.rain_in_hr == 0.0
    # Exactly on a stamp: the hour that starts there.
    assert sample_at(s, start + timedelta(hours=1)).rain_in_hr == 0.6
    # Wind stays instantaneous (linear between stamps).
    assert sample_at(series(wind=[10.0, 20.0, 30.0, 40.0]), T0 + timedelta(minutes=30)).wind_mph == 15.0


def test_precip_float_noise_never_drops_a_threshold_value():
    assert 0.01 + 0.09 < 0.10  # the IEEE trap being guarded against
    payload = om_location(T0, 2, rain=0.01, showers=0.09)
    s = parse_location(payload, T0, 2)
    assert s.rain == [0.1, 0.1]
    w = sample_at(s, T0)
    assert w.rain_in_hr == 0.1 and rain_level(w.rain_in_hr) == 1
    assert w.to_dict()["rain_in_hr"] == 0.1
    # Every rain + showers pair that sums to a threshold classifies at that threshold's level.
    for total, level in ((0.10, 1), (0.25, 2), (0.50, 3)):
        for k in range(1, int(total * 100)):
            r, sh = k / 100, round(total - k / 100, 2)
            got = parse_location(om_location(T0, 1, rain=r, showers=sh), T0, 1).rain[0]
            assert rain_level(got) == level, (r, sh, got)


def test_weather_code_nearest_hour():
    s = series(code=[0, 3, 61, 71])
    assert sample_at(s, T0 + timedelta(minutes=29)).weather_code == 0
    assert sample_at(s, T0 + timedelta(minutes=31)).weather_code == 3


def test_value_at_gaps():
    assert _value_at([1.0, None, 3.0], 0.5) == 1.0  # one neighbour missing -> use the other
    assert _value_at([None, None, 3.0], 0.2) == 3.0  # both missing -> nearest available
    assert _value_at([None, None], 0.5) is None


def test_missing_flag():
    s = series(wind=[None] * 4)
    w = sample_at(s, T0)
    assert w.missing and w.wind_mph == 0.0


def test_parse_location_sums_rain_and_showers_and_aligns_window():
    payload = om_location(T0 + timedelta(hours=1), 2, rain=0.1, showers=0.05)
    s = parse_location(payload, T0, 4)
    assert s.rain == [None, pytest.approx(0.15), pytest.approx(0.15), None]
    assert s.wind[1] == 12.0 and s.code[1] == 61


def test_forecast_horizon():
    now = datetime(2026, 10, 17, 21, 30, tzinfo=UTC)
    assert forecast_horizon_end(now) == datetime(2026, 11, 1, 23, 0, tzinfo=UTC)


@respx.mock
async def test_fetch_chunks_dedupes_and_caches():
    calls = []

    def handler(request):
        q = parse_qs(request.url.query.decode())
        lats = q["latitude"][0].split(",")
        calls.append(len(lats))
        assert q["wind_speed_unit"] == ["mph"] and q["precipitation_unit"] == ["inch"]
        assert q["timezone"] == ["GMT"]
        hours = 3
        body = [om_location(T0, hours) for _ in lats]
        return httpx.Response(200, json=body if len(body) > 1 else body[0])

    respx.get(OM).mock(side_effect=handler)
    # 5 points, two of which snap to the same 0.05 deg cell
    pts = [(-96.80, 32.78), (-96.79, 32.77), (-97.5, 33.0), (-98.0, 34.0), (-99.0, 35.0)]
    with override_settings(WEATHER_CHUNK_SIZE=2, WEATHER_MAX_CONCURRENCY=2):
        async with httpx.AsyncClient() as client:
            out = await fetch_hourly(client, pts, T0, T0 + timedelta(hours=2))
            assert sorted(calls) == [1, 2, 2]  # 4 unique cells in chunks of 2
            assert set(out) == {snap_point(p) for p in pts}
            assert len(out[snap_point(pts[0])]) == 3
            # Second call: all cached, no HTTP.
            await fetch_hourly(client, pts, T0, T0 + timedelta(hours=2))
            assert len(calls) == 3


@respx.mock
async def test_cache_is_per_cell_and_day_not_per_window():
    calls = []

    def handler(request):
        q = parse_qs(request.url.query.decode())
        calls.append((q["start_hour"][0], q["end_hour"][0], len(q["latitude"][0].split(","))))
        start = datetime.fromisoformat(q["start_hour"][0]).replace(tzinfo=UTC)
        hours = int((datetime.fromisoformat(q["end_hour"][0]).replace(tzinfo=UTC) - start).total_seconds() // 3600) + 1
        n = len(q["latitude"][0].split(","))
        body = [om_location(start, hours) for _ in range(n)]
        return httpx.Response(200, json=body if n > 1 else body[0])

    respx.get(OM).mock(side_effect=handler)
    day = floor_hour(datetime.now(UTC)).replace(hour=0) + timedelta(days=2)
    pts = [(-96.8, 32.8), (-97.5, 33.0)]
    async with httpx.AsyncClient() as client:
        # A routes-style window: requested as the whole UTC day.
        a = await fetch_hourly(client, pts, day + timedelta(hours=8), day + timedelta(hours=14))
        assert calls == [(f"{day:%Y-%m-%dT%H:%M}", f"{day + timedelta(hours=23):%Y-%m-%dT%H:%M}", 2)]
        assert len(a[pts[0]]) == 7 and a[pts[0]].start == day + timedelta(hours=8)
        assert a[pts[0]].wind[0] == 12.0 + 8  # sliced at the right offset (wind = 12 + hour)
        # Departure moved by an hour, and a heatmap-style 49 h window: only the new day is fetched.
        await fetch_hourly(client, pts, day + timedelta(hours=9), day + timedelta(hours=15))
        assert len(calls) == 1
        b = await fetch_hourly(client, pts, day + timedelta(hours=9), day + timedelta(hours=9 + 49))
        nxt, last = day + timedelta(days=1), day + timedelta(days=2, hours=23)
        assert calls[1:] == [(f"{nxt:%Y-%m-%dT%H:%M}", f"{last:%Y-%m-%dT%H:%M}", 2)]
        s = b[pts[0]]
        assert len(s) == 50 and s.wind[0] == 12.0 + 9 and s.wind[15] == 12.0  # 00:00 next day
        assert all(v is not None for v in s.wind)


@respx.mock
async def test_rate_limit_maps_to_upstream_error():
    respx.get(OM).mock(return_value=httpx.Response(429, json={"error": True, "reason": "Minutely API request limit"}))
    async with httpx.AsyncClient() as client:
        with pytest.raises(UpstreamError, match="rate limit"):
            await fetch_hourly(client, [(-96.8, 32.8)], T0, T0 + timedelta(hours=1))


@respx.mock
async def test_timeout_retried_once_then_upstream_error():
    route = respx.get(OM).mock(side_effect=httpx.ReadTimeout("slow"))
    async with httpx.AsyncClient() as client:
        with pytest.raises(UpstreamError, match="did not respond"):
            await fetch_hourly(client, [(-96.8, 32.8)], T0, T0 + timedelta(hours=1))
    assert route.call_count == 2


@respx.mock
async def test_transient_5xx_recovers_on_retry():
    route = respx.get(OM).mock(side_effect=[httpx.Response(503), httpx.Response(200, json=om_location(T0, 2))])
    async with httpx.AsyncClient() as client:
        out = await fetch_hourly(client, [(-96.8, 32.8)], T0, T0 + timedelta(hours=1))
    assert route.call_count == 2 and out[(-96.8, 32.8)].wind[0] == 12.0


@respx.mock
async def test_rate_limit_is_not_retried():
    route = respx.get(OM).mock(return_value=httpx.Response(429))
    async with httpx.AsyncClient() as client:
        with pytest.raises(UpstreamError):
            await fetch_hourly(client, [(-96.8, 32.8)], T0, T0 + timedelta(hours=1))
    assert route.call_count == 1


@respx.mock
async def test_window_beyond_horizon_is_clamped_and_padded():
    horizon = forecast_horizon_end()
    start = horizon - timedelta(hours=1)
    route = respx.get(OM).mock(return_value=httpx.Response(200, json=om_location(start, 2)))
    async with httpx.AsyncClient() as client:
        out = await fetch_hourly(client, [(-96.8, 32.8)], start, start + timedelta(hours=4))
    q = parse_qs(route.calls[0].request.url.query.decode())
    assert q["end_hour"] == [horizon.strftime("%Y-%m-%dT%H:%M")]
    s = out[(-96.8, 32.8)]
    assert len(s) == 5 and s.wind[2:] == [None, None, None]
