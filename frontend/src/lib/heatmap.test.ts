import { describe, expect, it } from "vitest";

import type { HeatmapResponse } from "@/api/types";
import { buildHeatCollection, HEAT_HOURS, heatColorExpression, heatPropKey, heatRadiusExpression, NO_DATA } from "./heatmap";
import { metresPerPixel } from "./geometry";

const series = <T,>(f: (h: number) => T): T[] => Array.from({ length: HEAT_HOURS }, (_, h) => f(h));

const resp: HeatmapResponse = {
  start: "2026-10-18T13:00:00Z",
  hours: series((h) => h).map((h) => new Date(Date.UTC(2026, 9, 18, 13 + h)).toISOString()),
  spacing_deg: 0.25,
  points: [
    { lat: 35, lon: -95, risk: series((h) => h % 5), wind: series((h) => h), precip: series(() => 0.12), snow: series(() => 0) },
    { lat: 36, lon: -94, risk: series(() => 0), wind: series(() => 5), precip: series(() => 0), snow: series(() => 1.5) },
  ],
};

describe("buildHeatCollection", () => {
  const fc = buildHeatCollection(resp);
  it("makes one point feature per grid point with numeric ids", () => {
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]?.id).toBe(0);
    expect(fc.features[1]?.geometry.coordinates).toEqual([-94, 36]);
  });
  it("flattens every hour into scalar properties, no arrays", () => {
    const p = fc.features[0]?.properties ?? {};
    expect(Object.keys(p)).toHaveLength(HEAT_HOURS * 4);
    expect(p.r7).toBe(2);
    expect(p.w48).toBe(48);
    expect(p.p0).toBe(0.12);
    expect(fc.features[1]?.properties.s30).toBe(1.5);
    expect(Object.values(p).every((v) => typeof v === "number")).toBe(true);
  });
  it("stores hours past the forecast horizon (null) as NO_DATA, not Low", () => {
    const withGap: HeatmapResponse = {
      ...resp,
      points: [{ lat: 35, lon: -95, risk: series((h) => (h > 40 ? null : 1)), wind: series(() => null), precip: series(() => 0), snow: series(() => 0) }],
    };
    const props = buildHeatCollection(withGap).features[0]?.properties ?? {};
    expect(props.r40).toBe(1);
    expect(props.r41).toBe(NO_DATA);
    expect(props.w0).toBe(NO_DATA);
  });
});

describe("expressions", () => {
  it("reads the hour's property in the colour step", () => {
    expect(heatPropKey("wind", 12)).toBe("w12");
    const expr = heatColorExpression("risk", 5) as unknown[];
    expect(expr[0]).toBe("step");
    expect(expr[1]).toEqual(["to-number", ["get", "r5"], NO_DATA]);
    expect(expr[2]).toBe("rgba(0, 0, 0, 0)");
    expect(expr[3]).toBe(0);
    expect(expr).toHaveLength(13);
  });
  it("sizes the disc to about 0.9 grid spacings at any zoom", () => {
    const expr = heatRadiusExpression(0.25, 38) as [string, unknown, unknown, number, number, number, number];
    const r0 = expr[4];
    const spacingPx = (0.25 * 111_320) / metresPerPixel(0, 38);
    expect(r0).toBeCloseTo(0.9 * spacingPx);
    expect(expr[6] / r0).toBeCloseTo(2 ** 22);
  });
});
