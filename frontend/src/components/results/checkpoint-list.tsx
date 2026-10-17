import { memo, useEffect, useRef } from "react";

import type { Checkpoint, RouteOption } from "@/api/types";
import { RiskChip, RiskSwatch } from "@/components/ui/risk-chip";
import { checkpointStore, useIsCheckpointHovered, useIsCheckpointPicked } from "@/lib/checkpoint-store";
import { formatDayTime, formatInHr, formatMph, timeZoneAbbr } from "@/lib/format";
import { cn } from "@/lib/utils";

interface RowProps {
  routeId: string;
  cp: Checkpoint;
  isLast: boolean;
}

/**
 * One checkpoint. Hover and focus highlight its marker on the map through the
 * checkpoint store (feature-state on the map side), and only this row and the
 * previously hovered one re-render. Clicking opens its popup on the map.
 */
const CheckpointRow = memo(function CheckpointRow({ routeId, cp, isLast }: RowProps) {
  const hovered = useIsCheckpointHovered(routeId, cp.idx);
  const picked = useIsCheckpointPicked(routeId, cp.idx);
  const ref = useRef<HTMLButtonElement>(null);

  // A checkpoint picked on the map scrolls into view in the list.
  useEffect(() => {
    if (picked) ref.current?.scrollIntoView({ block: "nearest" });
  }, [picked]);

  const w = cp.weather;
  const place = cp.idx === 0 ? "Start" : isLast ? "Destination" : `Mile ${Math.round(cp.distance_mi)}`;

  return (
    <li className="cv-row">
      <button
        ref={ref}
        type="button"
        onMouseEnter={() => checkpointStore.setHovered({ routeId, idx: cp.idx })}
        onMouseLeave={() => checkpointStore.setHovered(null)}
        onFocus={() => checkpointStore.setHovered({ routeId, idx: cp.idx })}
        onBlur={() => checkpointStore.setHovered(null)}
        onClick={() => {
          checkpointStore.setPicked({ routeId, idx: cp.idx });
          revealMap();
        }}
        aria-current={picked ? "true" : undefined}
        className={cn(
          "grid w-full grid-cols-[10px_1fr_auto] gap-x-3 gap-y-1 px-4 py-2.5 text-left",
          "focus-visible:shadow-focus focus-visible:outline-none",
          hovered || picked ? "bg-ground" : "bg-surface",
        )}
      >
        <RiskSwatch level={cp.level} className="mt-1" />
        <span className="tabular flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold text-ink">{place}</span>
          <span className="text-ink-secondary">ETA {formatDayTime(cp.eta)}</span>
        </span>
        <RiskChip level={cp.level} />
        <span className="tabular col-start-2 col-end-4 flex flex-wrap gap-x-3 text-xs text-ink-secondary">
          <span>
            Wind {formatMph(w.wind_mph)}
            <span className="text-ink-label">, gusts {formatMph(w.gust_mph)}</span>
          </span>
          {w.rain_in_hr > 0 ? <span>Rain {formatInHr(w.rain_in_hr)}</span> : null}
          {w.snow_in_hr > 0 ? <span>Snow {formatInHr(w.snow_in_hr)}</span> : null}
          {w.rain_in_hr <= 0 && w.snow_in_hr <= 0 ? <span>Dry</span> : null}
        </span>
        {cp.drivers.length > 0 ? (
          <span className="col-start-2 col-end-4 text-xs text-ink">{cp.drivers.join(" · ")}</span>
        ) : null}
      </button>
    </li>
  );
});

export function CheckpointList({ route, intervalMi }: { route: RouteOption; intervalMi: number }) {
  const cps = route.checkpoints;
  const firstEta = cps[0]?.eta;
  return (
    <section aria-labelledby="checkpoints-title" className="overflow-hidden rounded-panel bg-surface shadow-resting">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-hairline px-4 py-3">
        <h2 id="checkpoints-title" className="text-sm font-semibold text-ink">
          Checkpoints on {route.name}
        </h2>
        <span className="tabular text-xs text-ink-label">
          {cps.length} stops, every {intervalMi} mi{firstEta ? `, times in ${timeZoneAbbr(firstEta)}` : ""}
        </span>
      </header>
      <ol className="divide-y divide-hairline" onMouseLeave={() => checkpointStore.setHovered(null)}>
        {cps.map((cp, i) => (
          <CheckpointRow key={cp.idx} routeId={route.id} cp={cp} isLast={i === cps.length - 1} />
        ))}
      </ol>
    </section>
  );
}

/**
 * On phones the map sits above the panel, so a row tapped far down the list
 * would open its popup off screen. Bring the map back into view when it is
 * scrolled away; on desktop it is always visible and nothing moves.
 */
function revealMap() {
  const map = document.querySelector<HTMLElement>('[role="region"][aria-label="Map of route options"]');
  if (!map) return;
  const r = map.getBoundingClientRect();
  if (r.bottom < r.height * 0.5 || r.top > window.innerHeight) {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
  }
}
