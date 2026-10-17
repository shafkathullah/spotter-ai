import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Icon, type IconName } from "../icon";

type Tone = "warning" | "error" | "info";

const TONE: Record<Tone, { icon: IconName; text: string; chip: string }> = {
  warning: { icon: "warning", text: "text-warning", chip: "bg-warning/10" },
  error: { icon: "error", text: "text-error", chip: "bg-error/10" },
  info: { icon: "info", text: "text-accent", chip: "bg-accent-faint" },
};

/**
 * A note in the card shell with a tinted glyph chip (design system: privacy
 * and hint notes). The glyph and the words carry the state, not colour alone.
 */
export function Notice({
  tone,
  title,
  children,
  action,
  role,
  className,
}: {
  tone: Tone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  role?: "status" | "alert";
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div role={role} className={cn("flex gap-3 rounded-panel bg-surface p-4 shadow-resting", className)}>
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", t.chip, t.text)}>
        <Icon name={t.icon} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {children ? <div className="mt-1 text-[13px] leading-normal text-ink-secondary">{children}</div> : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}
