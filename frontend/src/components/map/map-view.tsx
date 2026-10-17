import { type ReactNode, useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

import { Spinner } from "@/components/spinner";
import { Notice } from "@/components/ui/notice";
import type { MapHandle } from "./map-context";
import { setupLayers } from "./setup-layers";

export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

interface MapViewProps {
  /** Called with the handle once the style and app layers are ready, and with null on teardown. */
  onReady: (handle: MapHandle | null) => void;
  children?: ReactNode;
  className?: string;
}

/**
 * The one map instance for the app's lifetime. Created once on mount (the
 * MapLibre module is loaded lazily so the form paints first), destroyed on
 * unmount; state changes never remount it. Children are the layer
 * overlays drawn over the map; layer controllers get the map through
 * MapContext, which the app provides from `onReady`.
 */
export function MapView({ onReady, children, className }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<MapHandle | null>(null);
  const [failed, setFailed] = useState(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    import("maplibre-gl")
      .then((ml) => {
        if (disposed) return;
        const map = new ml.Map({
          container,
          style: MAP_STYLE_URL,
          center: [-95.5, 38.5],
          zoom: 3.4,
          minZoom: 2,
          maxZoom: 16,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");

        const onLoad = () => {
          setupLayers(map);
          const h = { map, ml };
          setHandle(h);
          onReadyRef.current(h);
        };
        map.once("load", onLoad);

        // The container changes size without a window resize (mobile layout, panel).
        const ro = new ResizeObserver(() => map.resize());
        ro.observe(container);

        cleanup = () => {
          ro.disconnect();
          map.off("load", onLoad);
          map.remove();
        };
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      setHandle(null);
      onReadyRef.current(null);
      cleanup?.();
    };
  }, []);

  return (
    <div className={className}>
      {/* `.maplibregl-map` (unlayered CSS) forces position: relative, so size by height, not inset. */}
      <div ref={containerRef} className="h-full w-full" aria-label="Map of route options" role="region" />
      {!handle && !failed ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex items-center gap-2 rounded-md bg-surface px-3 py-2 text-[13px] text-ink-secondary shadow-resting">
            <Spinner size={14} /> Loading map…
          </span>
        </div>
      ) : null}
      {failed ? (
        <div className="absolute inset-x-4 top-4">
          <Notice tone="error" title="The map could not load" role="alert">
            Check your connection and reload the page. Route results still show in the panel.
          </Notice>
        </div>
      ) : null}
      {children}
    </div>
  );
}
