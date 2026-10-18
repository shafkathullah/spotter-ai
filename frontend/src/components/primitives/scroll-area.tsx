import * as React from "react";
import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area";
import { type VariantProps, cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Base UI ScrollArea, namespaced exports: a native scroll container with a
 * thin overlay scrollbar, for BOUNDED panels inside dialogs, popovers and
 * list popups (pocketwebtools DESIGN.md §6 → Scroll area). The page itself, textareas and
 * code editors keep native scrolling.
 *
 * Usage:
 *   import * as ScrollArea from "@/components/primitives/scroll-area";
 *
 *   <ScrollArea.Root className="max-h-80">
 *     <ScrollArea.Viewport fade="y">
 *       <ScrollArea.Content>…</ScrollArea.Content>
 *     </ScrollArea.Viewport>
 *     <ScrollArea.Scrollbar>
 *       <ScrollArea.Thumb />
 *     </ScrollArea.Scrollbar>
 *   </ScrollArea.Root>
 *
 * or `<ScrollArea.Default className="max-h-80" fade="y">…</ScrollArea.Default>`.
 *
 * Sizing: `Root` is a flex column, so a `max-h-*` (or a flex parent that
 * shrinks it, with `min-h-0`) bounds it and the `Viewport` fills it; content
 * shorter than the cap keeps its own height.
 *
 *  - Scrollbar (`size="default"`): 6px thumb in a 10px gutter overlaid on the right edge, hidden
 *    until the pointer is over the area (`data-hovering`) or it scrolls
 *    (`data-scrolling`, shown instantly). Touch shows it while scrolling.
 *  - `fade="y"`: the viewport's top / bottom edge fades over up to 24px, only
 *    on a side that has more content (`--scroll-area-overflow-y-*`), so the
 *    cut reads as "more here" without a hairline.
 *  - Focus: the viewport is a Tab stop only while it overflows (Base UI), so
 *    keyboard users can scroll it; its ring is drawn on the Root because the
 *    fade mask would clip one drawn on the viewport. Inside a listbox (Select,
 *    Combobox) pass `tabIndex={-1}`: arrow keys already move through the items.
 *
 * Horizontal strips (the text-based video editor's timeline): `Viewport
 * axis="x"` locks the vertical axis and contains overscroll on x only, so a
 * vertical swipe or wheel over the strip still scrolls the page (and a
 * trackpad fling at the end does not swipe the browser back). `Scrollbar
 * size="thin"` is a 12px strip whose 4px thumb grows to 8px while the pointer
 * is on the strip (under `hover: hover`); give the Root `pb-3` so the strip
 * sits in a gutter under the content instead of over it:
 *
 *   <ScrollArea.Root className="pb-3">
 *     <ScrollArea.Viewport axis="x">…</ScrollArea.Viewport>
 *     <ScrollArea.Scrollbar orientation="horizontal" size="thin">
 *       <ScrollArea.Thumb />
 *     </ScrollArea.Scrollbar>
 *   </ScrollArea.Root>
 */

const rootClass = cn(
  "relative flex min-h-0 flex-col",
  "has-[>[data-scroll-viewport]:focus-visible]:shadow-focus",
);

export const viewportVariants = cva("min-h-0 flex-1 rounded-[inherit] focus-visible:outline-none", {
  variants: {
    /**
     * `both`: scrolls either way, overscroll contained on both axes (panels).
     * `x`: a horizontal strip; Base UI's inline `overflow: scroll` is overridden
     * on y (hence `!`) and only x overscroll is contained, so vertical swipes
     * and wheels chain to the page.
     */
    axis: {
      both: "overscroll-contain",
      x: "overflow-y-hidden! overscroll-x-contain",
    },
    fade: {
      none: "",
      y: "[mask-image:linear-gradient(to_bottom,transparent_0,black_min(24px,var(--scroll-area-overflow-y-start,0px)),black_calc(100%-min(24px,var(--scroll-area-overflow-y-end,0px))),transparent_100%)]",
      x: "[mask-image:linear-gradient(to_right,transparent_0,black_min(24px,var(--scroll-area-overflow-x-start,0px)),black_calc(100%-min(24px,var(--scroll-area-overflow-x-end,0px))),transparent_100%)]",
    },
  },
  defaultVariants: {
    axis: "both",
    fade: "none",
  },
});

export const scrollbarVariants = cva(
  cn(
    "group/scrollbar pointer-events-none flex p-0.5 opacity-0",
    "transition-opacity duration-(--duration-quick) ease-out motion-reduce:transition-none",
    "data-hovering:pointer-events-auto data-hovering:opacity-100",
    "data-scrolling:pointer-events-auto data-scrolling:opacity-100 data-scrolling:duration-0",
    "data-[orientation=vertical]:justify-center",
    "data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:justify-center",
  ),
  {
    variants: {
      /**
       * `default`: a 6px thumb in a 10px gutter overlaid on the content's edge.
       * `thin`: a 12px strip, 4px thumb growing to 8px while the pointer is on
       * the strip (or dragging the thumb); meant to sit in its own gutter.
       */
      size: {
        default: "data-[orientation=horizontal]:h-2.5 data-[orientation=vertical]:w-2.5",
        thin: "data-[orientation=horizontal]:h-3 data-[orientation=vertical]:w-3",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

/**
 * The thumb's thickness follows its scrollbar's `size`. `thin` grows with
 * `scale` (its own property, so it composes with the `transform` Base UI
 * positions the thumb with) and only under `hover: hover` (Tailwind's
 * `group-hover`), so a touch scroll never thickens it.
 */
export const thumbVariants = cva(
  cn(
    "bg-ink-label/45 rounded-sm transition-[background-color] duration-(--duration-quick) ease-out hover:bg-ink-label/70",
    "motion-reduce:transition-none",
  ),
  {
    variants: {
      size: {
        default: "data-[orientation=vertical]:w-full data-[orientation=horizontal]:h-full",
        thin: cn(
          "transition-[background-color,scale]",
          "data-[orientation=horizontal]:h-2 data-[orientation=horizontal]:scale-y-50 data-[orientation=horizontal]:group-hover/scrollbar:scale-y-100",
          "data-[orientation=vertical]:w-2 data-[orientation=vertical]:scale-x-50 data-[orientation=vertical]:group-hover/scrollbar:scale-x-100",
          "group-hover/scrollbar:bg-ink-label/70",
        ),
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

type ScrollbarSize = NonNullable<VariantProps<typeof scrollbarVariants>["size"]>;
const ScrollbarSizeContext = React.createContext<ScrollbarSize>("default");

interface RootProps extends React.ComponentProps<typeof BaseScrollArea.Root> {
  className?: string;
}

export function Root({ className, ...props }: RootProps) {
  return <BaseScrollArea.Root className={cn(rootClass, className)} {...props} />;
}

interface ViewportProps
  extends
    React.ComponentProps<typeof BaseScrollArea.Viewport>,
    VariantProps<typeof viewportVariants> {
  className?: string;
}

export function Viewport({ className, axis, fade, ...props }: ViewportProps) {
  return (
    <BaseScrollArea.Viewport
      data-scroll-viewport=""
      className={cn(viewportVariants({ axis, fade }), className)}
      {...props}
    />
  );
}

export const Content = BaseScrollArea.Content;
export const Corner = BaseScrollArea.Corner;

interface ScrollbarProps
  extends
    React.ComponentProps<typeof BaseScrollArea.Scrollbar>,
    VariantProps<typeof scrollbarVariants> {
  className?: string;
}

export function Scrollbar({ className, size, ...props }: ScrollbarProps) {
  return (
    <ScrollbarSizeContext.Provider value={size ?? "default"}>
      <BaseScrollArea.Scrollbar className={cn(scrollbarVariants({ size }), className)} {...props} />
    </ScrollbarSizeContext.Provider>
  );
}

interface ThumbProps extends React.ComponentProps<typeof BaseScrollArea.Thumb> {
  className?: string;
}

export function Thumb({ className, ...props }: ThumbProps) {
  const size = React.useContext(ScrollbarSizeContext);
  return <BaseScrollArea.Thumb className={cn(thumbVariants({ size }), className)} {...props} />;
}

interface DefaultProps extends VariantProps<typeof viewportVariants> {
  children: React.ReactNode;
  /** Classes for the Root: the size cap (`max-h-*`, `flex-1`) goes here. */
  className?: string;
  /** Classes for the Viewport. */
  viewportClassName?: string;
  /** Classes for the Content (padding that keeps focus rings inside the clip goes here). */
  contentClassName?: string;
  /** Accessible name for the scroll region, when it is a Tab stop. */
  "aria-label"?: string;
}

/**
 * Convenience: Root + Viewport + Content + a vertical Scrollbar with its Thumb,
 * for the common vertical-only panel. Given an `aria-label`, the viewport
 * becomes a named `region` (it is a Tab stop while it overflows).
 */
export function Default({
  children,
  className,
  viewportClassName,
  contentClassName,
  fade,
  "aria-label": ariaLabel,
}: DefaultProps) {
  return (
    <Root className={className}>
      <Viewport
        fade={fade}
        className={viewportClassName}
        {...(ariaLabel ? { role: "region", "aria-label": ariaLabel } : {})}
      >
        {/* Base UI sizes Content to `min-width: fit-content` for horizontal scrolling; a
            vertical-only area must stay the viewport's width or `truncate` never truncates. */}
        <Content className={cn("min-w-0!", contentClassName)}>{children}</Content>
      </Viewport>
      <Scrollbar>
        <Thumb />
      </Scrollbar>
    </Root>
  );
}
