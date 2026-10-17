import type { CheckpointLevels, RiskLevel } from "../api/types.ts";
import { classifyRain, classifySnow, classifyWind, RISK } from "../lib/risk.ts";
import type { SyntheticWeather } from "./synthetic-weather.ts";

/**
 * Dev fixture only: the brief's rules applied to synthetic weather, so the
 * sample trip and the sample heatmap look like real answers. The backend is
 * the source of truth for these rules in the running app.
 */
export function assessWeather(
  w: SyntheticWeather,
  loadLb: number,
): { levels: CheckpointLevels; level: RiskLevel; drivers: string[] } {
  const wind = classifyWind(w.wind_mph);
  let adjusted: RiskLevel = wind;
  if (w.wind_mph >= 55) adjusted = 4;
  else if (w.wind_mph >= 45 && loadLb > 30_000) adjusted = 4;
  else if (w.wind_mph >= 35 && loadLb > 40_000) adjusted = Math.max(adjusted, 3) as RiskLevel;
  const rain = classifyRain(w.rain_in_hr);
  const snow = classifySnow(w.snow_in_hr);
  const level = Math.max(adjusted, rain, snow) as RiskLevel;

  const drivers: string[] = [];
  const lb = loadLb.toLocaleString("en-US");
  if (adjusted > wind) {
    drivers.push(`Wind ${Math.round(w.wind_mph)} mph with a ${lb} lb load: ${RISK[adjusted].label}`);
  } else if (wind > 0) {
    drivers.push(`Wind ${Math.round(w.wind_mph)} mph: ${RISK[wind].label}`);
  }
  if (rain > 0) drivers.push(`Rain ${w.rain_in_hr.toFixed(2)} in/hr: ${RISK[rain].label}`);
  if (snow > 0) drivers.push(`Snow ${w.snow_in_hr.toFixed(2)} in/hr: ${RISK[snow].label}`);

  return { levels: { wind, wind_load_adjusted: adjusted, rain, snow }, level, drivers };
}
