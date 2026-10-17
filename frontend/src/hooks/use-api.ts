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

export function useRoutes(req: RoutesRequest | null) {
  return useQuery({
    queryKey: ["routes", req],
    queryFn: ({ signal }) => postRoutes(req as RoutesRequest, signal),
    enabled: req !== null,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

/** Max points per route line sent to /api/heatmap (contract: <= 200). */
export const HEATMAP_LINE_MAX_POINTS = 200;

export function heatmapRequestFor(data: RoutesResponse): HeatmapRequest {
  return {
    departure: data.departure,
    load_lb: data.load_lb,
    lines: data.routes.map((r) => simplifyToMax(r.geometry.coordinates as LonLat[], HEATMAP_LINE_MAX_POINTS)),
  };
}

export function useHeatmap(data: RoutesResponse | undefined) {
  return useQuery({
    // Departure, load and the route shapes decide the grid; the whole response is not a good key.
    queryKey: [
      "heatmap",
      data?.departure,
      data?.load_lb,
      data?.routes.map((r) => `${r.id}:${r.distance_mi}:${r.geometry.coordinates[0]?.join(",")}`).join("|"),
    ],
    queryFn: ({ signal }) => postHeatmap(heatmapRequestFor(data as RoutesResponse), signal),
    enabled: data !== undefined,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}
