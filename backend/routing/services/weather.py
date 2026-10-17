"""Open-Meteo hourly forecast client + time interpolation.

Units are requested from Open-Meteo directly: wind in mph, precipitation/snowfall in inches,
temperature in Fahrenheit, all times in UTC. Open-Meteo hourly precipitation values are the sum
over the *preceding* hour, i.e. already in/hr.

Precipitation is therefore an *interval* value: the number stamped H+1 is the rate during
(H, H+1]. `sample_at` reads it that way (the truck at 08:20 gets the value stamped 09:00), while
wind/gust/temperature are instantaneous and linearly interpolated between stamps.

Values are quantized to 3 decimals (Open-Meteo's own resolution for inches) before anyone
classifies them, so IEEE noise from summing rain + showers or interpolating (0.01 + 0.09 =
0.09999999999999999) can never drop a value that sits exactly on a threshold to the lower level.

Rate-limit note: the free tier counts every location in a multi-location request as one call
(600/min). We therefore (1) snap coordinates to a 0.05 deg grid and dedupe, (2) cache each
location's series per UTC day for 30 min, keyed by (cell, day, fetch hour) so routes, the heatmap
and a changed departure all reuse the same entries, and (3) cap concurrency.
"""

from __future__ import annotations

import asyncio
import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

import httpx
from django.conf import settings
from django.core.cache import cache

from .geo import LonLat
from .http import UpstreamError, describe_http_error

HOURLY_VARS = (
    "wind_speed_10m",
    "wind_gusts_10m",
    "rain",
    "showers",
    "snowfall",
    "temperature_2m",
    "weather_code",
)
GRID_DEG = 0.05
CACHE_TTL_S = 30 * 60
FORECAST_DAYS = 16  # Open-Meteo forecast horizon (today + 15 days)
PROVIDER = "Open-Meteo"
RETRIES = 1
DECIMALS = 3  # Open-Meteo resolution for inch values; also strips float noise


def snap(value: float) -> float:
    return round(round(value / GRID_DEG) * GRID_DEG, 4)


def snap_point(p: LonLat) -> LonLat:
    return (snap(p[0]), snap(p[1]))


def floor_hour(t: datetime) -> datetime:
    t = t.astimezone(UTC)
    return t.replace(minute=0, second=0, microsecond=0)


def ceil_hour(t: datetime) -> datetime:
    f = floor_hour(t)
    return f if f == t.astimezone(UTC) else f + timedelta(hours=1)


def forecast_horizon_end(now: datetime | None = None) -> datetime:
    """Last forecast hour Open-Meteo serves: 23:00 UTC on (today + 15 days)."""
    now = (now or datetime.now(UTC)).astimezone(UTC)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight + timedelta(days=FORECAST_DAYS) - timedelta(hours=1)


@dataclass
class HourlySeries:
    """Hourly values from `start` (UTC, on the hour); index i is start + i hours. Values may be None."""

    start: datetime
    wind: list[float | None]
    gust: list[float | None]
    rain: list[float | None]  # rain + showers, in/hr
    snow: list[float | None]  # in/hr
    temp: list[float | None]
    code: list[int | None]

    def __len__(self) -> int:
        return len(self.wind)

    def to_cache(self) -> dict:
        return {
            "start": self.start.isoformat(),
            "wind": self.wind,
            "gust": self.gust,
            "rain": self.rain,
            "snow": self.snow,
            "temp": self.temp,
            "code": self.code,
        }

    @classmethod
    def from_cache(cls, d: dict) -> HourlySeries:
        return cls(
            start=datetime.fromisoformat(d["start"]),
            wind=d["wind"],
            gust=d["gust"],
            rain=d["rain"],
            snow=d["snow"],
            temp=d["temp"],
            code=d["code"],
        )


@dataclass(frozen=True)
class WeatherSample:
    wind_mph: float
    gust_mph: float
    rain_in_hr: float
    snow_in_hr: float
    temp_f: float | None
    weather_code: int
    missing: bool = False

    def to_dict(self) -> dict:
        return {
            "wind_mph": round(self.wind_mph, 1),
            "gust_mph": round(self.gust_mph, 1),
            "rain_in_hr": round(self.rain_in_hr, 3),
            "snow_in_hr": round(self.snow_in_hr, 3),
            "temp_f": round(self.temp_f, 1) if self.temp_f is not None else None,
            "weather_code": self.weather_code,
        }


def _q(x: float | None) -> float | None:
    """Quantize to DECIMALS so the value we classify is the value we serialize."""
    return None if x is None else round(x, DECIMALS)


def _add(a: float | None, b: float | None) -> float | None:
    if a is None and b is None:
        return None
    return _q((a or 0.0) + (b or 0.0))


def parse_location(payload: dict, start: datetime, hours: int) -> HourlySeries:
    """Map one Open-Meteo location object onto a fixed hourly window starting at `start`."""
    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    index = {}
    for i, t in enumerate(times):
        index[datetime.fromisoformat(t).replace(tzinfo=UTC)] = i

    def col(name: str) -> list:
        return hourly.get(name) or [None] * len(times)

    cols = {v: col(v) for v in HOURLY_VARS}
    out = {k: [] for k in ("wind", "gust", "rain", "snow", "temp", "code")}
    for h in range(hours):
        i = index.get(start + timedelta(hours=h))
        if i is None:
            for k in out:
                out[k].append(None)
            continue
        out["wind"].append(cols["wind_speed_10m"][i])
        out["gust"].append(cols["wind_gusts_10m"][i])
        out["rain"].append(_add(cols["rain"][i], cols["showers"][i]))
        out["snow"].append(_q(cols["snowfall"][i]))
        out["temp"].append(cols["temperature_2m"][i])
        code = cols["weather_code"][i]
        out["code"].append(int(code) if code is not None else None)
    return HourlySeries(start=start, **out)


def _day_start(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=UTC)


def _cache_key(p: LonLat, day: date, run_hour: datetime) -> str:
    """One cache entry per (0.05 deg cell, UTC day, fetch hour).

    The fetch hour stands in for the forecast model run (Open-Meteo refreshes about hourly); the
    requested time window is deliberately *not* part of the key, so any request touching the same
    cell and day reuses the entry.
    """
    return f"om:{p[1]:.2f}:{p[0]:.2f}:{day:%Y%m%d}:{run_hour:%Y%m%d%H}"


def _split_days(series: HourlySeries, days: Sequence[date]) -> list[HourlySeries]:
    out = []
    for k, d in enumerate(days):
        sl = slice(24 * k, 24 * (k + 1))
        out.append(
            HourlySeries(
                start=_day_start(d),
                wind=series.wind[sl],
                gust=series.gust[sl],
                rain=series.rain[sl],
                snow=series.snow[sl],
                temp=series.temp[sl],
                code=series.code[sl],
            )
        )
    return out


def _window(day_series: Sequence[HourlySeries], start: datetime, hours: int) -> HourlySeries:
    """Concatenate consecutive day series and cut out `hours` hours from `start`."""
    off = int((start - day_series[0].start).total_seconds() // 3600)
    sl = slice(off, off + hours)

    def cat(attr: str) -> list:
        return [v for ds in day_series for v in getattr(ds, attr)][sl]

    return HourlySeries(
        start=start,
        wind=cat("wind"),
        gust=cat("gust"),
        rain=cat("rain"),
        snow=cat("snow"),
        temp=cat("temp"),
        code=cat("code"),
    )


async def fetch_hourly(
    client: httpx.AsyncClient, points: Sequence[LonLat], start: datetime, end: datetime
) -> dict[LonLat, HourlySeries]:
    """Hourly series for each point over [start, end] (UTC hours, inclusive).

    Returns a mapping keyed by the *snapped* point (use `snap_point` to look up). Hours beyond the
    forecast horizon are filled with None. Data is fetched and cached in whole UTC days.
    """
    start = floor_hour(start)
    end = floor_hour(end)
    hours = int((end - start).total_seconds() // 3600) + 1
    horizon = forecast_horizon_end()
    run_hour = floor_hour(datetime.now(UTC))
    snapped = list(dict.fromkeys(snap_point(p) for p in points))
    days = [start.date() + timedelta(days=k) for k in range((end.date() - start.date()).days + 1)]
    fetchable = [d for d in days if _day_start(d) <= horizon]

    by_day: dict[tuple[LonLat, date], HourlySeries] = {}
    keys = {(p, d): _cache_key(p, d, run_hour) for p in snapped for d in fetchable}
    cached = await cache.aget_many(list(keys.values())) if keys else {}
    # Points grouped by the span of days they still need, so each request has one time window.
    spans: dict[tuple[date, date], list[LonLat]] = {}
    for p in snapped:
        need = []
        for d in fetchable:
            hit = cached.get(keys[(p, d)])
            if hit is not None:
                by_day[(p, d)] = HourlySeries.from_cache(hit)
            else:
                need.append(d)
        if need:
            spans.setdefault((need[0], need[-1]), []).append(p)

    size = max(1, settings.WEATHER_CHUNK_SIZE)
    jobs = [(d0, d1, group[i : i + size]) for (d0, d1), group in spans.items() for i in range(0, len(group), size)]
    sem = asyncio.Semaphore(max(1, settings.WEATHER_MAX_CONCURRENCY))

    async def run(d0: date, d1: date, chunk: list[LonLat]) -> None:
        span_days = [d0 + timedelta(days=k) for k in range((d1 - d0).days + 1)]
        win_start = _day_start(d0)
        win_end = min(_day_start(d1) + timedelta(hours=23), horizon)
        async with sem:
            payloads = await _request(client, chunk, win_start, win_end)
        fresh = {}
        for p, payload in zip(chunk, payloads, strict=False):
            for d, ds in zip(
                span_days, _split_days(parse_location(payload, win_start, 24 * len(span_days)), span_days), strict=True
            ):
                by_day[(p, d)] = ds
                fresh[keys[(p, d)]] = ds.to_cache()
        await cache.aset_many(fresh, CACHE_TTL_S)

    await asyncio.gather(*(run(*job) for job in jobs))

    empty = {d: parse_location({}, _day_start(d), 24) for d in days}
    return {p: _window([by_day.get((p, d), empty[d]) for d in days], start, hours) for p in snapped}


async def _request(client: httpx.AsyncClient, chunk: Sequence[LonLat], start: datetime, end: datetime) -> list[dict]:
    params = {
        "latitude": ",".join(f"{p[1]:.2f}" for p in chunk),
        "longitude": ",".join(f"{p[0]:.2f}" for p in chunk),
        "hourly": ",".join(HOURLY_VARS),
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "temperature_unit": "fahrenheit",
        "timezone": "GMT",
        "start_hour": start.strftime("%Y-%m-%dT%H:%M"),
        "end_hour": end.strftime("%Y-%m-%dT%H:%M"),
    }
    if settings.OPEN_METEO_API_KEY:
        params["apikey"] = settings.OPEN_METEO_API_KEY
    url = f"{settings.OPEN_METEO_BASE_URL}/v1/forecast"
    for attempt in range(1 + RETRIES):
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            break
        except (httpx.HTTPError, ValueError) as exc:
            # Open-Meteo latency is bursty: retry once on timeouts / network / 5xx, never on 4xx
            # (a 429 is a per-minute quota; retrying immediately only burns more of it).
            transient = isinstance(exc, httpx.TimeoutException | httpx.TransportError) or (
                isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code >= 500
            )
            if attempt < RETRIES and transient:
                continue
            raise UpstreamError(f"Weather lookup failed: {describe_http_error(PROVIDER, exc)}") from exc
    if isinstance(data, dict):  # a single location returns an object, several return a list
        data = [data]
    if not isinstance(data, list) or len(data) != len(chunk):
        raise UpstreamError(f"Weather lookup failed: {PROVIDER} returned an unexpected response")
    return data


# --- interpolation --------------------------------------------------------------------------


def _value_at(values: Sequence[float | None], pos: float) -> float | None:
    """Linear interpolation at fractional index `pos`; tolerates gaps by falling back to the
    nearest available neighbour."""
    if not values:
        return None
    pos = min(max(pos, 0.0), len(values) - 1)
    i0 = int(math.floor(pos))
    i1 = min(i0 + 1, len(values) - 1)
    frac = pos - i0
    a, b = values[i0], values[i1]
    if a is not None and b is not None:
        return a + (b - a) * frac
    if a is not None or b is not None:
        return a if a is not None else b
    # Both bracketing hours missing: nearest non-null anywhere in the series.
    best = None
    for dist in range(1, len(values)):
        for j in (i0 - dist, i1 + dist):
            if 0 <= j < len(values) and values[j] is not None:
                best = values[j]
                break
        if best is not None:
            break
    return best


def _interval_value_at(values: Sequence[float | None], pos: float) -> float | None:
    """Value of an hourly *accumulation* at fractional index `pos`.

    The value stamped H+1 covers (H, H+1], so an instant inside hour H..H+1 reads index floor(pos)+1
    (no interpolation: that hour's total is the best estimate of the rate at any moment within it).
    Gaps fall back to the nearest available hour.
    """
    if not values:
        return None
    i = min(max(int(math.floor(pos)) + 1, 0), len(values) - 1)
    return values[i] if values[i] is not None else _value_at(values, i)


def sample_at(series: HourlySeries, t: datetime) -> WeatherSample:
    """Weather at instant t.

    Wind, gust and temperature are instantaneous: linear interpolation between the two bracketing
    forecast hours. Rain and snow are preceding-hour totals: the hour containing t (see
    `_interval_value_at`). weather_code comes from the nearest hour. Everything is quantized to
    DECIMALS so classification sees exactly what the API serializes.
    """
    pos = (t.astimezone(UTC) - series.start).total_seconds() / 3600.0
    wind = _q(_value_at(series.wind, pos))
    gust = _q(_value_at(series.gust, pos))
    rain = _q(_interval_value_at(series.rain, pos))
    snow = _q(_interval_value_at(series.snow, pos))
    temp = _value_at(series.temp, pos)
    nearest = min(max(int(round(pos)), 0), len(series.code) - 1) if len(series.code) else 0
    code = series.code[nearest] if series.code else None
    if code is None:
        code_f = _value_at([float(c) if c is not None else None for c in series.code], nearest)
        code = int(code_f) if code_f is not None else None
    missing = wind is None or rain is None or snow is None
    return WeatherSample(
        wind_mph=max(0.0, wind or 0.0),
        gust_mph=max(0.0, gust or 0.0),
        rain_in_hr=max(0.0, rain or 0.0),
        snow_in_hr=max(0.0, snow or 0.0),
        temp_f=temp,
        weather_code=code if code is not None else -1,
        missing=missing,
    )
