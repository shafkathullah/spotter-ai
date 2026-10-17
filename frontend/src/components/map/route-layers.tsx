import { useEffect, useRef } from "react";
import type { GeoJSONSource, LngLatBoundsLike, MapLayerMouseEvent, Marker, Popup } from "maplibre-gl";

import type { LonLat, RouteOption, RoutesResponse } from "@/api/types";
import { checkpointStore } from "@/lib/checkpoint-store";
import { bboxOf, pointAlong } from "@/lib/geometry";
import { checkpointFeatureId, checkpointsCollection, routeGradientExpression, routesCollection } from "@/lib/map-style";
import { checkpointPopupNode } from "./checkpoint-popup";
import { IDS, useMapHandle } from "./map-context";
import { otherFilter, selectedFilter } from "./setup-layers";

export interface Selection {
  id: string;
  /** Fit the map to the route after selecting (card click), or leave the view alone (map click). */
  fit: boolean;
}

interface RouteLayersProps {
  data: RoutesResponse | undefined;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
}

/**
 * Map padding that keeps routes clear of the controls and, from md up, of the
 * floating heatmap card (on phones that card sits under the map instead).
 */
export function fitPadding(container: HTMLElement) {
  const narrow = container.clientWidth < 640;
  return narrow
    ? { top: 48, bottom: 48, left: 28, right: 28 }
    : { top: 64, bottom: 270, left: 64, right: 72 };
}

const LABEL_AT: readonly number[] = [0.42, 0.55, 0.68];

/**
 * Drives the route and checkpoint layers. Data is uploaded once per response;
 * selection swaps filters and the gradient; hover is feature-state; popups
 * and markers are created imperatively and torn down with the data.
 */
export function RouteLayers({ data, selection, onSelect }: RouteLayersProps) {
  const handle = useMapHandle();
  const routesRef = useRef<readonly RouteOption[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const labelMarkers = useRef(new Map<string, Marker>());
  const popupRef = useRef<Popup | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  // 1. New response: upload data, place markers, fit everything.
  useEffect(() => {
    if (!handle) return;
    const { map, ml } = handle;
    const routes = data?.routes ?? [];
    routesRef.current = routes;
    (map.getSource(IDS.routesSource) as GeoJSONSource | undefined)?.setData(routesCollection(routes));
    (map.getSource(IDS.checkpointsSource) as GeoJSONSource | undefined)?.setData(checkpointsCollection(routes));

    const markers: Marker[] = [];
    const first = routes[0];
    if (first) {
      const coords = first.geometry.coordinates;
      const start = coords[0];
      const end = coords[coords.length - 1];
      const mk = (kind: "origin" | "destination", at: LonLat | undefined) => {
        if (!at) return;
        const node = document.createElement("div");
        node.setAttribute("aria-hidden", "true");
        node.className =
          kind === "origin"
            ? "size-4 rounded-full border-[3px] border-white bg-ink shadow-raised"
            : "size-4 rounded-tile border-[3px] border-white bg-accent shadow-raised";
        markers.push(new ml.Marker({ element: node }).setLngLat(at).addTo(map));
      };
      mk("origin", start);
      mk("destination", end);
    }

    labelMarkers.current.clear();
    routes.forEach((r, i) => {
      const node = document.createElement("button");
      node.type = "button";
      node.textContent = r.id;
      node.setAttribute("aria-label", `Show ${r.name} on the map`);
      node.className =
        "flex size-7 cursor-pointer items-center justify-center rounded-md font-mono text-xs font-semibold shadow-raised transition-[background-color,color] duration-(--duration-quick) focus-visible:shadow-focus focus-visible:outline-none";
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRef.current({ id: r.id, fit: false });
      });
      const at = pointAlong(r.geometry.coordinates, LABEL_AT[i % LABEL_AT.length] ?? 0.5);
      const m = new ml.Marker({ element: node }).setLngLat(at).addTo(map);
      labelMarkers.current.set(r.id, m);
      markers.push(m);
    });
    paintLabels(labelMarkers.current, selectedIdRef.current);

    const box = bboxOf(routes.map((r) => r.geometry.coordinates));
    if (box) {
      map.fitBounds(box as LngLatBoundsLike, { padding: fitPadding(map.getContainer()), duration: 700, maxZoom: 11 });
    }

    return () => {
      markers.forEach((m) => m.remove());
      popupRef.current?.remove();
      popupRef.current = null;
    };
  }, [handle, data]);

  // 2. Selection: filters, gradient, labels, optional fit.
  useEffect(() => {
    if (!handle) return;
    const { map } = handle;
    const id = selection?.id ?? "";
    selectedIdRef.current = id || null;
    const route = routesRef.current.find((r) => r.id === id);
    map.setFilter(IDS.selectedCasing, selectedFilter(id));
    map.setFilter(IDS.selectedLine, selectedFilter(id));
    map.setFilter(IDS.checkpointsHalo, selectedFilter(id));
    map.setFilter(IDS.checkpoints, selectedFilter(id));
    map.setFilter(IDS.checkpointsOther, otherFilter(id));
    if (route) map.setPaintProperty(IDS.selectedLine, "line-gradient", routeGradientExpression(route));
    paintLabels(labelMarkers.current, id);

    if (route && selection?.fit) {
      const box = bboxOf([route.geometry.coordinates]);
      if (box) map.fitBounds(box as LngLatBoundsLike, { padding: fitPadding(map.getContainer()), duration: 600, maxZoom: 11 });
    }
  }, [handle, selection, data]);

  // 3. Interactions: route hover / click, checkpoint hover / click, store sync, popups.
  useEffect(() => {
    if (!handle) return;
    const { map, ml } = handle;
    const canvas = map.getCanvas();
    let hoveredRoute: number | null = null;
    let hoveredCp: number | null = null;
    let suppressPopupClose = false;

    const routeIndex = (id: string) => routesRef.current.findIndex((r) => r.id === id);

    const onRouteMove = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const fid = typeof f?.id === "number" ? f.id : null;
      if (fid === hoveredRoute) return;
      if (hoveredRoute !== null) map.setFeatureState({ source: IDS.routesSource, id: hoveredRoute }, { hover: false });
      hoveredRoute = fid;
      if (fid !== null) map.setFeatureState({ source: IDS.routesSource, id: fid }, { hover: true });
      canvas.style.cursor = "pointer";
    };
    const onRouteLeave = () => {
      if (hoveredRoute !== null) map.setFeatureState({ source: IDS.routesSource, id: hoveredRoute }, { hover: false });
      hoveredRoute = null;
      canvas.style.cursor = "";
    };
    const onRouteClick = (e: MapLayerMouseEvent) => {
      // A checkpoint on top wins the click.
      if (map.queryRenderedFeatures(e.point, { layers: [IDS.checkpoints] }).length > 0) return;
      const id = e.features?.[0]?.properties?.route_id;
      if (typeof id === "string") onSelectRef.current({ id, fit: false });
    };

    const cpRef = (e: MapLayerMouseEvent) => {
      const p = e.features?.[0]?.properties;
      if (!p || typeof p.route_id !== "string") return null;
      return { routeId: p.route_id, idx: Number(p.idx) };
    };
    const onCpMove = (e: MapLayerMouseEvent) => {
      const ref = cpRef(e);
      checkpointStore.setHovered(ref);
      canvas.style.cursor = "pointer";
    };
    const onCpLeave = () => {
      checkpointStore.setHovered(null);
      canvas.style.cursor = "";
    };
    const onCpClick = (e: MapLayerMouseEvent) => {
      const ref = cpRef(e);
      if (ref) checkpointStore.setPicked(ref);
    };

    // Store -> map: hover feature-state and the picked checkpoint's popup.
    let lastPicked = checkpointStore.getPicked();
    const syncFromStore = () => {
      const h = checkpointStore.getHovered();
      const nextId = h ? checkpointFeatureId(routeIndex(h.routeId), h.idx) : null;
      if (nextId !== hoveredCp) {
        if (hoveredCp !== null) map.setFeatureState({ source: IDS.checkpointsSource, id: hoveredCp }, { hover: false });
        hoveredCp = h && routeIndex(h.routeId) >= 0 ? nextId : null;
        if (hoveredCp !== null) map.setFeatureState({ source: IDS.checkpointsSource, id: hoveredCp }, { hover: true });
      }

      const picked = checkpointStore.getPicked();
      if (picked === lastPicked) return;
      lastPicked = picked;
      suppressPopupClose = true;
      popupRef.current?.remove();
      suppressPopupClose = false;
      popupRef.current = null;
      if (!picked) return;
      const route = routesRef.current.find((r) => r.id === picked.routeId);
      const cp = route?.checkpoints.find((c) => c.idx === picked.idx);
      if (!route || !cp) return;
      const popup = new ml.Popup({ offset: 12, maxWidth: "min(280px, calc(100vw - 48px))", focusAfterOpen: false })
        .setLngLat([cp.lon, cp.lat])
        .setDOMContent(checkpointPopupNode(cp, route.name))
        .addTo(map);
      popup.on("close", () => {
        if (!suppressPopupClose && checkpointStore.getPicked() === picked) checkpointStore.setPicked(null);
      });
      popupRef.current = popup;
      // On a phone-width map the popup only fits when its checkpoint sits centred and low,
      // leaving the upper part of the map for the popup above it.
      const box = map.getContainer();
      const narrow = box.clientWidth < 520;
      if (narrow || !map.getBounds().contains([cp.lon, cp.lat])) {
        map.easeTo({
          center: [cp.lon, cp.lat],
          offset: narrow ? [0, Math.round(box.clientHeight * 0.3)] : [0, 0],
          duration: 500,
        });
      }
    };
    const unsubscribe = checkpointStore.subscribe(syncFromStore);

    map.on("mousemove", IDS.routesLine, onRouteMove);
    map.on("mouseleave", IDS.routesLine, onRouteLeave);
    map.on("click", IDS.routesLine, onRouteClick);
    map.on("mousemove", IDS.checkpoints, onCpMove);
    map.on("mouseleave", IDS.checkpoints, onCpLeave);
    map.on("click", IDS.checkpoints, onCpClick);

    return () => {
      unsubscribe();
      map.off("mousemove", IDS.routesLine, onRouteMove);
      map.off("mouseleave", IDS.routesLine, onRouteLeave);
      map.off("click", IDS.routesLine, onRouteClick);
      map.off("mousemove", IDS.checkpoints, onCpMove);
      map.off("mouseleave", IDS.checkpoints, onCpLeave);
      map.off("click", IDS.checkpoints, onCpClick);
    };
  }, [handle]);

  return null;
}

function paintLabels(markers: Map<string, Marker>, selectedId: string | null) {
  for (const [id, m] of markers) {
    const node = m.getElement();
    const on = id === selectedId;
    node.classList.toggle("bg-ink", on);
    node.classList.toggle("text-on-dark", on);
    node.classList.toggle("bg-surface", !on);
    node.classList.toggle("text-ink", !on);
    node.setAttribute("aria-pressed", String(on));
    m.getElement().style.zIndex = on ? "2" : "1";
  }
}
