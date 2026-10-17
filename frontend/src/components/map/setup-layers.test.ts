import { describe, expect, it } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";

import { IDS } from "./map-context";
import { HEAT_SOURCE_MAXZOOM, setupLayers } from "./setup-layers";

function fakeMap() {
  const sources: Record<string, Record<string, unknown>> = {};
  const layers: string[] = [];
  const map = {
    getStyle: () => ({ layers: [{ id: "label", type: "symbol" }] }),
    addSource: (id: string, spec: Record<string, unknown>) => {
      sources[id] = spec;
    },
    addLayer: (layer: { id: string }) => {
      layers.push(layer.id);
    },
  };
  return { map: map as unknown as MapLibreMap, sources, layers };
}

describe("setupLayers", () => {
  it("caps the heat source zoom so grid discs survive zooming in", () => {
    const { map, sources } = fakeMap();
    setupLayers(map);
    // A z4 tile (~22 deg) is far wider than one disc (<= ~0.5 deg), so the points whose discs
    // cover any view share the loaded tile; at z11+ native tiles that was not true.
    expect(sources[IDS.heatSource]?.maxzoom).toBe(HEAT_SOURCE_MAXZOOM);
    expect(360 / 2 ** HEAT_SOURCE_MAXZOOM).toBeGreaterThan(10 * 0.55);
    // Other sources keep full-resolution tiles.
    expect(sources[IDS.routesSource]?.maxzoom).toBeUndefined();
  });
});
