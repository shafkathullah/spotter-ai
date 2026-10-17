import type { Map as MapLibreMap } from "maplibre-gl";

import { levelColorExpression } from "@/lib/map-style";
import { IDS } from "./map-context";

const EMPTY = { type: "FeatureCollection" as const, features: [] };

const INK = "#101321";
const ROUTE_MUTED = "#5d6478";
const NONE_SELECTED: ["==", ["get", string], string] = ["==", ["get", "route_id"], ""];

/**
 * Heat source tiles stop at this zoom and are overzoomed above it. MapLibre draws a circle only
 * from the tile that contains its centre, and a disc reaches ~0.9 grid spacings (0.15-0.55 deg)
 * past it. At z11+ a tile is narrower than that, so the grid points whose discs cover the view sit
 * in tiles that never load and the wash vanished. A z4 tile is ~22 deg wide, so the points
 * around any view are in the same (loaded) tile; positions keep ~300 m precision, far finer than
 * the 15-40 km grid.
 */
export const HEAT_SOURCE_MAXZOOM = 4;

/**
 * Adds every app source and layer once, in paint order, when the basemap
 * style has loaded. From then on the components only call setData (when a
 * response arrives), setFilter / setPaintProperty (selection, hour, metric)
 * and setFeatureState (hover). Nothing is ever re-added.
 *
 * Order, bottom to top: heat wash (under the basemap labels), all routes
 * (casing + muted line), the selected route (dark casing + risk gradient),
 * other routes' checkpoints, then the selected route's checkpoints.
 */
export function setupLayers(map: MapLibreMap) {
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;

  map.addSource(IDS.heatSource, { type: "geojson", data: EMPTY, maxzoom: HEAT_SOURCE_MAXZOOM });
  map.addSource(IDS.routesSource, { type: "geojson", data: EMPTY, lineMetrics: true });
  map.addSource(IDS.checkpointsSource, { type: "geojson", data: EMPTY });

  map.addLayer(
    {
      id: IDS.heatLayer,
      type: "circle",
      source: IDS.heatSource,
      paint: {
        "circle-radius": 0,
        "circle-blur": 0.9,
        "circle-color": "rgba(0,0,0,0)",
        "circle-pitch-alignment": "map",
      },
    },
    firstSymbol,
  );

  map.addLayer({
    id: IDS.routesCasing,
    type: "line",
    source: IDS.routesSource,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": ["case", ["get", "recommended"], 9, 7],
      "line-opacity": 0.9,
    },
  });
  map.addLayer({
    id: IDS.routesLine,
    type: "line",
    source: IDS.routesSource,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ROUTE_MUTED,
      "line-width": ["case", ["get", "recommended"], 5, 3.5],
      "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.95, 0.6],
    },
  });
  map.addLayer({
    id: IDS.selectedCasing,
    type: "line",
    source: IDS.routesSource,
    filter: NONE_SELECTED,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": INK, "line-width": ["case", ["get", "recommended"], 10, 9], "line-opacity": 0.92 },
  });
  map.addLayer({
    id: IDS.selectedLine,
    type: "line",
    source: IDS.routesSource,
    filter: NONE_SELECTED,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#2e9d5b", "line-width": ["case", ["get", "recommended"], 6, 5] },
  });

  map.addLayer({
    id: IDS.checkpointsOther,
    type: "circle",
    source: IDS.checkpointsSource,
    filter: ["!=", ["get", "route_id"], ""],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 9, 3.5],
      "circle-color": levelColorExpression(),
      "circle-opacity": 0.55,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
      "circle-stroke-opacity": 0.7,
    },
  });
  map.addLayer({
    id: IDS.checkpointsHalo,
    type: "circle",
    source: IDS.checkpointsSource,
    filter: NONE_SELECTED,
    paint: {
      "circle-radius": ["case", ["boolean", ["feature-state", "hover"], false], 12, 7.5],
      "circle-color": INK,
      "circle-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.32, 0.22],
      "circle-blur": 0.35,
    },
  });
  map.addLayer({
    id: IDS.checkpoints,
    type: "circle",
    source: IDS.checkpointsSource,
    filter: NONE_SELECTED,
    paint: {
      "circle-radius": ["case", ["boolean", ["feature-state", "hover"], false], 8, 5.5],
      "circle-color": levelColorExpression(),
      "circle-stroke-color": ["case", ["boolean", ["feature-state", "hover"], false], INK, "#ffffff"],
      "circle-stroke-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.5, 1.5],
    },
  });
}

/** Filters for "only the selected route" and "every other route". */
export function selectedFilter(routeId: string): ["==", ["get", string], string] {
  return ["==", ["get", "route_id"], routeId];
}
export function otherFilter(routeId: string): ["!=", ["get", string], string] {
  return ["!=", ["get", "route_id"], routeId];
}
