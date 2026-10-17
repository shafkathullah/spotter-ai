import { createContext, useContext } from "react";
import type * as MapLibre from "maplibre-gl";

export type MapLibreModule = typeof MapLibre;

export interface MapHandle {
  map: MapLibre.Map;
  /** The lazily loaded module, for Popup / Marker / LngLatBounds constructors. */
  ml: MapLibreModule;
}

export const MapContext = createContext<MapHandle | null>(null);

/** The single app-lifetime map, or null until its style has loaded. */
export function useMapHandle(): MapHandle | null {
  return useContext(MapContext);
}

/** Ids of the sources and layers this app adds on top of the basemap. */
export const IDS = {
  heatSource: "heat",
  heatLayer: "heat",
  routesSource: "routes",
  routesCasing: "routes-casing",
  routesLine: "routes-line",
  selectedCasing: "route-selected-casing",
  selectedLine: "route-selected-line",
  checkpointsSource: "checkpoints",
  checkpointsOther: "checkpoints-other",
  checkpointsHalo: "checkpoints-halo",
  checkpoints: "checkpoints",
} as const;
