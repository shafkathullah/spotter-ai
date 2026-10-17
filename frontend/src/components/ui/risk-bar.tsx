import type { MilesByLevel } from "@/api/types";
import { formatMiles } from "@/lib/format";
import { MILES_KEYS, RISK } from "@/lib/risk";

/**
 * Stacked horizontal bar of miles per risk level, left to right Low to No
 * Travel. The accessible name spells out every non-zero band.
 */
export function RiskBar({ miles, className }: { miles: MilesByLevel; className?: string }) {
  const total = MILES_KEYS.reduce((s, k) => s + miles[k], 0);
  const label = RISK.filter((r) => miles[r.key] > 0)
    .map((r) => `${r.label} ${formatMiles(miles[r.key])}`)
    .join(", ");
  return (
    <div
      role="img"
      aria-label={total > 0 ? `Miles by risk: ${label}` : "No miles"}
      className={`flex h-2 w-full gap-px overflow-hidden rounded-tile bg-action-secondary ${className ?? ""}`}
    >
      {total > 0 &&
        RISK.map((r) => {
          const v = miles[r.key];
          if (v <= 0) return null;
          return <span key={r.key} className="h-full" style={{ flexGrow: v, flexBasis: 0, minWidth: 2, backgroundColor: r.fill }} />;
        })}
    </div>
  );
}
