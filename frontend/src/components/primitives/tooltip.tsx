import * as React from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";

import { cn } from "@/lib/utils";

/**
 * Base UI Tooltip (design system §6 → `tooltip`), copied from PocketWebTools:
 * a dark `--color-band` slab with white Inter 13px, 4px radius, raised shadow,
 * no arrow; fades and scales from 0.95 at the trigger origin. It names a
 * control that has no visible label; the trigger keeps its own `aria-label`.
 */
export const Provider = BaseTooltip.Provider;
export const Root = BaseTooltip.Root;
export const Trigger = BaseTooltip.Trigger;

interface DefaultProps extends React.ComponentProps<typeof BaseTooltip.Popup> {
  sideOffset?: number;
  side?: React.ComponentProps<typeof BaseTooltip.Positioner>["side"];
}

export const Default = React.forwardRef<HTMLDivElement, DefaultProps>(function TooltipDefault(
  { className, sideOffset = 8, side, children, ...props },
  ref,
) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner sideOffset={sideOffset} side={side} className="z-50">
        <BaseTooltip.Popup
          ref={ref}
          className={cn(
            "z-50 origin-[var(--transform-origin)] rounded-md bg-band px-2.5 py-1.5 text-[13px] text-on-dark shadow-raised select-none",
            "motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0 motion-safe:data-open:zoom-in-95",
            "motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0 motion-safe:data-closed:zoom-out-95",
            "data-instant:animate-none",
            className,
          )}
          {...props}
        >
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  );
});
