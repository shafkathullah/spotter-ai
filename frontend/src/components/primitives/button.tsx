import * as React from "react";
import { type VariantProps, cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Button (design system §6 → Buttons), copied from PocketWebTools. Inter 600,
 * 4px radius, verb-first sentence-case label.
 *
 *  - default    → `button-primary`: black fill, white label. The one action on a surface.
 *  - secondary  → `button-secondary`: cool grey fill, ink label.
 *  - outline    → `button-surface`: white + resting shadow, no border. The quiet action.
 *  - icon size  → square; always pass an `aria-label`.
 *
 * Press scales to 0.97, focus is the `--shadow-focus` ring on `:focus-visible`
 * only, only named properties transition. A leading or trailing glyph pulls its
 * side in by 2px. On a coarse pointer `touch-hit` grows the target to 44x44.
 */
const buttonVariants = cva(
  cn(
    "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap",
    "touch-hit",
    "[&>[data-icon]:first-child]:-ml-0.5 [&>[data-icon]:last-child]:-mr-0.5",
    "transition-[color,background-color,box-shadow,scale] duration-(--duration-press) ease-out motion-reduce:transition-none",
    "active:scale-[0.97]",
    "focus-visible:shadow-focus focus-visible:outline-none",
    "disabled:pointer-events-none disabled:opacity-50",
  ),
  {
    variants: {
      variant: {
        default: "bg-action text-on-action hover:bg-action-hover",
        secondary: "bg-action-secondary text-ink hover:bg-action-secondary-hover",
        outline: "bg-surface text-ink shadow-resting hover:shadow-raised",
      },
      size: {
        default: "h-9 px-3.5 text-sm",
        sm: "h-8 px-3 text-sm",
        xs: "h-7 gap-1.5 px-2.5 text-[13px]",
        lg: "h-[46px] px-5 text-[15px]",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
});

export { buttonVariants };
