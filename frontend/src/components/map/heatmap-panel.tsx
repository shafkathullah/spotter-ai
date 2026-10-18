import { useEffect, useId, useState } from "react";

import type { HeatmapResponse, RouteOption } from "@/api/types";
import { ApiError } from "@/api/client";
import { Button } from "@/components/primitives/button";
import * as Slider from "@/components/primitives/slider";
import * as ToggleGroup from "@/components/primitives/toggle-group";
import { Icon } from "@/components/icon";
import { Spinner } from "@/components/spinner";
import { RiskLegend } from "@/components/ui/legend";
import { formatDayTime, formatHourOffset, timeZoneAbbr } from "@/lib/format";
import { HEAT_HOURS, HEAT_METRICS } from "@/lib/heatmap";
import { type HeatMetric, THRESHOLDS } from "@/lib/risk";
import { hoursBetween, toIsoWithOffset } from "@/lib/time";
import { HeatLayer } from "./heat-layer";
import { TravelWindow } from "./travel-window";
import { TruckMarker } from "./truck-marker";

const MAX_HOUR = HEAT_HOURS - 1;
/** Playback speed: about 4 forecast hours per second. */
const PLAY_MS = 250;

const METRIC_NOTE: Record<HeatMetric, string> = {
  risk: "Worst of wind, rain and snow per hour, with your load applied to wind.",
  wind: `Sustained wind. Bands at ${THRESHOLDS.wind.moderate} / ${THRESHOLDS.wind.high} / ${THRESHOLDS.wind.severe} / ${THRESHOLDS.wind.noTravel} mph, no load rule.`,
  precip: "Rain and showers. Bands at 0.10 / 0.25 / 0.50 / over 1.00 in/hr.",
  snow: "Snowfall. Bands at 0.5 / 1.0 / 2.0 / over 3.0 in/hr.",
};

interface HeatmapPanelProps {
  data: HeatmapResponse | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  route: RouteOption | undefined;
  departure: string | undefined;
  /** A re-plan for a moved departure is in flight. */
  replanning: boolean;
  /** Re-plan the trip with this departure (ISO with offset). */
  onDepartureChange: (iso: string) => void;
}

/**
 * Floating card over the map: metric switch, visibility, the 0-48 h slider
 * with play / pause, the selected route's on-the-road window under the track,
 * and the risk legend. Hour state lives here, so a slider step re-renders
 * only this card; the map work is in <HeatLayer>.
 */
export function HeatmapPanel({
  data,
  loading,
  error,
  onRetry,
  route,
  departure,
  replanning,
  onDepartureChange,
}: HeatmapPanelProps) {
  const titleId = useId();
  const [hour, setHour] = useState(0);
  const [metric, setMetric] = useState<HeatMetric>("risk");
  const [visible, setVisible] = useState(true);
  const [playing, setPlaying] = useState(false);

  // A new grid starts at departure, paused.
  useEffect(() => {
    setHour(0);
    setPlaying(false);
  }, [data]);

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => setHour((h) => Math.min(MAX_HOUR, h + 1)), PLAY_MS);
    return () => window.clearInterval(t);
  }, [playing]);

  // Playback stops on the last hour.
  useEffect(() => {
    if (playing && hour >= MAX_HOUR) setPlaying(false);
  }, [playing, hour]);

  const hourIso = data?.hours[hour];
  const tz = hourIso ? timeZoneAbbr(hourIso) : "";

  // The selected route's departure to arrival, in slider hours.
  const windowStart = data && departure ? hoursBetween(data.start, departure) : null;
  const windowEnd = data && route ? hoursBetween(data.start, route.arrival) : null;

  return (
    <>
      <HeatLayer data={data} hour={hour} metric={metric} visible={visible} />
      {/* The dot follows the slider, which is disabled while the heatmap is hidden. */}
      <TruckMarker route={route} atIso={visible ? hourIso : undefined} />
      <section
        aria-labelledby={titleId}
        className="pointer-events-auto flex flex-col gap-3 rounded-panel bg-surface p-3 shadow-raised sm:p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 id={titleId} className="label-mono text-ink-label">
            Corridor forecast
          </h2>
          <div className="flex items-center gap-2">
            <ToggleGroup.Root<HeatMetric> aria-label="Heatmap metric" value={metric} onValueChange={setMetric}>
              {HEAT_METRICS.map((m) => (
                <ToggleGroup.Item key={m.value} value={m.value} size="sm" disabled={!visible}>
                  {m.label}
                </ToggleGroup.Item>
              ))}
            </ToggleGroup.Root>
            <Button
              variant="outline"
              size="icon-sm"
              aria-pressed={!visible}
              aria-label={visible ? "Hide heatmap" : "Show heatmap"}
              title={visible ? "Hide heatmap" : "Show heatmap"}
              onClick={() => {
                // Hiding also disables Play/Pause, so stop playback rather than leave it running.
                if (visible) setPlaying(false);
                setVisible(!visible);
              }}
            >
              <Icon name={visible ? "hide" : "show"} size={16} />
            </Button>
          </div>
        </div>

        {loading ? (
          <p role="status" className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <Spinner size={14} /> Loading the forecast grid along your routes…
          </p>
        ) : error ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-error">
            <span className="flex items-center gap-1.5">
              <Icon name="error" size={16} />
              {error instanceof ApiError ? error.message : "The heatmap could not load."}
            </span>
            <Button size="xs" variant="secondary" onClick={onRetry}>
              <Icon name="refresh" size={14} />
              Try again
            </Button>
          </div>
        ) : data ? (
          <div className="flex items-center gap-3">
            <Button
              size="icon-sm"
              aria-label={playing ? "Pause forecast" : "Play forecast"}
              onClick={() => {
                if (!playing && hour >= MAX_HOUR) setHour(0);
                setPlaying((p) => !p);
              }}
              disabled={!visible}
            >
              <Icon name={playing ? "pause" : "play"} size={16} className={playing ? "" : "translate-x-px"} />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <span className="tabular font-semibold whitespace-nowrap text-ink" aria-live="off">
                  {formatHourOffset(hour)}
                  {hourIso ? <span className="font-normal text-ink-secondary"> · {formatDayTime(hourIso)} {tz}</span> : null}
                </span>
                <span className="tabular whitespace-nowrap text-ink-label">0–48 h</span>
              </div>
              <Slider.Root
                value={hour}
                min={0}
                max={MAX_HOUR}
                step={1}
                onValueChange={(v) => {
                  setPlaying(false);
                  setHour(Array.isArray(v) ? (v[0] ?? 0) : (v as number));
                }}
                disabled={!visible}
              >
                <Slider.Control>
                  <Slider.Track>
                    <Slider.Indicator />
                  </Slider.Track>
                  <Slider.Thumb
                    // Base UI puts the accessible name on the thumb's range input, not the root.
                    aria-label="Forecast hour"
                    getAriaValueText={(_formatted: string, v: number) => {
                      const iso = data.hours[v];
                      return iso ? `${formatHourOffset(v)}, ${formatDayTime(iso)}` : formatHourOffset(v);
                    }}
                  />
                </Slider.Control>
              </Slider.Root>
              {windowStart !== null && windowEnd !== null && windowEnd > windowStart && route ? (
                <TravelWindow
                  start={windowStart}
                  end={windowEnd}
                  maxHour={MAX_HOUR}
                  gridStart={data.start}
                  routeName={route.name}
                  pending={replanning}
                  onPreview={(h) => {
                    if (h === null) return;
                    setPlaying(false);
                    setHour(Math.min(MAX_HOUR, Math.max(0, Math.round(h))));
                  }}
                  onCommit={(h) => onDepartureChange(toIsoWithOffset(new Date(Date.parse(data.start) + h * 3_600_000)))}
                />
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <RiskLegend />
          <p className="text-xs text-ink-label">{METRIC_NOTE[metric]}</p>
        </div>
      </section>
    </>
  );
}
