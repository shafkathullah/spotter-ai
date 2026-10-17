"""Orchestrates POST /api/routes: routes -> checkpoints -> weather -> risk -> recommendation."""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime, timedelta

import httpx
from django.conf import settings

from ..schemas import RoutesRequest
from .geo import haversine_mi, simplify_to_max
from .http import InputError
from .recommend import recommend, summarize
from .risk import assess
from .routing_providers import describe_routes, find_routes, provider_name
from .sampling import plan_checkpoints
from .weather import ceil_hour, fetch_hourly, floor_hour, forecast_horizon_end, sample_at, snap_point

log = logging.getLogger(__name__)

MAX_PAST = timedelta(hours=1)
MAX_RESPONSE_POINTS = 1500
MIN_TRIP_MI = 0.5
# A route whose ends are snapped further than this from the requested places is not a route between
# them (e.g. across an ocean, OSRM snaps both ends onto whatever road network it can reach).
MAX_SNAP_MI = 15.0
ROUTE_IDS = "ABC"
INTERVALS_MI = (10, 25, 50)


def _iso(t: datetime, tz) -> str:
    return t.astimezone(tz).replace(microsecond=0).isoformat()


def validate_departure(departure: datetime, now: datetime | None = None) -> None:
    now = now or datetime.now(UTC)
    if departure < now - MAX_PAST:
        raise InputError("departure is more than 1 hour in the past")
    horizon = forecast_horizon_end(now)
    if departure > horizon:
        raise InputError(
            f"departure is beyond the weather forecast horizon ({horizon.isoformat()}); choose an earlier time"
        )


def check_weather_budget(locations: int, interval_mi: int) -> None:
    """Refuse a search that alone would exceed the Open-Meteo per-minute location quota.

    Every unique 0.05 deg cell is one billed location (free tier ~600/min, and the corridor heatmap
    that follows uses up to HEATMAP_MAX_POINTS more). A cold cross-country search at 10 mi needs
    ~700, which would always end in a 429 -> 502; a clear 400 with a workable interval is better.
    """
    limit = settings.WEATHER_MAX_LOCATIONS
    if limit <= 0 or locations <= limit:
        return
    # Location count scales ~1/interval; suggest the finest interval that should fit.
    fits = [i for i in INTERVALS_MI if i > interval_mi and locations * interval_mi / i <= limit]
    hint = f"choose a {fits[0]} mi checkpoint interval" if fits else "choose a shorter trip"
    raise InputError(
        f"this trip needs {locations} weather lookups at a {interval_mi} mi interval, more than the "
        f"{limit} the free weather service allows per search; {hint}"
    )


def _ends_match(coords, origin, dest) -> bool:
    return (
        bool(coords)
        and haversine_mi(coords[0], origin) <= MAX_SNAP_MI
        and haversine_mi(coords[-1], dest) <= MAX_SNAP_MI
    )


async def plan_trip(client: httpx.AsyncClient, req: RoutesRequest) -> dict:
    t0 = time.perf_counter()
    departure = req.departure
    tz = departure.tzinfo
    validate_departure(departure)
    origin = (req.origin.lon, req.origin.lat)
    dest = (req.destination.lon, req.destination.lat)
    if haversine_mi(origin, dest) < MIN_TRIP_MI:
        raise InputError("origin and destination are the same place")

    raw_routes, warnings = await find_routes(client, origin, dest, req.load_lb)
    raw_routes = [r for r in raw_routes if _ends_match(r.coords, origin, dest)]
    if not raw_routes:
        raise InputError("no drivable road route connects these places")
    t_routes = time.perf_counter()

    horizon = forecast_horizon_end()
    latest_arrival = departure + timedelta(seconds=max(r.duration_s for r in raw_routes))
    if ceil_hour(latest_arrival) > horizon:
        raise InputError(
            f"the trip would end at {_iso(latest_arrival, tz)}, beyond the 16-day weather forecast "
            f"horizon ({_iso(horizon, tz)}); choose an earlier departure"
        )

    tracks = [r.track() for r in raw_routes]
    plans = [plan_checkpoints(t, req.interval_mi, departure) for t in tracks]
    all_points = [(c.lon, c.lat) for p in plans for c in p]
    check_weather_budget(len({snap_point(p) for p in all_points}), req.interval_mi)
    # +1 h past the last arrival hour: precipitation for the hour containing t is stamped at the
    # *next* hour (see weather.sample_at).
    weather = await fetch_hourly(
        client, all_points, floor_hour(departure), floor_hour(latest_arrival) + timedelta(hours=1)
    )
    t_weather = time.perf_counter()

    descriptions = describe_routes([r.road_names for r in raw_routes])
    routes_out = []
    summaries = []
    missing_weather = 0
    for i, (raw, track, cps) in enumerate(zip(raw_routes, tracks, plans, strict=False)):
        rid = ROUTE_IDS[i]
        checkpoints = []
        for cp in cps:
            sample = sample_at(weather[snap_point((cp.lon, cp.lat))], cp.eta)
            missing_weather += sample.missing
            a = assess(sample.wind_mph, sample.rain_in_hr, sample.snow_in_hr, req.load_lb)
            checkpoints.append(
                {
                    "idx": cp.idx,
                    "lat": round(cp.lat, 5),
                    "lon": round(cp.lon, 5),
                    "distance_mi": round(cp.distance_mi, 2),
                    "eta": _iso(cp.eta, tz),
                    "owned_miles": round(cp.owned_miles, 3),
                    "weather": sample.to_dict(),
                    "levels": a.levels_dict(),
                    "level": a.level,
                    "level_label": a.label,
                    "drivers": a.drivers,
                }
            )
        summary = summarize(
            rid,
            f"Route {rid}",
            raw.duration_s,
            [c["level"] for c in checkpoints],
            [cp.owned_miles for cp in cps],
        )
        summaries.append(summary)
        geometry = simplify_to_max(raw.coords, MAX_RESPONSE_POINTS)
        routes_out.append(
            {
                "id": rid,
                "name": f"Route {rid}",
                "description": descriptions[i],
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[round(x, 5), round(y, 5)] for x, y in geometry],
                },
                "distance_mi": round(track.distance_mi, 2),
                "duration_s": round(raw.duration_s, 1),
                "arrival": _iso(departure + timedelta(seconds=raw.duration_s), tz),
                "summary": summary.to_dict(),
                "checkpoints": checkpoints,
            }
        )

    rec = recommend(summaries)
    rank_of = {s.id: i + 1 for i, s in enumerate(rec.ranked)}
    for r in routes_out:
        r["rank"] = rank_of[r["id"]]
        r["recommended"] = r["id"] == rec.winner.id
    if missing_weather:
        warnings.append(f"Weather data was unavailable for {missing_weather} checkpoint(s); they were treated as Low.")

    log.info(
        "routes: %d routes, %d checkpoints, routing %.2fs, weather %.2fs, total %.2fs",
        len(routes_out),
        len(all_points),
        t_routes - t0,
        t_weather - t_routes,
        time.perf_counter() - t0,
    )
    return {
        "departure": _iso(departure, tz),
        "interval_mi": req.interval_mi,
        "load_lb": req.load_lb,
        "routing_provider": provider_name(),
        "recommended_route_id": rec.winner.id,
        "no_safe_route": rec.no_safe_route,
        "explanation": rec.explanation,
        "warnings": warnings + rec.warnings,
        "routes": routes_out,
    }
