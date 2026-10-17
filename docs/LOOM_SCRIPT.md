# Loom walkthrough (about 8 minutes)

**Setup before recording:**
- Live site open in one tab.
- Repo open in the editor on `backend/routing/services/`.
- A terminal in `backend/`.
- Pick a trip with real weather on the day. Use the Open-Meteo map, or try a coastal trip (Miami to Orlando worked on 18 Oct 2026). Have one calm trip ready as well.

## 0:00 to 0:40, the problem and the result
- One sentence: "A driver picks the safest of three routes, weighing weather at the time they reach each point, their load, and travel time."
- Show the finished results screen. Point out the recommendation card, three route cards and the coloured route on the map.

## 0:40 to 2:00, entering a trip
- Type origin and destination: autocomplete goes through Django to Photon, and the Swap button swaps them.
- Departure in local time. Load presets, and the hint that explains the load rules.
- Interval toggle: 10, 25 or 50 mi.
- Submit. Mention the cold timing (about 3-8 s, mostly routing plus weather) and that a repeat search is cached.

## 2:00 to 3:30, reading the results
- **Recommendation card:** read the plain-English reason ("same Severe miles; lower average risk").
- **Route cards:** time, distance, max risk, a bar of miles by level, arrival. Click a card to select the route; the map dims the others.
- **Checkpoint list:** mile, ETA, wind and gusts, rain, and the driver line ("Rain 0.53 in/hr -> Severe"). Hover a row to highlight its map marker. Click a row to open the popup.

## 3:30 to 4:45, the heatmap
- Corridor forecast panel: the slider covers 0-48 h from departure, and the grey bar shows when the selected route is on the road.
- Drag the slider and press play. The truck dot moves along the route.
- Switch the metric: Risk (load adjusted), Wind, Rain, Snow.
- Performance: the grid is uploaded to the map once. The slider only swaps which hourly property the colour expression reads, once per frame, so nothing is refetched or rebuilt.
- Why circles and not MapLibre's heatmap layer: the heatmap layer adds up neighbours, which would misstate a 0-4 level.

## 4:45 to 6:45, the logic (code)
- `routing_providers.py`:
  - ORS `driving-hgv` with weight, or OSRM.
  - Detour waypoints fill in when the provider returns fewer than 3 routes, and the overlap check removes duplicates.
  - The ORS 100 km alternatives limit was verified live.
- `sampling.py`:
  - Checkpoints every interval.
  - Owned miles run midpoint to midpoint, so they add up to the route length.
  - ETAs come from per-segment provider durations, not an average speed.
- `weather.py`: snap to 0.05°, cache, batches of 25 run in parallel, interpolation between the two hours around the ETA.
- `risk.py`: the boundary choices (exactly 1.00 in/hr rain is Severe, 55 mph is No Travel) and the load rules changing only wind.
- `recommend.py`: the sort key `(no_travel, severe, high, avg_risk, duration)`, rounding to avoid float noise, and the generated explanation.
- Run `pytest -q` (158 tests) on screen.

## 6:45 to 7:30, architecture and deploy
- One Cloudflare Worker serves the React assets. `/api/*` goes to a Django container (Cloudflare Containers) through a Durable Object.
- It scales to zero, and the Worker retries cold starts.
- Secrets are Worker secrets passed to the container as environment variables.

## 7:30 to 8:15, trade-offs and next steps
- The OSRM fallback has no truck restrictions; an ORS key enables HGV routing.
- Open-Meteo free-tier quota and the in-memory cache.
- Distance-weighted average risk can favour a longer route when bad miles are equal. Next step: risk-weighted miles or a time tolerance.
- No hours-of-service breaks in ETAs.
