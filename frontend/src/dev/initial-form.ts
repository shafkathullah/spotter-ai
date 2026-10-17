import type { RoutesRequest } from "@/api/types";
import type { TripFormValues } from "@/components/form/validate";
import { nextFullHour, toDateTimeLocalValue, toIsoWithOffset } from "@/lib/time";

/** Dev fixture mode: the sample trip, prefilled and submitted on load. */
export function DEV_INITIAL_FORM(): { values: Partial<TripFormValues>; request: RoutesRequest } {
  const origin = { label: "Dallas, Texas, United States", lat: 32.7767, lon: -96.797 };
  const destination = { label: "Chicago, Illinois, United States", lat: 41.8781, lon: -87.6298 };
  const dep = nextFullHour();
  return {
    values: { origin, destination, departure: toDateTimeLocalValue(dep), load: "42000", interval: 25 },
    request: { origin, destination, departure: toIsoWithOffset(dep), load_lb: 42000, interval_mi: 25 },
  };
}
