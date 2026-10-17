import { describe, expect, it } from "vitest";

import {
  formatAvgRisk,
  formatDateTimeTz,
  formatDayHour,
  formatDayTime,
  formatDistance,
  formatDuration,
  formatHourOffset,
  formatInHr,
  formatLoad,
  formatMiles,
  formatMph,
  timeZoneAbbr,
} from "./format";

describe("formatDuration", () => {
  it("shows hours and zero-padded minutes", () => {
    expect(formatDuration(61_560)).toBe("17h 06m");
    expect(formatDuration(3600)).toBe("1h 00m");
  });
  it("drops hours under an hour and rounds to the minute", () => {
    expect(formatDuration(2520)).toBe("42m");
    expect(formatDuration(89)).toBe("1m");
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-5)).toBe("0m");
  });
  it("rounds 59.5 minutes up into the next hour", () => {
    expect(formatDuration(3570)).toBe("1h 00m");
  });
});

describe("distances and weather", () => {
  it("formats miles", () => {
    expect(formatDistance(966.62)).toBe("967 mi");
    expect(formatDistance(1006.6)).toBe("1,007 mi");
    expect(formatDistance(4.26)).toBe("4.3 mi");
    expect(formatMiles(0)).toBe("0 mi");
    expect(formatMiles(62.5)).toBe("62.5 mi");
    expect(formatMiles(250)).toBe("250 mi");
  });
  it("formats load, wind, precipitation and risk", () => {
    expect(formatLoad(42000)).toBe("42,000 lb");
    expect(formatMph(37.6)).toBe("38 mph");
    expect(formatInHr(0.1)).toBe("0.10 in/hr");
    expect(formatAvgRisk(1.2)).toBe("1.20");
    expect(formatHourOffset(12)).toBe("T+12 h");
  });
});

describe("times with a zone", () => {
  const iso = "2026-10-18T14:15:00-05:00";
  it("formats in the given zone", () => {
    expect(formatDayTime(iso, "America/Chicago")).toBe("Sun 2:15 PM");
    expect(formatDayTime(iso, "America/New_York")).toBe("Sun 3:15 PM");
    expect(formatDayHour(iso, "America/Chicago")).toBe("Sun 2 PM");
    expect(timeZoneAbbr(iso, "America/Chicago")).toBe("CDT");
  });
  it("includes date and zone for arrivals", () => {
    expect(formatDateTimeTz(iso, "America/Chicago")).toBe("Sun, Oct 18, 2:15 PM CDT");
  });
  it("crosses DST correctly", () => {
    expect(timeZoneAbbr("2026-11-02T12:00:00-06:00", "America/Chicago")).toBe("CST");
  });
});
