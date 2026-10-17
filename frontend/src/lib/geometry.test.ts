import { describe, expect, it } from "vitest";

import type { LonLat } from "@/api/types";
import { bboxOf, douglasPeucker, haversineMi, metresPerPixel, pointAlong, simplifyToMax } from "./geometry";

function wiggly(n: number): LonLat[] {
  return Array.from({ length: n }, (_, i) => [-97 + i * 0.01, 33 + Math.sin(i / 300) * 0.8 + (i % 3) * 0.0001] as LonLat);
}

describe("simplifyToMax", () => {
  it("returns short lines unchanged", () => {
    const line = wiggly(50);
    expect(simplifyToMax(line, 200)).toEqual(line);
  });
  it("fits the cap and keeps both endpoints", () => {
    const line = wiggly(5000);
    const out = simplifyToMax(line, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.length).toBeGreaterThan(150);
    expect(out[0]).toEqual(line[0]);
    expect(out[out.length - 1]).toEqual(line[line.length - 1]);
  });
  it("drops collinear points", () => {
    const line: LonLat[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ];
    expect(douglasPeucker(line, 0.001)).toEqual([
      [0, 0],
      [3, 0],
    ]);
  });
});

describe("measures", () => {
  it("haversine Dallas to Chicago is about 803 mi", () => {
    expect(haversineMi([-96.797, 32.7767], [-87.6298, 41.8781])).toBeCloseTo(803, -1);
  });
  it("bbox spans all lines", () => {
    expect(
      bboxOf([
        [
          [-97, 33],
          [-90, 40],
        ],
        [[-95, 31]],
      ]),
    ).toEqual([-97, 31, -90, 40]);
    expect(bboxOf([])).toBeNull();
  });
  it("pointAlong interpolates by length", () => {
    const line: LonLat[] = [
      [0, 0],
      [0, 1],
      [0, 3],
    ];
    const mid = pointAlong(line, 0.5);
    expect(mid[0]).toBeCloseTo(0);
    expect(mid[1]).toBeCloseTo(1.5, 3);
    expect(pointAlong(line, 0)).toEqual([0, 0]);
    expect(pointAlong(line, 1)).toEqual([0, 3]);
  });
  it("metresPerPixel halves per zoom level", () => {
    expect(metresPerPixel(10, 40) / metresPerPixel(11, 40)).toBeCloseTo(2);
    expect(metresPerPixel(0, 0)).toBeCloseTo(78271.5, 0);
  });
});
