/**
 * Dev fixture only: a made-up but plausible weather field (a storm system
 * crossing the southern Plains toward the Great Lakes, with a rain shield
 * ahead of it and a snow band behind) as a pure function of place and hours
 * since departure. The fixture builder samples it for checkpoints, and the
 * fixture heatmap samples it on a grid, so the two always agree.
 * Not real data; never used outside `?fixture=1` in dev.
 */
export interface SyntheticWeather {
  wind_mph: number;
  gust_mph: number;
  rain_in_hr: number;
  snow_in_hr: number;
  temp_f: number;
  weather_code: number;
}

const KM_PER_DEG = 111.32;

function kmBetween(lon: number, lat: number, cx: number, cy: number): number {
  const dx = (lon - cx) * Math.cos((lat * Math.PI) / 180) * KM_PER_DEG;
  const dy = (lat - cy) * KM_PER_DEG;
  return Math.hypot(dx, dy);
}

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

export function syntheticWeather(lon: number, lat: number, hours: number): SyntheticWeather {
  // Storm centre: from northeast Texas toward the Ohio Valley over 32 hours.
  const t = Math.min(Math.max(hours, -6), 60) / 32;
  const cx = -94.6 + 7.5 * t;
  const cy = 33.0 + 6.0 * t;
  const d = kmBetween(lon, lat, cx, cy);
  const core = Math.exp(-((d / 250) ** 2));
  const wide = Math.exp(-((d / 480) ** 2));
  const ripple = 2.5 * Math.sin(lon * 1.7 + lat * 1.1 + hours * 0.3);

  const wind = Math.max(3, 8 + 34 * core + 12 * wide + ripple);
  const gust = wind * 1.32 + 3;

  // Rain shield ahead (east-northeast) of the centre.
  const dr = kmBetween(lon, lat, cx + 1.6, cy + 0.6);
  const rainCore = Math.exp(-((dr / 190) ** 2));
  const rainWide = Math.exp(-((dr / 360) ** 2));
  const rain = Math.max(0, 0.62 * rainCore + 0.12 * rainWide - 0.02);

  // Snow band behind (northwest), building after hour 10.
  const ramp = Math.min(1, Math.max(0, (hours - 10) / 14));
  const ds = kmBetween(lon, lat, cx - 2.6, cy + 1.4);
  const snow = Math.max(0, 1.5 * Math.exp(-((ds / 170) ** 2)) * ramp - 0.03);

  const temp = 74 - (lat - 32) * 2.4 - 12 * core - 6 * ramp * Math.exp(-((ds / 300) ** 2));

  let code = 1;
  if (snow >= 0.1) code = snow >= 1 ? 75 : 73;
  else if (rain >= 0.25) code = 65;
  else if (rain >= 0.1) code = 63;
  else if (rain >= 0.02) code = 61;
  else if (wind >= 30) code = 3;

  return {
    wind_mph: round(wind, 1),
    gust_mph: round(gust, 1),
    rain_in_hr: round(rain, 2),
    snow_in_hr: round(snow, 2),
    temp_f: round(temp, 1),
    weather_code: code,
  };
}
