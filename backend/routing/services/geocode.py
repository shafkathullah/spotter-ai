"""Place search via Photon (komoot), biased to North America."""

from __future__ import annotations

import hashlib

import httpx
from django.conf import settings
from django.core.cache import cache

from .http import UpstreamError, describe_http_error

CACHE_TTL_S = 24 * 60 * 60
MIN_QUERY_LEN = 3
# lon_min, lat_min, lon_max, lat_max: continental US, Alaska, Canada, northern Mexico.
NA_BBOX = "-170,14,-50,72"
BIAS_LAT, BIAS_LON = 39.8, -98.6  # geographic centre of the contiguous US


def _label(props: dict) -> str:
    name = props.get("name") or ""
    if not name and props.get("street"):
        name = f"{props.get('housenumber', '')} {props['street']}".strip()
    parts = [name]
    city = props.get("city")
    if city and city != name:
        parts.append(city)
    if props.get("state"):
        parts.append(props["state"])
    if props.get("countrycode"):
        parts.append(str(props["countrycode"]).upper())
    return ", ".join(p for p in parts if p)


def parse_features(data: dict, limit: int) -> list[dict]:
    results, seen = [], set()
    for f in data.get("features", []):
        try:
            lon, lat = f["geometry"]["coordinates"][:2]
        except (KeyError, TypeError, ValueError):
            continue
        label = _label(f.get("properties") or {})
        if not label or label in seen:
            continue
        seen.add(label)
        results.append({"label": label, "lat": float(lat), "lon": float(lon)})
        if len(results) == limit:
            break
    return results


async def geocode(client: httpx.AsyncClient, q: str, limit: int) -> list[dict]:
    q = " ".join(q.split())
    if len(q) < MIN_QUERY_LEN:
        return []
    key = "geo:" + hashlib.sha1(f"{q.lower()}|{limit}".encode()).hexdigest()
    hit = await cache.aget(key)
    if hit is not None:
        return hit
    params = {
        "q": q,
        "limit": min(limit * 2, 20),  # over-fetch: duplicates labels are collapsed
        "lang": "en",
        "lat": BIAS_LAT,
        "lon": BIAS_LON,
        "bbox": NA_BBOX,
    }
    try:
        resp = await client.get(f"{settings.PHOTON_BASE_URL}/api/", params=params)
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise UpstreamError(f"Place search failed: {describe_http_error('Photon', exc)}") from exc
    results = parse_features(data, limit)
    await cache.aset(key, results, CACHE_TTL_S)
    return results
