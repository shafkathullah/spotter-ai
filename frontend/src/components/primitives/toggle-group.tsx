import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Segmented control (design system §6 → `toggle-group`), copied from
 * PocketWebTools: ground track, 4px radius, 4px padding; items Inter 500 14px,
 * unselected ink at 80% (the one sanctioned opacity exception), selected ink
 * on a raised white item with the resting shadow. The original slides a
 * shared-layout bubble with `motion`; this copy paints the pressed item
 * directly to keep the bundle small.
 *
 * Single select: pressing the selected item keeps it selected, so
 * `onValueChange` never receives an empty value.
 */
export const rootVariants = cva("inline-flex items-center gap-1 rounded-md bg-ground p-1 pointer-coarse:gap-y-3");

export const itemVariants = cva(
  cn(
    "relative inline-flex items-center justify-center gap-1.5 rounded-sm font-medium",
    "text-ink/80 hover:text-ink data-pressed:text-ink",
    "data-pressed:bg-surface-raised data-pressed:shadow-resting",
    "transition-[color,background-color,box-shadow] duration-(--duration-quick) ease-out motion-reduce:transition-none",
    "focus-visible:shadow-focus focus-visible:outline-none",
    "disabled:pointer-events-none disabled:opacity-50",
    "[-webkit-tap-highlight-color:transparent]",
    "touch-hit-y",
  ),
  {
    variants: {
      size: {
        sm: "h-7 px-2.5 text-xs",
        default: "h-8 px-3 text-sm",
        lg: "h-9 px-3.5 text-sm",
      },
    },
    defaultVariants: { size: "default" },
  },
);

interface RootProps<Value extends string>
  extends Omit<React.ComponentProps<typeof BaseToggleGroup<Value>>, "value" | "defaultValue" | "onValueChange" | "multiple"> {
  value: Value;
  onValueChange: (value: Value) => void;
  className?: string;
}

export function Root<Value extends string>({ value, onValueChange, className, ...props }: RootProps<Value>) {
  return (
    <BaseToggleGroup<Value>
      value={[value]}
      onValueChange={(next, details) => {
        const v = next[0];
        if (v === undefined) {
          details.cancel();
          return;
        }
        onValueChange(v);
      }}
      className={cn(rootVariants(), className)}
      {...props}
    />
  );
}

interface ItemProps<Value extends string>
  extends React.ComponentProps<typeof BaseToggle<Value>>, VariantProps<typeof itemVariants> {}

export function Item<Value extends string>({ className, size, ...props }: ItemProps<Value>) {
  return <BaseToggle<Value> className={cn(itemVariants({ size }), className)} {...props} />;
}
