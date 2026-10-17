import { describe, expect, it } from "vitest";

import type { Checkpoint } from "@/api/types";
import { positionAtTime } from "./trip";

const base: Omit<Checkpoint, "idx" | "lat" | "lon" | "distance_mi" | "eta"> = { owned_miles: 0, weather: { wind_mph: 0, gust_mph: 0, rain_in_hr: 0, snow_in_hr: 0, temp_f: 0, weather_code: 0 }, levels: { wind: 0, wind_load_adjusted: 0, rain: 0, snow: 0 }, level: 0, level_label: "Low", drivers: [] };
const cps: Checkpoint[] = [
  { ...base, idx: 0, lat: 0, lon: 0, distance_mi: 0, eta: "2026-10-18T08:00:00-05:00" },
  { ...base, idx: 1, lat: 0, lon: 1, distance_mi: 25, eta: "2026-10-18T09:00:00-05:00" },
  { ...base, idx: 2, lat: 1, lon: 1, distance_mi: 50, eta: "2026-10-18T11:00:00-05:00" },
];

describe("positionAtTime", () => {
  it("interpolates between bracketing ETAs", () => {
    expect(positionAtTime(cps, "2026-10-18T13:30:00Z")).toEqual([0.5, 0]);
    expect(positionAtTime(cps, "2026-10-18T15:00:00Z")).toEqual([1, 0.5]);
  });
  it("is null outside the trip", () => {
    expect(positionAtTime(cps, "2026-10-18T12:59:00Z")).toBeNull();
    expect(positionAtTime(cps, "2026-10-18T16:01:00Z")).toBeNull();
    expect(positionAtTime([], "2026-10-18T13:00:00Z")).toBeNull();
  });
});
