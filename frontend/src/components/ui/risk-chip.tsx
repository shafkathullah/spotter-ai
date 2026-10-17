import type { CSSProperties } from "react";

import { riskMeta, withAlpha } from "@/lib/risk";
import { cn } from "@/lib/utils";

/**
 * A risk level as a chip: mono uppercase label on the level's 14% tint, a
 * filled square swatch before it. Colour plus label, never colour alone.
 */
export function RiskChip({ level, className, size = "sm" }: { level: number; className?: string; size?: "sm" | "default" }) {
  const m = riskMeta(level);
  const style: CSSProperties = { backgroundColor: withAlpha(m.fill, 0.14), color: m.ink };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-tile font-mono font-medium whitespace-nowrap uppercase",
        size === "sm" ? "px-1.5 py-[3px] text-xs tracking-[0.04em]" : "px-2 py-[5px] text-xs tracking-[0.06em]",
        className,
      )}
      style={style}
    >
      <span aria-hidden className="size-2 rounded-[1px]" style={{ backgroundColor: m.fill }} />
      {m.label}
    </span>
  );
}

export function RiskSwatch({ level, className }: { level: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-[1px]", className)}
      style={{ backgroundColor: riskMeta(level).fill }}
    />
  );
}
