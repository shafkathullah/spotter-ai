import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { classifyRain, classifySnow, classifyWind, clampLevel, metricStops, nextUp, RISK, riskMeta, withAlpha } from "./risk";

describe("wind thresholds (mph, lower bound inclusive)", () => {
  it.each([
    [0, 0],
    [24.9, 0],
    [25, 1],
    [34.99, 1],
    [35, 2],
    [44.9, 2],
    [45, 3],
    [54.9, 3],
    [55, 4],
    [80, 4],
  ])("%d mph -> %d", (mph, level) => expect(classifyWind(mph)).toBe(level));
});

describe("rain thresholds (in/hr), exactly 1.00 is Severe", () => {
  it.each([
    [0, 0],
    [0.09, 0],
    [0.1, 1],
    [0.249, 1],
    [0.25, 2],
    [0.49, 2],
    [0.5, 3],
    [1.0, 3],
    [1.01, 4],
  ])("%d in/hr -> %d", (v, level) => expect(classifyRain(v)).toBe(level));
});

describe("snow thresholds (in/hr), exactly 3.0 is Severe", () => {
  it.each([
    [0.49, 0],
    [0.5, 1],
    [1.0, 2],
    [1.99, 2],
    [2.0, 3],
    [3.0, 3],
    [3.01, 4],
  ])("%d in/hr -> %d", (v, level) => expect(classifySnow(v)).toBe(level));
});

describe("palette", () => {
  it("has five levels in order with labels", () => {
    expect(RISK.map((r) => r.label)).toEqual(["Low", "Moderate", "High", "Severe", "No Travel"]);
    expect(RISK.map((r) => r.key)).toEqual(["low", "moderate", "high", "severe", "no_travel"]);
  });

  it("matches the CSS tokens in styles.css", () => {
    const css = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
    const token = (name: string) => new RegExp(`--risk-${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css)?.[1]?.toLowerCase();
    const cssKey = (k: string) => k.replace("_", "-");
    for (const r of RISK) {
      expect(token(cssKey(r.key))).toBe(r.fill.toLowerCase());
      expect(token(`${cssKey(r.key)}-ink`)).toBe(r.ink.toLowerCase());
    }
  });

  it("clamps out-of-range levels", () => {
    expect(clampLevel(-1)).toBe(0);
    expect(clampLevel(9)).toBe(4);
    expect(clampLevel(Number.NaN)).toBe(0);
    expect(riskMeta(2).label).toBe("High");
  });

  it("converts hex to rgba", () => {
    expect(withAlpha("#2e9d5b", 0.5)).toBe("rgba(46, 157, 91, 0.5)");
  });
});

/** Evaluates a MapLibre `step` the way MapLibre does: the last stop <= input wins. */
function step(stops: readonly number[], v: number): number {
  let level = 0;
  stops.forEach((s, i) => {
    if (v >= s) level = i + 1;
  });
  return level;
}

describe("heatmap step stops agree with the classifiers", () => {
  it("nextUp is the next double", () => {
    expect(nextUp(1)).toBeGreaterThan(1);
    expect(nextUp(1) - 1).toBeLessThan(1e-15);
  });
  it.each([0, 0.05, 0.1, 0.2, 0.25, 0.3, 0.5, 0.99, 1.0, 1.0000001, 1.5])("rain %d", (v) => {
    expect(step(metricStops("precip"), v)).toBe(classifyRain(v));
  });
  it.each([0, 0.5, 0.9, 1, 2, 2.5, 3, 3.01])("snow %d", (v) => {
    expect(step(metricStops("snow"), v)).toBe(classifySnow(v));
  });
  it.each([0, 24.9, 25, 35, 44.99, 45, 55, 70])("wind %d", (v) => {
    expect(step(metricStops("wind"), v)).toBe(classifyWind(v));
  });
  it("risk levels map onto themselves", () => {
    for (const l of [0, 1, 2, 3, 4]) expect(step(metricStops("risk"), l)).toBe(l);
  });
});
