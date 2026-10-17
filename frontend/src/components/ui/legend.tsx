import { RISK } from "@/lib/risk";
import { RiskSwatch } from "./risk-chip";

export function RiskLegend({ className }: { className?: string }) {
  return (
    <ul aria-label="Risk levels" className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${className ?? ""}`}>
      {RISK.map((r) => (
        <li key={r.key} className="flex items-center gap-1.5 text-xs whitespace-nowrap text-ink-secondary">
          <RiskSwatch level={r.level} />
          {r.label}
        </li>
      ))}
    </ul>
  );
}
