import { useEffect, useRef } from "react";
import type { Marker } from "maplibre-gl";

import type { RouteOption } from "@/api/types";
import { positionAtTime } from "@/lib/trip";
import { useMapHandle } from "./map-context";

/**
 * A dot on the selected route where the truck would be at the heatmap hour,
 * so the forecast hour and the trip line up. One DOM marker moved with
 * setLngLat; no GeoJSON upload per slider step.
 */
export function TruckMarker({ route, atIso }: { route: RouteOption | undefined; atIso: string | undefined }) {
  const handle = useMapHandle();
  const marker = useRef<Marker | null>(null);

  useEffect(() => {
    if (!handle) return;
    const node = document.createElement("div");
    node.setAttribute("aria-hidden", "true");
    node.className = "size-3.5 rounded-full border-2 border-white bg-accent shadow-raised";
    node.style.display = "none";
    marker.current = new handle.ml.Marker({ element: node }).setLngLat([0, 0]).addTo(handle.map);
    return () => {
      marker.current?.remove();
      marker.current = null;
    };
  }, [handle]);

  useEffect(() => {
    const m = marker.current;
    if (!m) return;
    const at = route && atIso ? positionAtTime(route.checkpoints, atIso) : null;
    if (at) {
      m.setLngLat(at);
      m.getElement().style.display = "";
    } else {
      m.getElement().style.display = "none";
    }
  }, [handle, route, atIso]);

  return null;
}
