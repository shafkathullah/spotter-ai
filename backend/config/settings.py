"""Django settings. No database, no auth, no sessions: this service is a stateless JSON API."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY") or os.environ.get("SECRET_KEY") or "dev-insecure-secret-key-change-me"
DEBUG = env_bool("DEBUG", False)
ALLOWED_HOSTS = [h.strip() for h in os.environ.get("ALLOWED_HOSTS", "*").split(",") if h.strip()]

INSTALLED_APPS = ["routing"]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "routing.middleware.DevCorsMiddleware",
    "routing.middleware.JsonErrorMiddleware",
]

ROOT_URLCONF = "config.urls"
ASGI_APPLICATION = "config.asgi.application"
APPEND_SLASH = False
# Behind the Cloudflare Worker, which terminates TLS and sets X-Forwarded-Proto.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

DATABASES: dict = {}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "spotter",
        "OPTIONS": {"MAX_ENTRIES": 20000},
    }
}

USE_TZ = True
TIME_ZONE = "UTC"
LANGUAGE_CODE = "en-us"
USE_I18N = False

# Only allowed in DEBUG (Vite dev server); production is same-origin behind the Worker.
DEV_CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

# --- Upstream providers ---------------------------------------------------
ORS_API_KEY = os.environ.get("ORS_API_KEY", "").strip()
ORS_BASE_URL = os.environ.get("ORS_BASE_URL", "https://api.openrouteservice.org")
OSRM_BASE_URL = os.environ.get("OSRM_BASE_URL", "https://router.project-osrm.org")
# Optional paid key switches to customer-api.open-meteo.com (higher rate limits).
OPEN_METEO_API_KEY = os.environ.get("OPEN_METEO_API_KEY", "").strip()
OPEN_METEO_BASE_URL = os.environ.get(
    "OPEN_METEO_BASE_URL",
    "https://customer-api.open-meteo.com" if OPEN_METEO_API_KEY else "https://api.open-meteo.com",
)
PHOTON_BASE_URL = os.environ.get("PHOTON_BASE_URL", "https://photon.komoot.io")
UPSTREAM_TIMEOUT_S = float(os.environ.get("UPSTREAM_TIMEOUT_S", "10"))
# The public ORS API intermittently hangs; fail fast and fall back to OSRM.
ORS_TIMEOUT_S = float(os.environ.get("ORS_TIMEOUT_S", "8"))

# Open-Meteo free tier counts every location as one call (600/min). These keep
# one routes+heatmap round trip comfortably under that budget.
WEATHER_CHUNK_SIZE = int(os.environ.get("WEATHER_CHUNK_SIZE", "25"))
WEATHER_MAX_CONCURRENCY = int(os.environ.get("WEATHER_MAX_CONCURRENCY", "6"))
HEATMAP_MAX_POINTS = int(os.environ.get("HEATMAP_MAX_POINTS", "300"))
# Max unique weather cells one /api/routes call may request (0 disables; raise it with a paid key).
WEATHER_MAX_LOCATIONS = int(os.environ.get("WEATHER_MAX_LOCATIONS", "0" if OPEN_METEO_API_KEY else "500"))

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO")},
}
