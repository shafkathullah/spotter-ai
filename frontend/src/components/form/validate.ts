import type { IntervalMi, Place, RoutesRequest } from "@/api/types";
import { parseDateTimeLocal, toIsoWithOffset } from "@/lib/time";

export interface TripFormValues {
  origin: Place | null;
  destination: Place | null;
  /** datetime-local value */
  departure: string;
  /** raw text of the number field */
  load: string;
  interval: IntervalMi;
}

export type TripFormErrors = Partial<Record<"origin" | "destination" | "departure" | "load", string>>;

export const LOAD_MIN = 1;
export const LOAD_MAX = 80_000;
/** Open-Meteo forecasts reach 16 days; the trip itself must fit, so the form stops a bit short. */
export const MAX_DAYS_AHEAD = 15;

/**
 * Client-side checks that mirror the backend's 400s, so most mistakes are
 * caught at the field. The backend stays the authority (it also checks that
 * departure + trip time fits the forecast).
 */
export function validateTrip(
  v: TripFormValues,
  now: Date = new Date(),
): { errors: TripFormErrors; request: RoutesRequest | null } {
  const errors: TripFormErrors = {};

  if (!v.origin) errors.origin = "Pick a starting point from the list.";
  if (!v.destination) errors.destination = "Pick a destination from the list.";
  if (
    v.origin &&
    v.destination &&
    Math.abs(v.origin.lat - v.destination.lat) < 1e-4 &&
    Math.abs(v.origin.lon - v.destination.lon) < 1e-4
  ) {
    errors.destination = "Destination is the same place as the start.";
  }

  const dep = parseDateTimeLocal(v.departure);
  if (!dep) {
    errors.departure = "Enter a departure date and time.";
  } else if (dep.getTime() < now.getTime() - 60 * 60 * 1000) {
    errors.departure = "Departure is more than an hour in the past.";
  } else if (dep.getTime() > now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000) {
    errors.departure = `Weather forecasts reach about 16 days ahead. Pick a departure within ${MAX_DAYS_AHEAD} days.`;
  }

  const raw = v.load.trim().replace(/,/g, "");
  const load = Number(raw);
  if (raw === "" || !Number.isFinite(load)) {
    errors.load = "Enter the load weight in pounds.";
  } else if (!Number.isInteger(load)) {
    errors.load = "Use whole pounds.";
  } else if (load < LOAD_MIN || load > LOAD_MAX) {
    errors.load = `Load must be between ${LOAD_MIN} and ${LOAD_MAX.toLocaleString("en-US")} lb.`;
  }

  if (Object.keys(errors).length > 0 || !v.origin || !v.destination || !dep) {
    return { errors, request: null };
  }
  return {
    errors,
    request: {
      origin: v.origin,
      destination: v.destination,
      departure: toIsoWithOffset(dep),
      load_lb: load,
      interval_mi: v.interval,
    },
  };
}
