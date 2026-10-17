import { useMemo } from "react";

import type { RoutesResponse } from "@/api/types";
import { ApiError } from "@/api/client";
import { Button } from "@/components/primitives/button";
import { Icon } from "@/components/icon";
import { Notice } from "@/components/ui/notice";
import { formatLoad } from "@/lib/format";
import { CheckpointList } from "./checkpoint-list";
import { RouteCard } from "./route-card";

interface ResultsPanelProps {
  data: RoutesResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ResultsPanel({ data, selectedId, onSelect }: ResultsPanelProps) {
  const ordered = useMemo(() => [...data.routes].sort((a, b) => a.rank - b.rank), [data.routes]);
  const recommended = data.routes.find((r) => r.id === data.recommended_route_id);
  const selected = data.routes.find((r) => r.id === selectedId) ?? recommended;

  return (
    <div className="flex flex-col gap-4">
      {data.no_safe_route ? (
        <Notice tone="error" title="No route is safe to drive at this departure" role="alert">
          Every option crosses No Travel conditions. The ranking below still shows the least bad choice. A later
          departure or a lighter load may clear it.
        </Notice>
      ) : null}

      {recommended ? (
        <section aria-labelledby="recommendation-title" className="rounded-panel bg-surface p-4 shadow-resting">
          <p className="label-mono text-accent">Recommendation</p>
          <h2 id="recommendation-title" className="mt-2 text-heading-lg leading-tight font-semibold">
            Take {recommended.name}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{data.explanation}</p>
          <p className="tabular mt-2 text-xs text-ink-label">
            Ranked by No Travel miles, then Severe miles, High miles, average risk and travel time. Load{" "}
            {formatLoad(data.load_lb)}.
          </p>
        </section>
      ) : null}

      {data.warnings.length > 0 ? (
        <Notice tone="warning" title={data.warnings.length === 1 ? "One thing to know" : "Things to know"} role="status">
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {data.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <section aria-label="Route options" className="flex flex-col gap-3">
        {ordered.map((r) => (
          <RouteCard key={r.id} route={r} selected={r.id === selected?.id} onSelect={onSelect} />
        ))}
      </section>

      {selected ? <CheckpointList route={selected} intervalMi={data.interval_mi} /> : null}
    </div>
  );
}

export function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="rounded-panel bg-surface p-4 shadow-resting">
        <div className="h-3 w-28 rounded-tile bg-action-secondary" />
        <div className="mt-3 h-5 w-40 rounded-tile bg-action-secondary" />
        <div className="mt-3 h-3 w-full rounded-tile bg-ground" />
        <div className="mt-2 h-3 w-4/5 rounded-tile bg-ground" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-3 rounded-panel bg-surface p-4 shadow-resting">
          <div className="h-4 w-24 rounded-tile bg-action-secondary" />
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((j) => (
              <div key={j} className="flex flex-col gap-1.5">
                <div className="h-2.5 w-12 rounded-tile bg-ground" />
                <div className="h-3.5 w-16 rounded-tile bg-action-secondary" />
              </div>
            ))}
          </div>
          <div className="h-2 w-full rounded-tile bg-ground" />
        </div>
      ))}
    </div>
  );
}

export function ResultsError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof ApiError ? error.message : "Something went wrong while planning the routes.";
  const upstream = error instanceof ApiError && error.status === 502;
  return (
    <Notice
      tone="error"
      role="alert"
      title={upstream ? "A routing or weather service did not answer" : "Routes could not be planned"}
      action={
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <Icon name="refresh" size={16} />
          Try again
        </Button>
      }
    >
      {message}
    </Notice>
  );
}

export function ResultsEmpty() {
  return (
    <div className="rounded-panel bg-surface p-4 shadow-resting">
      <p className="text-sm font-semibold text-ink">Three routes, ranked by the weather on the way</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">
        Enter a start, a destination, when you leave and how heavy the load is. Each route gets weather checks along
        the way, timed to when your truck reaches them, and the safest balance of risk and time comes first.
      </p>
    </div>
  );
}
