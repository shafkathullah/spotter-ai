import { useEffect, useRef, useState } from "react";

import { formatDayTime, formatHourOffset } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Keyboard moves commit after this pause, so holding an arrow key re-plans once. */
const KEY_COMMIT_MS = 600;

interface TravelWindowProps {
  /** Slider hours (from the grid's start) of the selected route's departure and arrival. */
  start: number;
  end: number;
  maxHour: number;
  /** The grid's hour 0, as ISO. */
  gridStart: string;
  routeName: string;
  /** A re-plan for a moved departure is in flight. */
  pending: boolean;
  /** The window's start hour while it is being moved, null when the move ends. */
  onPreview: (startHour: number | null) => void;
  /** Re-plan with the departure at this slider hour (same minutes past the hour as now). */
  onCommit: (startHour: number) => void;
}

/**
 * The selected route's on-the-road window under the forecast slider. Drag it
 * (or focus it and use the arrow keys) to try a later or earlier departure:
 * the heatmap follows while it moves and the trip is re-planned on release.
 * Moves are whole hours, so the departure keeps its minutes past the hour.
 */
export function TravelWindow({
  start,
  end,
  maxHour,
  gridStart,
  routeName,
  pending,
  onPreview,
  onCommit,
}: TravelWindowProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const keyTimer = useRef<number | undefined>(undefined);
  const [delta, setDelta] = useState(0);
  // Pointer events can outrun renders, so release and key commits read the latest offset here.
  const deltaRef = useRef(0);
  const [moving, setMoving] = useState(false);

  // The re-planned answer moves `start`; the offset was relative to the old one.
  useEffect(() => {
    deltaRef.current = 0;
    setDelta(0);
  }, [start]);
  useEffect(() => () => window.clearTimeout(keyTimer.current), []);

  const duration = end - start;
  // Not before the grid's hour 0; the departure stays inside the 48 h grid.
  const minDelta = -Math.floor(start + 1e-9);
  const maxDelta = Math.max(0, Math.floor(maxHour - 1 - start));
  const clamp = (d: number) => Math.min(maxDelta, Math.max(minDelta, d));

  const s = start + delta;
  const e = Math.min(maxHour, s + duration);
  const pct = (h: number) => `${(Math.max(0, h) / maxHour) * 100}%`;
  const departIso = new Date(new Date(gridStart).getTime() + s * 3_600_000).toISOString();
  const offset = Math.round(s);
  const valueText = `Depart ${formatDayTime(departIso)}, ${formatHourOffset(offset)}`;

  function move(d: number) {
    const next = clamp(d);
    deltaRef.current = next;
    setDelta(next);
    onPreview(start + next);
    return next;
  }

  function onPointerDown(ev: React.PointerEvent<HTMLDivElement>) {
    if (ev.button !== 0 || !trackRef.current) return;
    ev.preventDefault();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    ev.currentTarget.focus();
    const width = trackRef.current.clientWidth;
    drag.current = { x: ev.clientX - (deltaRef.current / maxHour) * width, width };
    setMoving(true);
    onPreview(s);
  }

  function onPointerMove(ev: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const d = clamp(Math.round(((ev.clientX - drag.current.x) / drag.current.width) * maxHour));
    if (d !== deltaRef.current) move(d);
  }

  function endDrag() {
    if (!drag.current) return;
    drag.current = null;
    setMoving(false);
    onPreview(null);
    if (deltaRef.current !== 0) onCommit(start + deltaRef.current);
  }

  function onKeyDown(ev: React.KeyboardEvent<HTMLDivElement>) {
    const step = ev.shiftKey ? 6 : 1;
    let next: number | null = null;
    if (ev.key === "ArrowRight" || ev.key === "ArrowUp") next = deltaRef.current + step;
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") next = deltaRef.current - step;
    else if (ev.key === "Home") next = minDelta;
    else if (ev.key === "End") next = maxDelta;
    if (next === null) return;
    ev.preventDefault();
    const d = move(next);
    window.clearTimeout(keyTimer.current);
    keyTimer.current = window.setTimeout(() => {
      onPreview(null);
      if (d !== 0) onCommit(start + d);
    }, KEY_COMMIT_MS);
  }

  const label = moving
    ? `Depart ${formatDayTime(departIso)} · ${formatHourOffset(offset)}`
    : pending
      ? `Re-planning for ${formatDayTime(departIso)}…`
      : `${routeName} on the road${start + duration > maxHour ? ", arrives after 48 h" : ""} · drag to change departure`;

  return (
    <div ref={trackRef} className="relative mt-1 h-7">
      <div
        role="slider"
        tabIndex={0}
        aria-label={`${routeName} departure`}
        aria-valuemin={Math.round(start + minDelta)}
        aria-valuemax={Math.round(start + maxDelta)}
        aria-valuenow={offset}
        aria-valuetext={valueText}
        aria-busy={pending || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!drag.current) onPreview(null);
        }}
        className={cn(
          "group absolute top-0 flex h-3 min-w-3 cursor-grab touch-none items-center rounded-tile outline-none",
          "focus-visible:shadow-focus",
          moving && "cursor-grabbing",
        )}
        style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)})` }}
      >
        <span
          className={cn(
            "h-1 w-full rounded-tile bg-ink-nav/50 transition-[height,background-color] duration-(--duration-quick) motion-reduce:transition-none",
            "group-hover:h-1.5 group-hover:bg-ink-nav/70",
            (moving || pending) && "h-1.5 bg-accent",
          )}
        />
      </div>
      <span
        className="pointer-events-none absolute top-3.5 text-xs whitespace-nowrap text-ink-label"
        // Past the middle the label hangs from the window's end, so it never runs off the card.
        style={s / maxHour > 0.5 ? { right: `calc(100% - ${pct(e)})` } : { left: pct(s) }}
        aria-hidden
      >
        {label}
      </span>
    </div>
  );
}
