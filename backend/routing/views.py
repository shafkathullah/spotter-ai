"""Thin async JSON views. All logic lives in routing.services."""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from functools import wraps

from django.conf import settings
from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_GET, require_POST
from pydantic import ValidationError

from .schemas import HeatmapRequest, RoutesRequest, first_error
from .services import geocode as geocode_service
from .services.heatmap import build_heatmap
from .services.http import InputError, UpstreamError, make_client
from .services.planner import plan_trip, validate_departure
from .services.routing_providers import provider_name

log = logging.getLogger(__name__)


def error(message: str, status: int) -> JsonResponse:
    return JsonResponse({"error": message}, status=status)


def api_errors(view: Callable[..., Awaitable[JsonResponse]]):
    """Map domain exceptions onto the {"error": str} contract."""

    @wraps(view)
    async def wrapper(request: HttpRequest, *args, **kwargs):
        try:
            return await view(request, *args, **kwargs)
        except ValidationError as exc:
            return error(first_error(exc), 400)
        except InputError as exc:
            return error(str(exc), 400)
        except UpstreamError as exc:
            log.warning("upstream failure: %s", exc)
            return error(str(exc), 502)

    return wrapper


def _json_body(request: HttpRequest) -> dict:
    try:
        body = json.loads(request.body or b"null")
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise InputError("request body must be valid JSON") from exc
    if not isinstance(body, dict):
        raise InputError("request body must be a JSON object")
    return body


@require_GET
async def health(request: HttpRequest) -> JsonResponse:
    return JsonResponse({"ok": True, "routing_provider": provider_name()})


@require_GET
@api_errors
async def geocode(request: HttpRequest) -> JsonResponse:
    q = request.GET.get("q", "")
    try:
        limit = max(1, min(10, int(request.GET.get("limit", "5"))))
    except ValueError:
        return error("limit must be an integer", 400)
    async with make_client() as client:
        results = await geocode_service.geocode(client, q, limit)
    return JsonResponse({"results": results})


@require_POST
@api_errors
async def routes(request: HttpRequest) -> JsonResponse:
    req = RoutesRequest.model_validate(_json_body(request))
    async with make_client() as client:
        result = await plan_trip(client, req)
    return JsonResponse(result)


@require_POST
@api_errors
async def heatmap(request: HttpRequest) -> JsonResponse:
    req = HeatmapRequest.model_validate(_json_body(request))
    validate_departure(req.departure)
    lines = [[(float(lon), float(lat)) for lon, lat in line] for line in req.lines]
    async with make_client() as client:
        result = await build_heatmap(client, req.departure, req.load_lb, lines, settings.HEATMAP_MAX_POINTS)
    return JsonResponse(result)
