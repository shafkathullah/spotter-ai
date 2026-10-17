# Backend: Django weather-aware routing API

Async Django (ASGI, served by uvicorn). No database, no models. All logic is in pure,
unit-tested modules under `routing/services/`. Views are thin.

## Setup / run / test

```bash
cd backend
uv sync                                    # Python 3.12 venv in .venv (runtime + dev deps)
DEBUG=1 .venv/bin/uvicorn config.asgi:application --port 8000 --reload
.venv/bin/pytest -q                        # all upstream HTTP is mocked with respx
uvx ruff check . && uvx ruff format --check .   # lint + format (config in pyproject.toml)
```

Docker (Cloudflare Containers need linux/amd64):

```bash
docker build --platform linux/amd64 -t spotter-backend .
docker run --rm -p 8080:8080 spotter-backend      # listens on 0.0.0.0:8080
```

`requirements.txt` is pinned (exported from `uv.lock`) and is what the image installs.

## Environment

| Var | Default | Purpose |
|---|---|---|
| `ORS_API_KEY` | empty | When set, routes come from OpenRouteService `driving-hgv`. Otherwise the keyless OSRM demo server is used |
| `DEBUG` | `false` | Also turns on CORS for `localhost:5173` (Vite) |
| `DJANGO_SECRET_KEY` | dev value | Set it in production (`SECRET_KEY` is accepted as a fallback) |
| `ALLOWED_HOSTS` | `*` | Comma-separated |
| `OPEN_METEO_API_KEY` | empty | Optional paid key. Switches to `customer-api.open-meteo.com` |
| `UPSTREAM_TIMEOUT_S` | `10` | Timeout per upstream request |
| `WEATHER_CHUNK_SIZE` / `WEATHER_MAX_CONCURRENCY` | `25` / `6` | Open-Meteo batching (latency grows with locations per request, so smaller chunks in parallel finish sooner) |
| `HEATMAP_MAX_POINTS` | `300` | Budget for corridor grid points |
| `OSRM_BASE_URL`, `ORS_BASE_URL`, `PHOTON_BASE_URL`, `OPEN_METEO_BASE_URL` | public endpoints | Overrides |

## Endpoints

- `GET /api/health`
- `GET /api/geocode?q=&limit=`
- `POST /api/routes`
- `POST /api/heatmap`

Errors return `{"error": str}`: 400 for bad input (including "no route" and "beyond forecast
horizon"), 502 when an upstream provider fails, times out or rate-limits. Django's own 404 / 405 /
500 responses are converted to the same JSON shape by `JsonErrorMiddleware`.

## Module map

| Module | Responsibility |
|---|---|
| `routing/schemas.py` | Pydantic request validation. Errors look like `field: message` |
| `routing/views.py` | Async views. Maps `InputError` to 400 and `UpstreamError` to 502 |
| `services/planner.py` | `/api/routes` pipeline: validate, then routes, checkpoints, weather, risk, ranking, JSON |
| `services/routing_providers.py` | OSRM + ORS clients, detour-waypoint alternatives, overlap dedupe, 15 min cache |
| `services/sampling.py` | `Track` (distance and time per vertex), checkpoint placement, ETA interpolation, owned miles |
| `services/geo.py` | Haversine, Douglas-Peucker, point-to-polyline distance, overlap fraction |
| `services/weather.py` | Open-Meteo multi-location client (snap, dedupe, cache, chunk, retry) and hour interpolation |
| `services/risk.py` | Threshold tables, load rules, driver strings |
| `services/recommend.py` | Route summaries, lexicographic ranking, plain-English explanation |
| `services/heatmap.py` | Corridor grid and 49-hour per-cell risk |
| `services/geocode.py` | Photon proxy biased to North America, 1-day cache |

## How it works (key decisions)

- **Three routes.** The provider's alternatives come first. Detour candidates run in parallel
  with them: the route is forced through a waypoint offset perpendicular to the
  origin-destination line at its midpoint, at ±8% of the straight-line distance, then ±15% only
  if still short. A candidate is dropped when either of these holds:
  - more than 90% of its sampled points lie within 1 km of an already accepted route, checked in
    both directions (this also removes out-and-back "spur" detours)
  - it takes more than 1.6× the fastest provider route

  Survivors are sorted by duration and named Route A/B/C. If fewer than 3 survive, the response
  includes a warning.
- **ETAs.** Each vertex gets a cumulative time built from the provider's own per-segment times:
  - OSRM: `annotation.duration`, rescaled per leg to the leg duration, since annotations exclude
    turn penalties
  - ORS: step durations, spread over each step's vertices by distance

  A checkpoint's ETA is interpolated linearly within its segment. There is no flat average speed.
- **Distances.** Haversine along the geometry, scaled to the provider's reported distance. That
  makes `distance_mi`, checkpoint miles and owned miles all agree.
- **Weather.**
  - Open-Meteo hourly data, with units requested as mph and inches. Times are in GMT.
  - `rain_in_hr` = `rain + showers`, `snow_in_hr` = `snowfall`. Each value is the total for the
    preceding hour, so it is already per hour.
  - Values at an ETA are linearly interpolated between the two hours around it.
    `weather_code` comes from the nearest hour.
  - Points snap to a 0.05° grid, are deduped, and are cached for 30 min per (cell, window).
- **Recommendation.** Lowest wins on the sort key `(no_travel_mi, severe_mi, high_mi, avg_risk,
  duration)`. Miles are rounded to 0.1 and risk to 0.01 first.
  - `avg_risk` is the mean checkpoint level, weighted by owned miles.
  - The explanation names the first criterion that separates the winner from each other route.

## Assumptions

- **Risk boundaries.** A lower bound is inclusive and an upper bound is exclusive (25 mph is
  Moderate, 35 mph is High).
  - Wind: 55 mph and above is No Travel, as the table says (`>=55`).
  - Rain: exactly 1.00 in/hr is still Severe, because the table says `>1.00`.
  - Snow: exactly 3.0 in/hr is still Severe, because the table says `>3.0`.
  - Values are compared as raw floats with no rounding. Driver text truncates rather than rounds,
    so 44.96 mph displays as "44.9" (High) and never as "45".
- **Wind.** Classification uses sustained `wind_speed_10m`. Gusts are shown for information only.
- **Load rules.** They only change the wind level:
  - wind ≥ 55 mph: No Travel for any load
  - 45 ≤ wind < 55 and load > 30,000 lb: No Travel
  - 35 ≤ wind < 45 and load > 40,000 lb: Severe

  The checkpoint level is the highest of the adjusted wind, rain and snow levels.
- **Checkpoints.** One at the origin, one every interval along the route, and one at the
  destination. A route shorter than the interval gets only the origin and destination.
  - Each checkpoint owns the miles from the midpoint with the previous checkpoint to the midpoint
    with the next one. Owned miles add up to exactly the route length.
- **Departure rules.** The departure must be no more than 1 h in the past. The whole trip must
  end within the Open-Meteo horizon (23:00 UTC on today + 15 days).
  - Heatmap hours past the horizon come back as `null`.
- **OSRM demo routing.** It uses a car profile, so it has no truck restrictions.
- **ORS routing.** It uses `driving-hgv` with `vehicle_type: hgv` and
  `restrictions.weight = load_lb` in tonnes, which is the load only and not gross weight.
  - If ORS rejects `alternative_routes` (its public API caps the route length for them), the
    request is retried without them and detours fill the gap.
- **Open-Meteo free-tier quota.** The free tier allows about 600 locations per minute, and every
  location in a request counts. One Dallas to Denver search uses about 100 locations for routes at
  a 25 mi interval (about 250 at 10 mi) plus about 230 for the heatmap.
  - Heavy use returns a 502 that says "rate limit, retry in a minute".
  - Caching makes repeat searches free for 30 min. `OPEN_METEO_API_KEY` raises the limit.
