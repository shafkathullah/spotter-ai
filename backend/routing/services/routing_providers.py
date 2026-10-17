"""Route providers (OpenRouteService HGV, OSRM demo) and the 3-alternative strategy.

Strategy for exactly three distinct candidates:
  1. Ask the provider for alternatives (ORS alternative_routes / OSRM alternatives=3).
  2. In parallel, route via detour waypoints offset perpendicular to the origin->destination line
     at its midpoint (+/-8% of straight-line distance; then +/-15% only if still short).
  3. Keep candidates in that order, dropping any that overlap an accepted route by > 90%
     (sampled points within 1 km of the other polyline, checked both ways, which also removes
     "spur" detours that just drive to the waypoint and back), or that take > 1.6x the fastest.
"""

from __future__ import annotations

import asyncio
import logging
import math
import re
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field

import httpx
from django.conf import settings
from django.core.cache import cache

from .geo import EARTH_RADIUS_KM, METERS_PER_MILE, LonLat, ProjectedPolyline, overlap_fraction, simplify_to_max
from .http import InputError, UpstreamError, describe_http_error
from .sampling import Track, cum_seconds_from_segments, cum_seconds_from_steps, scaled_cumulative_miles

log = logging.getLogger(__name__)

LB_PER_TONNE = 2204.62262
DETOUR_FACTORS_FIRST = (0.08, -0.08)
DETOUR_FACTORS_SECOND = (0.15, -0.15)
OVERLAP_TOLERANCE_KM = 1.0
OVERLAP_DUPLICATE = 0.90
MAX_DURATION_RATIO = 1.6
OVERLAP_MAX_POINTS = 400
ROUTE_CACHE_TTL_S = 15 * 60
TARGET_ROUTES = 3


@dataclass
class RawRoute:
    coords: list[LonLat]
    distance_m: float
    duration_s: float
    cum_s: list[float]  # cumulative seconds per vertex
    road_names: list[str] = field(default_factory=list)  # dominant first
    source: str = "provider"  # "provider" | "detour"

    def track(self) -> Track:
        cum_mi = scaled_cumulative_miles(self.coords, self.distance_m / METERS_PER_MILE)
        return Track(coords=self.coords, cum_mi=cum_mi, cum_s=self.cum_s)

    def to_cache(self) -> dict:
        return self.__dict__.copy()

    @classmethod
    def from_cache(cls, d: dict) -> RawRoute:
        return cls(**{**d, "coords": [tuple(c) for c in d["coords"]]})


def provider_name() -> str:
    return "ors" if settings.ORS_API_KEY else "osrm"


_ROAD_PREFIXES = (
    ("Interstate Highway ", "I "),
    ("Interstate ", "I "),
    ("US Highway ", "US "),
    ("U.S. Highway ", "US "),
    ("United States Highway ", "US "),
    ("State Highway ", "SH "),
)


def normalize_road(name: str) -> str:
    """'US Highway 287' and 'US 287' are the same road; collapse common long forms."""
    name = name.strip()
    for long, short in _ROAD_PREFIXES:
        if name.startswith(long):
            return short + name[len(long) :]
    return name


# Numbered routes ("I 25", "US 287", "CO 83", "SH 121", "TX-114") describe a truck route better
# than street names, which dominate the first and last miles.
_ROUTE_REF = re.compile(r"^(I|US|[A-Z]{2,3})[ -]?\d+[A-Z]?( (Business|Bus|Alt|Bypass|EXPR))?$")


def _road_parts(names: Sequence[str]) -> list[str]:
    """Distinct roads, numbered routes first, each group in the provider's order of importance.

    Provider names may bundle several roads: OSRM joins concurrent refs with ";" ("I 90;I 94"),
    ORS lists name and refs with "," ("South Dumas Avenue, US 87, US 287")."""
    parts: list[str] = []
    for name in names:
        for part in re.split(r"[;,]", name):
            part = normalize_road(part)
            if part and part != "-" and part not in parts:
                parts.append(part)
    refs = [p for p in parts if _ROUTE_REF.match(p)]
    return refs + [p for p in parts if p not in refs]


def describe_routes(names_per_route: Sequence[Sequence[str]], limit: int = 2) -> list[str]:
    """One description per route, made distinct where possible: when two routes share their top
    roads, the later one names the most important road the earlier one does not use."""
    parts = [_road_parts(n) for n in names_per_route]
    out: list[str] = []
    for i, mine in enumerate(parts):
        picked = mine[:limit]
        earlier = [p[:limit] for p in parts[:i]]
        if picked in earlier:
            used = {road for p in parts[:i] for road in p}
            extra = next((road for road in mine if road not in used), None)
            if extra:
                picked = [*mine[: limit - 1], extra]
        out.append(f"via {' / '.join(picked)}" if picked else "")
    return out


# --- OSRM -------------------------------------------------------------------------------------


def _osrm_route(route: dict, source: str) -> RawRoute:
    coords = [(float(c[0]), float(c[1])) for c in route["geometry"]["coordinates"]]
    seg_s: list[float] = []
    names: list[str] = []
    for leg in route.get("legs", []):
        ann = (leg.get("annotation") or {}).get("duration") or []
        leg_total = float(leg.get("duration") or 0.0)
        total = sum(ann)
        # Annotations exclude turn penalties that the leg duration includes: rescale per leg.
        k = leg_total / total if total > 0 else 1.0
        seg_s.extend(a * k for a in ann)
        names.extend(n.strip() for n in (leg.get("summary") or "").split(","))
    duration = float(route["duration"])
    if len(seg_s) == len(coords) - 1:
        cum_s = cum_seconds_from_segments(seg_s, target_total=duration)
    else:  # Defensive: annotation missing or misaligned -> one step spanning the route.
        log.warning("OSRM annotation length mismatch (%s vs %s)", len(seg_s), len(coords) - 1)
        cum_mi = scaled_cumulative_miles(coords, None)
        cum_s = cum_seconds_from_steps(coords, cum_mi, [(0, len(coords) - 1, duration)])
    return RawRoute(
        coords=coords,
        distance_m=float(route["distance"]),
        duration_s=duration,
        cum_s=cum_s,
        road_names=names,
        source=source,
    )


async def osrm_routes(client: httpx.AsyncClient, points: Sequence[LonLat], alternatives: bool) -> list[RawRoute]:
    coord_str = ";".join(f"{lon:.6f},{lat:.6f}" for lon, lat in points)
    params = {
        "alternatives": "3" if alternatives else "false",
        "overview": "full",
        "geometries": "geojson",
        "annotations": "duration",
        "steps": "true",  # needed for leg.summary (road names); annotations drive ETAs
    }
    url = f"{settings.OSRM_BASE_URL}/route/v1/driving/{coord_str}"
    try:
        resp = await client.get(url, params=params)
        body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
    except (httpx.HTTPError, ValueError) as exc:
        raise UpstreamError(f"Routing failed: {describe_http_error('OSRM', exc)}") from exc
    code = body.get("code")
    if code in ("NoRoute", "NoSegment"):
        raise InputError("No drivable route found between these locations")
    if resp.status_code != 200 or code != "Ok":
        msg = body.get("message") or f"HTTP {resp.status_code}"
        if resp.status_code == 429:
            msg = "rate limit reached; please retry in a minute"
        raise UpstreamError(f"Routing failed: OSRM {msg}")
    source = "provider" if len(points) == 2 else "detour"
    return [_osrm_route(r, source) for r in body.get("routes", [])]


# --- OpenRouteService (HGV) -----------------------------------------------------------------


def _ors_route(feature: dict, source: str) -> RawRoute:
    coords = [(float(c[0]), float(c[1])) for c in feature["geometry"]["coordinates"]]
    props = feature["properties"]
    summary = props.get("summary") or {}
    steps: list[tuple[int, int, float]] = []
    name_dist: dict[str, float] = defaultdict(float)
    for seg in props.get("segments", []):
        for st in seg.get("steps", []):
            wp = st.get("way_points") or [0, 0]
            steps.append((int(wp[0]), int(wp[1]), float(st.get("duration") or 0.0)))
            name = (st.get("name") or "").strip()
            if name and name != "-":
                name_dist[name] += float(st.get("distance") or 0.0)
    distance = float(summary.get("distance") or 0.0)
    duration = float(summary.get("duration") or 0.0)
    cum_mi = scaled_cumulative_miles(coords, distance / METERS_PER_MILE)
    if not steps:
        steps = [(0, len(coords) - 1, duration)]
    cum_s = cum_seconds_from_steps(coords, cum_mi, steps)
    if cum_s[-1] > 0 and duration > 0:  # align with the summary total
        k = duration / cum_s[-1]
        cum_s = [v * k for v in cum_s]
    names = [n for n, _ in sorted(name_dist.items(), key=lambda kv: -kv[1])]
    return RawRoute(coords, distance, duration, cum_s, names, source)


def _ors_error(resp: httpx.Response) -> tuple[int | None, str]:
    try:
        err = resp.json().get("error")
    except ValueError:
        return None, f"HTTP {resp.status_code}"
    if isinstance(err, dict):
        return err.get("code"), str(err.get("message") or f"HTTP {resp.status_code}")
    return None, str(err or f"HTTP {resp.status_code}")


async def _ors_post(client: httpx.AsyncClient, body: dict) -> httpx.Response:
    url = f"{settings.ORS_BASE_URL}/v2/directions/driving-hgv/geojson"
    headers = {"Authorization": settings.ORS_API_KEY, "Accept": "application/geo+json, application/json"}
    try:
        return await client.post(url, json=body, headers=headers)
    except httpx.HTTPError as exc:
        raise UpstreamError(f"Routing failed: {describe_http_error('OpenRouteService', exc)}") from exc


async def ors_routes(
    client: httpx.AsyncClient, points: Sequence[LonLat], load_lb: float, alternatives: bool
) -> list[RawRoute]:
    body: dict = {
        "coordinates": [[lon, lat] for lon, lat in points],
        "instructions": True,
        "units": "m",
        "radiuses": [2000] * len(points),
        "options": {
            "vehicle_type": "hgv",
            "profile_params": {"restrictions": {"weight": round(load_lb / LB_PER_TONNE, 2)}},
        },
    }
    if alternatives:
        body["alternative_routes"] = {"target_count": 3, "share_factor": 0.6, "weight_factor": 1.6}
    resp = await _ors_post(client, body)
    if alternatives and 400 <= resp.status_code < 500 and resp.status_code not in (401, 403, 429):
        code, msg = _ors_error(resp)
        # Public ORS caps alternative_routes by route length; retry plain and let detours fill in.
        log.info("ORS alternatives rejected (%s: %s); retrying without", code, msg)
        body.pop("alternative_routes")
        resp = await _ors_post(client, body)
    if resp.status_code != 200:
        code, msg = _ors_error(resp)
        if resp.status_code in (401, 403):
            raise UpstreamError("Routing failed: OpenRouteService rejected the API key")
        if resp.status_code == 429:
            raise UpstreamError("Routing failed: OpenRouteService rate limit reached; please retry in a minute")
        if code in (2009, 2010) or resp.status_code == 404:
            raise InputError(f"No truck route found between these locations ({msg})")
        raise UpstreamError(f"Routing failed: OpenRouteService {msg}")
    try:
        features = resp.json()["features"]
        source = "provider" if len(points) == 2 else "detour"
        return [_ors_route(f, source) for f in features]
    except (KeyError, ValueError, TypeError, IndexError) as exc:
        raise UpstreamError("Routing failed: OpenRouteService returned an unexpected response") from exc


# --- candidate generation + selection -------------------------------------------------------


def detour_waypoint(origin: LonLat, dest: LonLat, factor: float) -> LonLat:
    """Point offset perpendicular to the origin->destination line at its midpoint by
    `factor` x straight-line distance (positive = left of travel direction)."""
    ref = math.radians((origin[1] + dest[1]) / 2)
    kx = math.cos(ref) * EARTH_RADIUS_KM * math.pi / 180  # km per degree lon
    ky = EARTH_RADIUS_KM * math.pi / 180  # km per degree lat
    dx = (dest[0] - origin[0]) * kx
    dy = (dest[1] - origin[1]) * ky
    length = math.hypot(dx, dy)
    if length == 0:
        return origin
    mx, my = (origin[0] + dest[0]) / 2, (origin[1] + dest[1]) / 2
    off = factor * length
    px, py = -dy / length * off, dx / length * off
    return (mx + px / kx, my + py / ky)


def _light(route: RawRoute) -> list[LonLat]:
    """Simplified copy (<= 400 vertices, ~tens of metres error) for overlap tests; the 1 km
    tolerance dwarfs the simplification error and it keeps the test O(samples x 400)."""
    return simplify_to_max(route.coords, OVERLAP_MAX_POINTS)


def is_duplicate(candidate: RawRoute, accepted: Sequence[RawRoute]) -> bool:
    cand = _light(candidate)
    cand_line = ProjectedPolyline(cand)
    for a in accepted:
        other = _light(a)
        if overlap_fraction(cand, ProjectedPolyline(other), OVERLAP_TOLERANCE_KM) > OVERLAP_DUPLICATE:
            return True
        if overlap_fraction(other, cand_line, OVERLAP_TOLERANCE_KM) > OVERLAP_DUPLICATE:
            return True
    return False


def select_routes(candidates: Sequence[RawRoute], target: int = TARGET_ROUTES) -> list[RawRoute]:
    """Keep candidates in priority order, skipping near-duplicates and unreasonable detours."""
    if not candidates:
        return []
    fastest = (
        min(c.duration_s for c in candidates if c.source == "provider")
        if any(c.source == "provider" for c in candidates)
        else min(c.duration_s for c in candidates)
    )
    accepted: list[RawRoute] = []
    for c in candidates:
        if len(accepted) >= target:
            break
        if c.duration_s > MAX_DURATION_RATIO * fastest:
            continue
        if is_duplicate(c, accepted):
            continue
        accepted.append(c)
    return accepted


async def _safe(coro) -> list[RawRoute]:
    try:
        return await coro
    except (UpstreamError, InputError) as exc:
        log.info("detour candidate failed: %s", exc)
        return []


async def find_routes(
    client: httpx.AsyncClient, origin: LonLat, dest: LonLat, load_lb: float
) -> tuple[list[RawRoute], list[str]]:
    """Up to three distinct routes, ordered by duration, plus warnings."""
    provider = provider_name()
    key = f"routes:{provider}:{origin[0]:.5f},{origin[1]:.5f}:{dest[0]:.5f},{dest[1]:.5f}"
    if provider == "ors":
        key += f":{int(load_lb)}"
    hit = await cache.aget(key)
    if hit is not None:
        return [RawRoute.from_cache(r) for r in hit["routes"]], list(hit["warnings"])

    def call(points: Sequence[LonLat], alternatives: bool):
        if provider == "ors":
            return ors_routes(client, points, load_lb, alternatives)
        return osrm_routes(client, points, alternatives)

    def detours(factors):
        return [_safe(call([origin, detour_waypoint(origin, dest, f), dest], False)) for f in factors]

    # Phase 1: provider alternatives and the near detours concurrently (latency over request count).
    # return_exceptions: wait for every task even when the primary fails, so none is left
    # running against the client after the caller closes it.
    primary, *first = await asyncio.gather(
        call([origin, dest], True), *detours(DETOUR_FACTORS_FIRST), return_exceptions=True
    )
    if isinstance(primary, BaseException):
        raise primary
    first = [rs for rs in first if not isinstance(rs, BaseException)]
    if not primary:
        raise InputError("No drivable route found between these locations")
    candidates = list(primary) + [r for rs in first for r in rs]
    chosen = select_routes(candidates)
    if len(chosen) < TARGET_ROUTES:
        second = await asyncio.gather(*detours(DETOUR_FACTORS_SECOND))
        candidates += [r for rs in second for r in rs]
        chosen = select_routes(candidates)

    warnings = []
    if len(chosen) < TARGET_ROUTES:
        warnings.append(
            f"Only {len(chosen)} distinct route{'s' if len(chosen) != 1 else ''} could be found "
            "between these locations."
        )
    chosen.sort(key=lambda r: r.duration_s)
    await cache.aset(key, {"routes": [r.to_cache() for r in chosen], "warnings": warnings}, ROUTE_CACHE_TTL_S)
    return chosen, warnings
