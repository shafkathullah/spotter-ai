import { describe, expect, it } from "vitest";

import { hoursBetween, nextFullHour, parseDateTimeLocal, toDateTimeLocalValue, toIsoWithOffset } from "./time";

// vite.config.ts runs tests with TZ=America/Chicago.
describe("local time helpers", () => {
  it("rounds up to the next full hour", () => {
    expect(toDateTimeLocalValue(nextFullHour(new Date(2026, 9, 17, 14, 20)))).toBe("2026-10-17T15:00");
    expect(toDateTimeLocalValue(nextFullHour(new Date(2026, 9, 17, 15, 0)))).toBe("2026-10-17T16:00");
    expect(toDateTimeLocalValue(nextFullHour(new Date(2026, 9, 17, 23, 30)))).toBe("2026-10-18T00:00");
  });

  it("parses datetime-local values as local time", () => {
    const d = parseDateTimeLocal("2026-10-18T08:00");
    expect(d?.getHours()).toBe(8);
    expect(parseDateTimeLocal("nope")).toBeNull();
  });

  it("serialises with the local offset, DST aware", () => {
    expect(toIsoWithOffset(new Date(2026, 9, 18, 8, 0))).toBe("2026-10-18T08:00:00-05:00");
    expect(toIsoWithOffset(new Date(2026, 11, 1, 8, 0))).toBe("2026-12-01T08:00:00-06:00");
    expect(new Date(toIsoWithOffset(new Date(2026, 9, 18, 8, 0))).toISOString()).toBe("2026-10-18T13:00:00.000Z");
  });

  it("measures hours between instants across offsets", () => {
    expect(hoursBetween("2026-10-18T13:00:00Z", "2026-10-18T08:30:00-05:00")).toBe(0.5);
  });
});
