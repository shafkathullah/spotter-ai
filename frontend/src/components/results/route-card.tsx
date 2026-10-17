import { memo } from "react";

import type { RouteOption } from "@/api/types";
import { Icon } from "@/components/icon";
import { RiskBar } from "@/components/ui/risk-bar";
import { RiskChip } from "@/components/ui/risk-chip";
import { formatAvgRisk, formatDateTimeTz, formatDistance, formatDuration, formatMiles } from "@/lib/format";
import { cn } from "@/lib/utils";

interface RouteCardProps {
  route: RouteOption;
  selected: boolean;
  onSelect: (id: string) => void;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="label-mono text-ink-label">{label}</dt>
      <dd className="tabular text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

/**
 * One route option. The whole card is the button that shows it on the map.
 * Selected steps to the raised shadow and says so in words (design system:
 * a card's selected state changes its shadow and label, never its edge).
 */
export const RouteCard = memo(function RouteCard({ route, selected, onSelect }: RouteCardProps) {
  const s = route.summary;
  const m = s.miles_by_level;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(route.id)}
      className={cn(
        "group relative flex w-full flex-col gap-3 rounded-panel bg-surface p-4 text-left",
        "transition-[box-shadow] duration-(--duration-quick) ease-out focus-visible:shadow-focus focus-visible:outline-none",
        selected ? "shadow-raised" : "shadow-resting hover:shadow-raised",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-heading font-semibold text-ink">{route.name}</span>
            {route.recommended ? (
              <span className="inline-flex items-center gap-1 rounded-tile bg-accent-faint px-1.5 py-[3px] font-mono text-xs font-medium tracking-[0.04em] whitespace-nowrap text-accent uppercase">
                <Icon name="check_circle" size={14} />
                Recommended
              </span>
            ) : null}
          </div>
          {route.description ? (
            <p className="mt-0.5 text-[13px] text-ink-secondary wrap-anywhere">{route.description}</p>
          ) : null}
        </div>
        <span
          className={cn(
            "mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap",
            selected ? "font-medium text-ink" : "text-ink-label",
          )}
        >
          {selected ? <Icon name="show" size={14} /> : null}
          {selected ? "On the map" : "Show on map"}
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        <Stat label="Time" value={formatDuration(route.duration_s)} />
        <Stat label="Distance" value={formatDistance(route.distance_mi)} />
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="label-mono text-ink-label">Max risk</dt>
          <dd>
            <RiskChip level={s.max_level} />
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-1.5">
        <RiskBar miles={m} />
        <p className="tabular flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-secondary">
          {m.no_travel > 0 ? <span className="font-semibold text-ink">No Travel {formatMiles(m.no_travel)}</span> : null}
          <span>Severe {formatMiles(m.severe)}</span>
          <span>High {formatMiles(m.high)}</span>
          <span>Avg risk {formatAvgRisk(s.avg_risk)} / 4</span>
        </p>
      </div>

      <p className="tabular text-xs text-ink-label">Arrives {formatDateTimeTz(route.arrival)}</p>
    </button>
  );
});
