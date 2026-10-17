"""Dev-only CORS for the Vite server. In production the Worker serves SPA and API same-origin."""

from asgiref.sync import iscoroutinefunction, markcoroutinefunction
from django.conf import settings
from django.http import HttpResponse, JsonResponse


class DevCorsMiddleware:
    async_capable = True
    sync_capable = False

    def __init__(self, get_response):
        self.get_response = get_response
        if iscoroutinefunction(self.get_response):
            markcoroutinefunction(self)

    async def __call__(self, request):
        origin = request.headers.get("Origin")
        allowed = settings.DEBUG and origin in settings.DEV_CORS_ORIGINS
        if allowed and request.method == "OPTIONS":
            response = HttpResponse(status=204)
        else:
            response = await self.get_response(request)
        if allowed:
            response["Access-Control-Allow-Origin"] = origin
            response["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response["Access-Control-Allow-Headers"] = "Content-Type"
            response["Vary"] = "Origin"
        return response


class JsonErrorMiddleware:
    """Every API error is `{"error": str}`, including Django's own 404 / 405 / 500 pages."""

    async_capable = True
    sync_capable = False

    def __init__(self, get_response):
        self.get_response = get_response
        if iscoroutinefunction(self.get_response):
            markcoroutinefunction(self)

    async def __call__(self, request):
        response = await self.get_response(request)
        if response.status_code < 400 or response.get("Content-Type", "").startswith("application/json"):
            return response
        messages = {404: "not found", 405: f"method {request.method} not allowed", 500: "internal server error"}
        message = messages.get(response.status_code, response.reason_phrase.lower())
        json_response = JsonResponse({"error": message}, status=response.status_code)
        if response.has_header("Allow"):
            json_response["Allow"] = response["Allow"]
        return json_response
