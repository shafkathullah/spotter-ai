import { describe, expect, it } from "vitest";

import { validateTrip, type TripFormValues } from "./validate";

const now = new Date(2026, 9, 17, 22, 0);
const ok: TripFormValues = {
  origin: { label: "Dallas", lat: 32.7767, lon: -96.797 },
  destination: { label: "Chicago", lat: 41.8781, lon: -87.6298 },
  departure: "2026-10-18T08:00",
  load: "42000",
  interval: 25,
};

describe("validateTrip", () => {
  it("builds the request with the local offset", () => {
    const { errors, request } = validateTrip(ok, now);
    expect(errors).toEqual({});
    expect(request).toEqual({
      origin: ok.origin,
      destination: ok.destination,
      departure: "2026-10-18T08:00:00-05:00",
      load_lb: 42000,
      interval_mi: 25,
    });
  });
  it("needs both places, and different ones", () => {
    expect(validateTrip({ ...ok, origin: null }, now).errors.origin).toBeTruthy();
    expect(validateTrip({ ...ok, destination: ok.origin }, now).errors.destination).toMatch(/same place/);
  });
  it("rejects departures over an hour in the past or beyond the forecast", () => {
    expect(validateTrip({ ...ok, departure: "2026-10-17T20:30" }, now).errors.departure).toMatch(/past/);
    expect(validateTrip({ ...ok, departure: "2026-10-17T21:30" }, now).errors.departure).toBeUndefined();
    expect(validateTrip({ ...ok, departure: "2026-11-10T08:00" }, now).errors.departure).toMatch(/16 days/);
    expect(validateTrip({ ...ok, departure: "" }, now).errors.departure).toBeTruthy();
  });
  it("bounds the load to 1..80,000 whole pounds", () => {
    expect(validateTrip({ ...ok, load: "0" }, now).errors.load).toBeTruthy();
    expect(validateTrip({ ...ok, load: "80001" }, now).errors.load).toBeTruthy();
    expect(validateTrip({ ...ok, load: "80,000" }, now).request?.load_lb).toBe(80000);
    expect(validateTrip({ ...ok, load: "1.5" }, now).errors.load).toMatch(/whole/);
    expect(validateTrip({ ...ok, load: "" }, now).errors.load).toBeTruthy();
  });
});
