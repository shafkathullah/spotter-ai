import * as React from "react";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { type VariantProps, cva } from "class-variance-authority";

import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

/**
 * Base UI Menu — namespaced re-exports + Tailwind/CVA defaults.
 *
 * A menu is a list of actions (Export as MP4, Copy link), not a value picker
 * (that is `select.tsx`). Base UI owns the roles, arrow-key roving, typeahead
 * and focus return.
 *
 * Copied from PocketWebTools (DESIGN.md §3 / §6): the popup is the popover surface (white, `shadow-raised`,
 * 8px, no border) with `p-1`, so its 4px rows sit concentric inside it. Rows are
 * rows, not buttons: `bg-highlight` when highlighted, 44px tall on touch.
 * Menus are opened often, so by default the popup skips its entrance and only
 * animates the close (0.98, fade, 4px blur, from the trigger). `motion="default"`
 * restores the 0.95 scale-in for a menu opened rarely. All motion sits behind
 * `motion-safe:`.
 *
 * Usage:
 *   import * as Menu from "@/components/primitives/menu";
 *
 *   <Menu.Root>
 *     <Menu.Trigger render={<Button size="sm" />}>
 *       Export <Icon name="expand_more" size={16} />
 *     </Menu.Trigger>
 *     <Menu.Default align="end">
 *       <Menu.Group>
 *         <Menu.GroupLabel>Video</Menu.GroupLabel>
 *         <Menu.Item onClick={...}>MP4</Menu.Item>
 *       </Menu.Group>
 *       <Menu.Separator />
 *       <Menu.CheckboxItem checked={x} onCheckedChange={setX}>Burn in captions</Menu.CheckboxItem>
 *     </Menu.Default>
 *   </Menu.Root>
 */

export const popupVariants = cva(
  cn(
    "flex origin-[var(--transform-origin)] flex-col rounded-panel p-1",
    // Never wider or taller than the space Base UI measured inside the collision padding.
    "max-w-(--available-width) max-h-(--available-height) overflow-y-auto",
    "bg-surface text-ink shadow-raised outline-none",
    "motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0",
    "motion-safe:data-closed:zoom-out-98 motion-safe:data-closed:blur-out-4",
    "data-closed:duration-(--duration-quick) data-closed:ease-in",
  ),
  {
    variants: {
      size: {
        default: "min-w-[10rem]",
        wide: "min-w-[14rem]",
      },
      motion: {
        "close-only": "",
        default: cn(
          "motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0",
          "motion-safe:data-open:zoom-in-95",
          "data-open:duration-(--duration-fast) data-open:ease-(--ease-smooth-out)",
        ),
      },
    },
    defaultVariants: {
      size: "default",
      motion: "close-only",
    },
  },
);

export const itemVariants = cva(
  cn(
    "relative flex cursor-default items-center gap-2 rounded-md text-sm text-ink select-none",
    "outline-none",
    // Base UI sets `data-highlighted` on pointer hover and on keyboard focus alike.
    "data-highlighted:bg-highlight",
    "data-disabled:pointer-events-none data-disabled:opacity-50",
    // 44px rows on touch (DESIGN.md §3 Hit areas); the painted row is the hit area.
    "pointer-coarse:min-h-11",
  ),
  {
    variants: {
      inset: {
        // Room for a leading glyph or check column, so labels line up in mixed menus.
        false: "px-2.5 py-1.5",
        true: "py-1.5 pr-2.5 pl-8",
      },
      tone: {
        default: "",
        destructive: "text-error",
      },
    },
    defaultVariants: {
      inset: false,
      tone: "default",
    },
  },
);

const indicatorClass =
  "text-accent absolute left-2.5 inline-flex size-4 items-center justify-center data-unchecked:invisible";

export const Root = BaseMenu.Root;
export const Trigger = BaseMenu.Trigger;
export const Portal = BaseMenu.Portal;
export const Positioner = BaseMenu.Positioner;
export const Backdrop = BaseMenu.Backdrop;
export const Arrow = BaseMenu.Arrow;
export const Viewport = BaseMenu.Viewport;
export const Group = BaseMenu.Group;
export const RadioGroup = BaseMenu.RadioGroup;
export const SubmenuRoot = BaseMenu.SubmenuRoot;
/** Connects one `Root` to triggers rendered elsewhere. */
export const createHandle = BaseMenu.createHandle;
export type Handle<Payload> = BaseMenu.Handle<Payload>;

type PositionerProps = React.ComponentProps<typeof BaseMenu.Positioner>;

interface PopupProps
  extends React.ComponentProps<typeof BaseMenu.Popup>, VariantProps<typeof popupVariants> {}

export function Popup({ className, size, motion, ...props }: PopupProps) {
  return <BaseMenu.Popup className={cn(popupVariants({ size, motion }), className)} {...props} />;
}

interface ItemProps
  extends React.ComponentProps<typeof BaseMenu.Item>, VariantProps<typeof itemVariants> {}

export function Item({ className, inset, tone, ...props }: ItemProps) {
  return <BaseMenu.Item className={cn(itemVariants({ inset, tone }), className)} {...props} />;
}

interface LinkItemProps
  extends React.ComponentProps<typeof BaseMenu.LinkItem>, VariantProps<typeof itemVariants> {}

export function LinkItem({ className, inset, tone, ...props }: LinkItemProps) {
  return <BaseMenu.LinkItem className={cn(itemVariants({ inset, tone }), className)} {...props} />;
}

interface SubmenuTriggerProps
  extends React.ComponentProps<typeof BaseMenu.SubmenuTrigger>, VariantProps<typeof itemVariants> {}

export function SubmenuTrigger({
  className,
  inset,
  tone,
  children,
  ...props
}: SubmenuTriggerProps) {
  return (
    <BaseMenu.SubmenuTrigger
      className={cn(itemVariants({ inset, tone }), "data-popup-open:bg-highlight", className)}
      {...props}
    >
      {children}
      <Icon name="expand_more" size={16} className="text-ink-secondary ml-auto -rotate-90" />
    </BaseMenu.SubmenuTrigger>
  );
}

interface CheckboxItemProps extends React.ComponentProps<typeof BaseMenu.CheckboxItem> {}

/** A toggle row; the check column is reserved even when unchecked, so labels never shift. */
export function CheckboxItem({ className, children, ...props }: CheckboxItemProps) {
  return (
    <BaseMenu.CheckboxItem className={cn(itemVariants({ inset: true }), className)} {...props}>
      <BaseMenu.CheckboxItemIndicator keepMounted className={indicatorClass}>
        <Icon name="check" size={16} />
      </BaseMenu.CheckboxItemIndicator>
      {children}
    </BaseMenu.CheckboxItem>
  );
}

interface RadioItemProps extends React.ComponentProps<typeof BaseMenu.RadioItem> {}

/** One row of a `RadioGroup`; the check column is reserved, as on `CheckboxItem`. */
export function RadioItem({ className, children, ...props }: RadioItemProps) {
  return (
    <BaseMenu.RadioItem className={cn(itemVariants({ inset: true }), className)} {...props}>
      <BaseMenu.RadioItemIndicator keepMounted className={indicatorClass}>
        <Icon name="check" size={16} />
      </BaseMenu.RadioItemIndicator>
      {children}
    </BaseMenu.RadioItem>
  );
}

interface GroupLabelProps extends React.ComponentProps<typeof BaseMenu.GroupLabel> {}

export function GroupLabel({ className, ...props }: GroupLabelProps) {
  return (
    <BaseMenu.GroupLabel
      className={cn("label-mono text-ink-label px-2.5 pt-2 pb-1", className)}
      {...props}
    />
  );
}

interface SeparatorProps extends React.ComponentProps<typeof BaseMenu.Separator> {}

/** A hairline divider between groups; runs to the popup's padding edge. */
export function Separator({ className, ...props }: SeparatorProps) {
  return <BaseMenu.Separator className={cn("bg-hairline -mx-1 my-1 h-px", className)} {...props} />;
}

interface DefaultProps
  extends React.ComponentProps<typeof BaseMenu.Popup>, VariantProps<typeof popupVariants> {
  /** Gap between trigger and popup. Defaults to 6px. */
  sideOffset?: PositionerProps["sideOffset"];
  alignOffset?: PositionerProps["alignOffset"];
  /** Space kept from the viewport edge. Defaults to 16px, the phone side gutter (DESIGN.md). */
  collisionPadding?: PositionerProps["collisionPadding"];
  align?: PositionerProps["align"];
  side?: PositionerProps["side"];
  /** Position against this instead of the trigger. */
  anchor?: PositionerProps["anchor"];
}

/** Portal + Positioner (z-50) + Popup: the shape almost every menu wants. */
export function Default({
  className,
  size,
  motion,
  sideOffset = 6,
  alignOffset,
  collisionPadding = 16,
  align,
  side,
  anchor,
  children,
  ...props
}: DefaultProps) {
  return (
    <BaseMenu.Portal>
      {/* z-50 on the Positioner, not the Popup: the Positioner is the stacking context. */}
      <BaseMenu.Positioner
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        align={align}
        side={side}
        anchor={anchor}
        className="z-50"
      >
        <Popup size={size} motion={motion} className={className} {...props}>
          {children}
        </Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}
