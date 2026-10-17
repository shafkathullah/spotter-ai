"""Shared HTTP plumbing for upstream providers."""

from __future__ import annotations

import httpx
from django.conf import settings

USER_AGENT = "spotter-weather-routing/1.0 (take-home demo)"


class UpstreamError(Exception):
    """An upstream provider failed or returned something unusable. Rendered as HTTP 502."""


class InputError(Exception):
    """The request is valid JSON but cannot be served (e.g. no route exists). Rendered as HTTP 400."""


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(settings.UPSTREAM_TIMEOUT_S),
        headers={"User-Agent": USER_AGENT},
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        follow_redirects=True,
    )


def describe_http_error(provider: str, exc: Exception) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return f"{provider} did not respond within {settings.UPSTREAM_TIMEOUT_S:g} s"
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code == 429:
            return f"{provider} rate limit reached; please retry in a minute"
        return f"{provider} returned HTTP {code}"
    if isinstance(exc, httpx.HTTPError):
        return f"Could not reach {provider} ({exc.__class__.__name__})"
    return f"{provider} returned an unexpected response"
