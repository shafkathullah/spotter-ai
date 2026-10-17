import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { FIXTURE_MODE, getHealth } from "@/api/client";
import type { RoutesRequest } from "@/api/types";
import { TripForm } from "@/components/form/trip-form";
import { HeatmapPanel } from "@/components/map/heatmap-panel";
import { type MapHandle, MapContext } from "@/components/map/map-context";
import { MapView } from "@/components/map/map-view";
import { RouteLayers, type Selection } from "@/components/map/route-layers";
import * as Tooltip from "@/components/primitives/tooltip";
import { ResultsEmpty, ResultsError, ResultsPanel, ResultsSkeleton } from "@/components/results/results-panel";
import { useHeatmap, useRoutes } from "@/hooks/use-api";
import { checkpointStore } from "@/lib/checkpoint-store";
import { DEV_INITIAL_FORM } from "@/dev/initial-form";

export function App() {
  const [request, setRequest] = useState<RoutesRequest | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [mapHandle, setMapHandle] = useState<MapHandle | null>(null);

  const routes = useRoutes(request);
  const heat = useHeatmap(routes.data);
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => getHealth(signal),
    enabled: !FIXTURE_MODE,
    staleTime: Infinity,
    retry: false,
  });

  // A new answer selects its recommended route; the map fits all three on its own.
  useEffect(() => {
    checkpointStore.setHovered(null);
    checkpointStore.setPicked(null);
    setSelection(routes.data ? { id: routes.data.recommended_route_id, fit: false } : null);
  }, [routes.data]);

  const selectFromCard = useCallback((id: string) => {
    checkpointStore.setPicked(null);
    setSelection({ id, fit: true });
  }, []);
  const selectFromMap = useCallback((s: Selection) => {
    checkpointStore.setPicked(null);
    setSelection(s);
  }, []);

  // Dev fixture mode plans the sample trip straight away.
  const [initial] = useState(() => (FIXTURE_MODE ? DEV_INITIAL_FORM() : undefined));
  useEffect(() => {
    if (FIXTURE_MODE && initial?.request) setRequest(initial.request);
  }, [initial]);

  const data = routes.data;
  const selectedRoute = data?.routes.find((r) => r.id === selection?.id);
  const provider = data?.routing_provider ?? health.data?.routing_provider;

  // Exactly one heatmap panel is mounted (it owns the heat layer and the
  // slider state), always in the same parent: CSS floats it over the map from
  // md up and stacks it under the map on phones, so rotating a phone or
  // resizing across the breakpoint never remounts it.
  const heatPanel = data ? (
    <HeatmapPanel
      data={heat.data}
      loading={heat.isPending}
      error={heat.error}
      onRetry={() => void heat.refetch()}
      route={selectedRoute}
      departure={data.departure}
    />
  ) : null;

  return (
    <MapContext.Provider value={mapHandle}>
      <Tooltip.Provider delay={400}>
        <div className="flex min-h-dvh flex-col md:h-dvh md:flex-row md:overflow-hidden">
          <a
            href="#trip"
            className="sr-only z-50 rounded-md bg-action px-3 py-2 text-sm font-semibold text-on-action focus:not-sr-only focus:absolute focus:top-3 focus:left-3"
          >
            Skip to trip details
          </a>

          <main className="relative order-1 flex shrink-0 flex-col md:order-2 md:min-h-0 md:flex-1">
            <div className="relative h-[55dvh] min-h-[320px] md:h-auto md:min-h-0 md:flex-1">
              <MapView onReady={setMapHandle} className="absolute inset-0 bg-ground" />
            </div>
            {heatPanel ? (
              <div className="px-4 pt-4 md:pointer-events-none md:absolute md:inset-x-3 md:bottom-8 md:flex md:justify-center md:p-0">
                <div className="w-full md:max-w-[600px]">{heatPanel}</div>
              </div>
            ) : null}
            <RouteLayers data={data} selection={selection} onSelect={selectFromMap} />
          </main>

          <aside
            id="trip"
            className="order-2 flex flex-col gap-5 bg-ground px-4 pt-5 pb-10 md:order-1 md:w-[400px] md:shrink-0 md:overflow-y-auto md:overscroll-contain md:px-5 md:pt-6 md:shadow-[1px_0_0_var(--hairline)]"
          >
            <header className="flex flex-col gap-2">
              <p className="label-mono text-ink-label">Spotter</p>
              <h1 className="font-display text-[32px] leading-[1.06]">Route weather</h1>
              <p className="text-[15px] leading-normal text-ink-secondary">
                Three truck routes, weather checked at the hour you reach each point, ranked for safety then time.
              </p>
            </header>

            <div className="rounded-panel bg-surface p-4 shadow-resting">
              <TripForm initial={initial?.values} pending={routes.isFetching} onSubmit={setRequest} />
            </div>

            <div aria-live="polite" aria-busy={routes.isFetching} className="flex flex-col gap-4">
              {request === null ? (
                <ResultsEmpty />
              ) : routes.isPending ? (
                <ResultsSkeleton />
              ) : routes.isError ? (
                <ResultsError error={routes.error} onRetry={() => void routes.refetch()} />
              ) : data ? (
                <ResultsPanel data={data} selectedId={selection?.id ?? null} onSelect={selectFromCard} />
              ) : null}
            </div>

            <footer className="mt-auto pt-2 text-xs text-ink-label">
              Weather from Open-Meteo. Routing from {provider === "ors" ? "OpenRouteService (heavy goods profile)" : "OSRM"}.
              Map data from OpenStreetMap via OpenFreeMap.
              {FIXTURE_MODE ? " Showing the bundled sample trip (dev fixture)." : ""}
            </footer>
          </aside>
        </div>
      </Tooltip.Provider>
    </MapContext.Provider>
  );
}
