import type { MilesByLevel, RiskLabel, RiskLevel } from "@/api/types";

export interface RiskMeta {
  level: RiskLevel;
  key: keyof MilesByLevel;
  label: RiskLabel;
  /** Map, bar and swatch fill. Mirrors `--risk-*` in styles.css. */
  fill: string;
  /** Label colour on the 14% tint chip. Mirrors `--risk-*-ink` in styles.css. */
  ink: string;
}

/**
 * The one risk palette, used by cards, chips, bars, map checkpoints, the
 * selected route line and the heatmap. Green, amber, orange, red, deep purple:
 * ordered by lightness as well as hue, so it still reads as a ramp without
 * colour vision, and every chip carries its label too (never colour alone).
 */
export const RISK: readonly [RiskMeta, RiskMeta, RiskMeta, RiskMeta, RiskMeta] = [
  { level: 0, key: "low", label: "Low", fill: "#2e9d5b", ink: "#14653a" },
  { level: 1, key: "moderate", label: "Moderate", fill: "#e0a100", ink: "#7a5200" },
  { level: 2, key: "high", label: "High", fill: "#ef6a00", ink: "#9a3c00" },
  { level: 3, key: "severe", label: "Severe", fill: "#d42c2c", ink: "#a3191b" },
  { level: 4, key: "no_travel", label: "No Travel", fill: "#5b1d8f", ink: "#4b1679" },
];

export function clampLevel(n: number): RiskLevel {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 4) return 4;
  return Math.round(n) as RiskLevel;
}

export function riskMeta(level: number): RiskMeta {
  return RISK[clampLevel(level)];
}

/** Hex to `rgba()` with the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Per-checkpoint thresholds from the brief. Lower bound inclusive, upper
 * exclusive, except the Severe band for rain and snow, which includes its
 * upper bound: the table says No Travel is "> 1.00" in/hr rain and "> 3.0"
 * in/hr snow. Wind is No Travel at >= 55 mph.
 */
export const THRESHOLDS = {
  wind: { moderate: 25, high: 35, severe: 45, noTravel: 55 },
  rain: { moderate: 0.1, high: 0.25, severe: 0.5, noTravelAbove: 1.0 },
  snow: { moderate: 0.5, high: 1.0, severe: 2.0, noTravelAbove: 3.0 },
} as const;

export function classifyWind(mph: number): RiskLevel {
  const t = THRESHOLDS.wind;
  if (mph >= t.noTravel) return 4;
  if (mph >= t.severe) return 3;
  if (mph >= t.high) return 2;
  if (mph >= t.moderate) return 1;
  return 0;
}

export function classifyRain(inHr: number): RiskLevel {
  const t = THRESHOLDS.rain;
  if (inHr > t.noTravelAbove) return 4;
  if (inHr >= t.severe) return 3;
  if (inHr >= t.high) return 2;
  if (inHr >= t.moderate) return 1;
  return 0;
}

export function classifySnow(inHr: number): RiskLevel {
  const t = THRESHOLDS.snow;
  if (inHr > t.noTravelAbove) return 4;
  if (inHr >= t.severe) return 3;
  if (inHr >= t.high) return 2;
  if (inHr >= t.moderate) return 1;
  return 0;
}

/** The smallest double above `x`, so a MapLibre `step` (>= stop) can express "> x". */
export function nextUp(x: number): number {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  buf.setBigUint64(0, x >= 0 ? bits + 1n : bits - 1n);
  return buf.getFloat64(0);
}

export type HeatMetric = "risk" | "wind" | "precip" | "snow";

/** Stops for a MapLibre `step` on a metric's raw value, matching the classify* functions. */
export function metricStops(metric: HeatMetric): [number, number, number, number] {
  switch (metric) {
    case "risk":
      return [1, 2, 3, 4];
    case "wind": {
      const t = THRESHOLDS.wind;
      return [t.moderate, t.high, t.severe, t.noTravel];
    }
    case "precip": {
      const t = THRESHOLDS.rain;
      return [t.moderate, t.high, t.severe, nextUp(t.noTravelAbove)];
    }
    case "snow": {
      const t = THRESHOLDS.snow;
      return [t.moderate, t.high, t.severe, nextUp(t.noTravelAbove)];
    }
  }
}

/**
 * Heatmap wash per level: Low is a faint trace (the corridor stays visible
 * without shouting), each step up gets more opaque.
 */
export const HEAT_ALPHA: readonly [number, number, number, number, number] = [0.1, 0.42, 0.52, 0.6, 0.68];

export const MILES_KEYS: readonly (keyof MilesByLevel)[] = [
  "low",
  "moderate",
  "high",
  "severe",
  "no_travel",
];
