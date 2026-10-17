/**
 * Dev only (`?fixture=1`): answers the API calls from the bundled sample so
 * the UI can be built and checked without the backend. Loaded through dynamic
 * imports behind `import.meta.env.DEV`, so none of it ships in production.
 */
import type { GeocodeResponse, HeatmapPoint, HeatmapRequest, HeatmapResponse, LonLat, Place, RoutesRequest, RoutesResponse } from "../api/types.ts";
import { assessWeather } from "./fixture-rules.ts";
import { syntheticWeather } from "./synthetic-weather.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PLACES: Place[] = [
  { label: "Dallas, Texas, United States", lat: 32.7767, lon: -96.797 },
  { label: "Chicago, Illinois, United States", lat: 41.8781, lon: -87.6298 },
  { label: "Denver, Colorado, United States", lat: 39.7392, lon: -104.9903 },
  { label: "Kansas City, Missouri, United States", lat: 39.0997, lon: -94.5786 },
  { label: "Memphis, Tennessee, United States", lat: 35.1495, lon: -90.049 },
  { label: "Atlanta, Georgia, United States", lat: 33.749, lon: -84.388 },
  { label: "Toronto, Ontario, Canada", lat: 43.6532, lon: -79.3832 },
];

export async function fixtureGeocode(q: string): Promise<GeocodeResponse> {
  await wait(150);
  const needle = q.toLowerCase();
  return { results: PLACES.filter((p) => p.label.toLowerCase().includes(needle)).slice(0, 5) };
}

function shiftIso(iso: string, deltaMs: number): string {
  const d = new Date(new Date(iso).getTime() + deltaMs);
  // Keep the sample's -05:00 offset so it reads like the backend's echo.
  return new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 19) + "-05:00";
}

/** The sample trip, with every time moved so it departs when the form asked. */
export async function fixtureRoutes(req: RoutesRequest): Promise<RoutesResponse> {
  const [{ default: raw }] = await Promise.all([import("./fixture.json"), wait(600)]);
  const sample = raw as unknown as RoutesResponse;
  const delta = new Date(req.departure).getTime() - new Date(sample.departure).getTime();
  return {
    ...sample,
    departure: req.departure,
    routes: sample.routes.map((r) => ({
      ...r,
      arrival: shiftIso(r.arrival, delta),
      checkpoints: r.checkpoints.map((c) => ({ ...c, eta: shiftIso(c.eta, delta) })),
    })),
  };
}

function distToLinesKm(lon: number, lat: number, lines: readonly LonLat[][]): number {
  const kx = Math.cos((lat * Math.PI) / 180) * 111.32;
  const ky = 111.32;
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as LonLat;
      const b = line[i] as LonLat;
      const ax = (a[0] - lon) * kx;
      const ay = (a[1] - lat) * ky;
      const dx = (b[0] - a[0]) * kx;
      const dy = (b[1] - a[1]) * ky;
      const len2 = dx * dx + dy * dy;
      let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best) best = d;
    }
  }
  return best;
}

/** A corridor grid around the lines, sampled from the same synthetic weather. */
export async function fixtureHeatmap(req: HeatmapRequest): Promise<HeatmapResponse> {
  await wait(500);
  const dep = new Date(req.departure);
  const start = new Date(dep);
  start.setUTCMinutes(0, 0, 0);
  const hours = Array.from({ length: 49 }, (_, h) => new Date(start.getTime() + h * 3600_000).toISOString());

  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const line of req.lines)
    for (const [x, y] of line) {
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    }

  const corridorKm = 40;
  let spacing = 0.15;
  let cells: [number, number][] = [];
  for (;;) {
    cells = [];
    for (let lat = s - 0.4; lat <= n + 0.4; lat += spacing)
      for (let lon = w - 0.4; lon <= e + 0.4; lon += spacing)
        if (distToLinesKm(lon, lat, req.lines) <= corridorKm) cells.push([lon, lat]);
    if (cells.length <= 400) break;
    spacing *= 1.15;
  }

  const offset = (start.getTime() - dep.getTime()) / 3600_000;
  const points: HeatmapPoint[] = cells.map(([lon, lat]) => {
    const pt: HeatmapPoint = { lat: +lat.toFixed(4), lon: +lon.toFixed(4), risk: [], wind: [], precip: [], snow: [] };
    for (let h = 0; h < 49; h++) {
      const wx = syntheticWeather(lon, lat, h + offset);
      pt.risk.push(assessWeather(wx, req.load_lb).level);
      pt.wind.push(wx.wind_mph);
      pt.precip.push(wx.rain_in_hr);
      pt.snow.push(wx.snow_in_hr);
    }
    return pt;
  });

  return { start: start.toISOString(), hours, spacing_deg: +spacing.toFixed(4), points };
}
