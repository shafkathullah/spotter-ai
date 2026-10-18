import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { FIXTURE_MODE, getHealth } from "@/api/client";
import type { RoutesRequest } from "@/api/types";
import { TripForm } from "@/components/form/trip-form";
import { HeatmapPanel } from "@/components/map/heatmap-panel";
import { type MapHandle, MapContext } from "@/components/map/map-context";
import { MapView } from "@/components/map/map-view";
import { RouteLayers, type Selection } from "@/components/map/route-layers";
import * as ScrollArea from "@/components/primitives/scroll-area";
import * as Tooltip from "@/components/primitives/tooltip";
import { ResultsEmpty, ResultsError, ResultsPanel, ResultsSkeleton } from "@/components/results/results-panel";
import { useHeatmap, useRoutes } from "@/hooks/use-api";
import { checkpointStore } from "@/lib/checkpoint-store";
import { DEV_INITIAL_FORM } from "@/dev/initial-form";
import { cn } from "@/lib/utils";

export function App() {
  const [request, setRequest] = useState<RoutesRequest | null>(null);
  // The departure typed in the form: the heatmap grid's hour 0. A travel-window
  // drag moves request.departure but keeps this, and sets `shifted`.
  const [anchor, setAnchor] = useState<string | undefined>(undefined);
  const [shifted, setShifted] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [mapHandle, setMapHandle] = useState<MapHandle | null>(null);

  const routes = useRoutes(request, shifted);
  const heat = useHeatmap(routes.data, anchor);

  const submitTrip = useCallback((req: RoutesRequest) => {
    setAnchor(req.departure);
    setShifted(false);
    setRequest(req);
  }, []);
  const shiftDeparture = useCallback((departure: string) => {
    setShifted(true);
    setRequest((r) => (r ? { ...r, departure } : r));
  }, []);
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
    if (FIXTURE_MODE && initial?.request) submitTrip(initial.request);
  }, [initial, submitTrip]);

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
      replanning={routes.isPlaceholderData}
      onDepartureChange={shiftDeparture}
    />
  ) : null;

  const brand = (
    <div className="flex flex-col gap-1.5">
      <p className="label-mono text-ink-label">Spotter</p>
      <h1 className="font-display text-[28px] leading-[1.06]">Route weather</h1>
      <p className="text-sm leading-normal text-ink-secondary">
        Three truck routes, weather checked at the hour you reach each point, ranked for safety then time.
      </p>
    </div>
  );

  return (
    <MapContext.Provider value={mapHandle}>
      <Tooltip.Provider delay={400}>
        {/* Phones: one column (trip form, map, forecast card, results) that scrolls as a page.
            From md up the map is full-bleed and the trip bar, results panel and forecast card
            float over it as separate cards, 16px from the window edges and from each other.
            The wrappers are `display: contents` on phones so their children join the column. */}
        <div className="relative flex min-h-dvh flex-col md:block md:h-dvh md:overflow-hidden">
          <a
            href="#trip"
            className="sr-only z-50 rounded-md bg-action px-3 py-2 text-sm font-semibold text-on-action focus:not-sr-only focus:absolute focus:top-3 focus:left-3"
          >
            Skip to trip details
          </a>

          <main className="relative order-2 h-[55dvh] md:order-none min-h-[320px] md:absolute md:inset-0 md:h-auto md:min-h-0">
            <MapView onReady={setMapHandle} className="absolute inset-0 bg-ground" />
            <RouteLayers data={data} selection={selection} onSelect={selectFromMap} />
          </main>

          <div className="contents md:pointer-events-none md:absolute md:inset-0 md:z-10 md:flex md:flex-col md:gap-4 md:p-4">
            <header
              id="trip"
              data-map-inset="top"
              className="relative z-10 order-1 flex shrink-0 md:order-none flex-col gap-4 bg-surface px-4 pt-5 pb-4 shadow-[0_1px_0_var(--hairline)] md:pointer-events-auto md:rounded-panel md:px-4 md:pt-2.5 md:pb-3.5 md:shadow-raised"
            >
              <div className="md:hidden">{brand}</div>
              <TripForm
                initial={initial?.values}
                pending={routes.isFetching}
                departure={request?.departure}
                onSubmit={submitTrip}
              />
            </header>

            <div className="contents md:flex md:min-h-0 md:flex-1 md:items-start md:gap-4">
              {/* The panel hugs its content and scrolls in a Base UI ScrollArea once it reaches the
                  bottom gap. Before the first search it is only a small intro card (title and
                  tagline) from md up. On phones it is unbounded and the page scrolls. */}
              <aside
                data-map-inset="left"
                className="order-4 flex flex-col bg-ground md:order-none md:pointer-events-auto md:max-h-full md:w-[400px] md:shrink-0 md:overflow-hidden md:rounded-panel md:shadow-raised"
              >
                <ScrollArea.Default
                  className="md:min-h-0"
                  fade="y"
                  aria-label="Recommendation and routes"
                  contentClassName="flex flex-col gap-5 px-4 pt-5 pb-10 md:pb-5"
                >
                  <div className="hidden md:block">{brand}</div>

                  <div
                    aria-live="polite"
                    aria-busy={routes.isFetching}
                    className={cn("flex flex-col gap-4", request === null && "md:hidden")}
                  >
                    {request === null ? (
                      <ResultsEmpty />
                    ) : routes.isPending ? (
                      <ResultsSkeleton />
                    ) : routes.isError ? (
                      <ResultsError error={routes.error} onRetry={() => void routes.refetch()} />
                    ) : data ? (
                      <div className={routes.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
                        <ResultsPanel data={data} selectedId={selection?.id ?? null} onSelect={selectFromCard} />
                      </div>
                    ) : null}
                  </div>

                  <footer className={cn("pt-2 text-xs text-ink-label", request === null && "md:hidden")}>
                    Weather from Open-Meteo. Routing from{" "}
                    {provider === "ors" ? "OpenRouteService (heavy goods profile)" : "OSRM"}. Map data from
                    OpenStreetMap via OpenFreeMap.
                    {FIXTURE_MODE ? " Showing the bundled sample trip (dev fixture)." : ""}
                  </footer>
                </ScrollArea.Default>
              </aside>

              {heatPanel ? (
                <div className="order-3 px-4 pt-4 md:order-none md:flex md:min-w-0 md:flex-1 md:flex-col md:items-center md:self-stretch md:justify-end md:p-0">
                  <div data-map-inset="bottom" className="w-full md:max-w-[600px]">
                    {heatPanel}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Tooltip.Provider>
    </MapContext.Provider>
  );
}
