import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { geocode, postHeatmap, postRoutes } from "@/api/client";
import type { HeatmapRequest, LonLat, RoutesRequest, RoutesResponse } from "@/api/types";
import { simplifyToMax } from "@/lib/geometry";

/**
 * Geocode autocomplete. The query key changes with the (debounced) text, and
 * React Query aborts the previous request's signal when it does, so a stale
 * answer can never overwrite a newer one.
 */
export function useGeocode(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: ["geocode", query.toLowerCase()],
    queryFn: ({ signal }) => geocode(query, signal),
    enabled: query.length >= 3,
    staleTime: 60 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/**
 * `keepPrevious`: keep showing the last answer while the next loads. Used when
 * only the departure moved (the travel-window drag), so the map, heatmap and
 * cards stay put instead of flashing to skeletons.
 */
export function useRoutes(req: RoutesRequest | null, keepPrevious = false) {
  return useQuery({
    queryKey: ["routes", req],
    queryFn: ({ signal }) => postRoutes(req as RoutesRequest, signal),
    enabled: req !== null,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

/** Max points per route line sent to /api/heatmap (contract: <= 200). */
export const HEATMAP_LINE_MAX_POINTS = 200;

/**
 * `anchor` is the departure the grid starts from: the one typed in the form.
 * Moving the departure with the travel window keeps the anchor, so the grid
 * (and its hour 0) stays put and only the routes are re-planned.
 */
export function heatmapRequestFor(data: RoutesResponse, anchor: string = data.departure): HeatmapRequest {
  return {
    departure: anchor,
    load_lb: data.load_lb,
    lines: data.routes.map((r) => simplifyToMax(r.geometry.coordinates as LonLat[], HEATMAP_LINE_MAX_POINTS)),
  };
}

export function useHeatmap(data: RoutesResponse | undefined, anchor?: string) {
  return useQuery({
    // Anchor, load and the route shapes decide the grid; the whole response is not a good key.
    queryKey: [
      "heatmap",
      anchor ?? data?.departure,
      data?.load_lb,
      data?.routes.map((r) => `${r.id}:${r.distance_mi}:${r.geometry.coordinates[0]?.join(",")}`).join("|"),
    ],
    queryFn: ({ signal }) => postHeatmap(heatmapRequestFor(data as RoutesResponse, anchor), signal),
    enabled: data !== undefined,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}
