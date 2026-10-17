import { useEffect, useMemo, useRef } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

import type { HeatmapResponse } from "@/api/types";
import { buildHeatCollection, heatColorExpression, heatRadiusExpression, meanLatitude } from "@/lib/heatmap";
import type { HeatMetric } from "@/lib/risk";
import { IDS, useMapHandle } from "./map-context";

const EMPTY = { type: "FeatureCollection" as const, features: [] };

function heatSource(map: MapLibreMap): GeoJSONSource | undefined {
  return map.getSource(IDS.heatSource) as GeoJSONSource | undefined;
}

interface HeatLayerProps {
  data: HeatmapResponse | undefined;
  hour: number;
  metric: HeatMetric;
  visible: boolean;
}

/**
 * The corridor weather wash. The GeoJSON (every hour flattened into scalar
 * properties) is built and uploaded once per response. Moving the slider or
 * switching the metric only swaps the colour expression, coalesced to one
 * `setPaintProperty` per animation frame; the data is never re-sent.
 *
 * The source is emptied on unmount: the panel unmounts while a new search
 * loads (and stays gone if it fails), and the old trip's wash must not stay
 * drawn on a map with no routes and no controls to hide it.
 */
export function HeatLayer({ data, hour, metric, visible }: HeatLayerProps) {
  const handle = useMapHandle();
  const collection = useMemo(() => (data ? buildHeatCollection(data) : null), [data]);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!handle) return;
    const { map } = handle;
    return () => {
      try {
        heatSource(map)?.setData(EMPTY);
      } catch {
        // The map itself is being torn down; nothing left to clear.
      }
    };
  }, [handle]);

  useEffect(() => {
    if (!handle) return;
    const { map } = handle;
    heatSource(map)?.setData(collection ?? EMPTY);
    if (data && data.points.length > 0) {
      map.setPaintProperty(IDS.heatLayer, "circle-radius", heatRadiusExpression(data.spacing_deg, meanLatitude(data)));
    }
  }, [handle, collection, data]);

  useEffect(() => {
    if (!handle) return;
    const { map } = handle;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      map.setPaintProperty(IDS.heatLayer, "circle-color", heatColorExpression(metric, hour));
    });
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [handle, hour, metric]);

  useEffect(() => {
    if (!handle) return;
    handle.map.setLayoutProperty(IDS.heatLayer, "visibility", visible ? "visible" : "none");
  }, [handle, visible]);

  return null;
}
