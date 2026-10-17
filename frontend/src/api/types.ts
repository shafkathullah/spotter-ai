/**
 * Types mirroring the backend API contract exactly (JSON, snake_case).
 * Keep in lockstep with backend/routing serializers.
 */

/** 0 Low, 1 Moderate, 2 High, 3 Severe, 4 No Travel. */
export type RiskLevel = 0 | 1 | 2 | 3 | 4;

export type RiskLabel = "Low" | "Moderate" | "High" | "Severe" | "No Travel";

export type RoutingProvider = "ors" | "osrm";

export type IntervalMi = 10 | 25 | 50;

/** [lon, lat] */
export type LonLat = [number, number];

export interface HealthResponse {
  ok: boolean;
  routing_provider: RoutingProvider;
}

export interface Place {
  label: string;
  lat: number;
  lon: number;
}

export interface GeocodeResponse {
  results: Place[];
}

export interface RoutesRequest {
  origin: Place;
  destination: Place;
  /** ISO 8601 with offset, e.g. 2026-10-18T08:00:00-05:00 */
  departure: string;
  /** 1..80000 */
  load_lb: number;
  interval_mi: IntervalMi;
}

export interface MilesByLevel {
  low: number;
  moderate: number;
  high: number;
  severe: number;
  no_travel: number;
}

export interface RouteSummary {
  max_level: RiskLevel;
  avg_risk: number;
  miles_by_level: MilesByLevel;
}

export interface CheckpointWeather {
  wind_mph: number;
  gust_mph: number;
  rain_in_hr: number;
  snow_in_hr: number;
  /** null only if Open-Meteo had no temperature for that hour. */
  temp_f: number | null;
  weather_code: number;
}

export interface CheckpointLevels {
  wind: RiskLevel;
  wind_load_adjusted: RiskLevel;
  rain: RiskLevel;
  snow: RiskLevel;
}

export interface Checkpoint {
  idx: number;
  lat: number;
  lon: number;
  distance_mi: number;
  eta: string;
  owned_miles: number;
  weather: CheckpointWeather;
  levels: CheckpointLevels;
  level: RiskLevel;
  level_label: RiskLabel;
  drivers: string[];
}

export interface LineStringGeometry {
  type: "LineString";
  coordinates: LonLat[];
}

export interface RouteOption {
  id: string;
  name: string;
  description: string;
  geometry: LineStringGeometry;
  distance_mi: number;
  duration_s: number;
  arrival: string;
  rank: number;
  recommended: boolean;
  summary: RouteSummary;
  checkpoints: Checkpoint[];
}

export interface RoutesResponse {
  departure: string;
  interval_mi: number;
  load_lb: number;
  routing_provider: RoutingProvider | string;
  recommended_route_id: string;
  no_safe_route: boolean;
  explanation: string;
  warnings: string[];
  routes: RouteOption[];
}

export interface HeatmapRequest {
  departure: string;
  load_lb: number;
  /** Each route geometry simplified to <= 200 points. */
  lines: LonLat[][];
}

export interface HeatmapPoint {
  lat: number;
  lon: number;
  /** 49 load-adjusted risk levels, hour 0..48. null past the forecast horizon. */
  risk: (number | null)[];
  /** 49 sustained wind values in mph, 1 dp. null past the forecast horizon. */
  wind: (number | null)[];
  /** 49 rain + showers values in in/hr, 2 dp. null past the forecast horizon. */
  precip: (number | null)[];
  /** 49 snowfall values in in/hr, 2 dp. null past the forecast horizon. */
  snow: (number | null)[];
}

export interface HeatmapResponse {
  /** Departure floored to the hour, UTC */
  start: string;
  /** 49 ISO timestamps */
  hours: string[];
  spacing_deg: number;
  points: HeatmapPoint[];
}

export interface ApiErrorBody {
  error: string;
}
