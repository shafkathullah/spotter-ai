import * as React from "react";
import { Combobox as BaseCombobox } from "@base-ui/react/combobox";

import { cn } from "@/lib/utils";

/**
 * Searchable combobox on Base UI's Combobox (design system §6 → `select` /
 * `combobox`), adapted from PocketWebTools: the input is the field itself
 * (white, resting shadow, focus ring), the popup the popover surface (8px,
 * raised shadow, no border), rows highlight on the ground. Base UI owns the
 * roles, arrow keys, Enter, Escape and focus return.
 *
 * Notes on Base UI: `Empty` and `Status` are siblings of `List`, and the
 * function child of `List` receives one item at a time.
 */
export const Root = BaseCombobox.Root;
export const Status = BaseCombobox.Status;
export const Clear = BaseCombobox.Clear;

export const InputGroup = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof BaseCombobox.InputGroup>>(
  function ComboboxInputGroup({ className, ...props }, ref) {
    return (
      <BaseCombobox.InputGroup
        ref={ref}
        className={cn(
          "relative flex h-10 w-full items-center rounded-md bg-surface shadow-resting pointer-coarse:h-11",
          "transition-[box-shadow] duration-200 ease-out",
          "focus-within:shadow-focus",
          "has-[[aria-invalid=true]]:shadow-[0_0_0_1px_var(--error),0_0_0_4px_rgb(185_28_28/0.18)]",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<typeof BaseCombobox.Input>>(
  function ComboboxInput({ className, ...props }, ref) {
    return (
      <BaseCombobox.Input
        ref={ref}
        className={cn(
          "h-full w-full min-w-0 rounded-md bg-transparent px-3.5 text-sm text-ink outline-none placeholder:text-ink-label",
          className,
        )}
        {...props}
      />
    );
  },
);

interface ContentProps extends React.ComponentProps<typeof BaseCombobox.Popup> {
  sideOffset?: number;
}

/** Portal + Positioner + Popup, at the input group's width. */
export const Content = React.forwardRef<HTMLDivElement, ContentProps>(function ComboboxContent(
  { className, sideOffset = 6, children, ...props },
  ref,
) {
  return (
    <BaseCombobox.Portal>
      <BaseCombobox.Positioner sideOffset={sideOffset} collisionPadding={16} className="z-50 w-(--anchor-width)">
        <BaseCombobox.Popup
          ref={ref}
          className={cn(
            "max-h-[min(320px,var(--available-height))] overflow-hidden rounded-panel bg-surface text-ink shadow-raised outline-none",
            "origin-[var(--transform-origin)]",
            "motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0 data-closed:duration-(--duration-quick)",
            className,
          )}
          {...props}
        >
          {children}
        </BaseCombobox.Popup>
      </BaseCombobox.Positioner>
    </BaseCombobox.Portal>
  );
});

export const List = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof BaseCombobox.List>>(
  function ComboboxList({ className, ...props }, ref) {
    return (
      <BaseCombobox.List
        ref={ref}
        className={cn("max-h-[280px] scroll-py-1 overflow-y-auto overscroll-contain p-1 empty:p-0", className)}
        {...props}
      />
    );
  },
);

export const Item = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof BaseCombobox.Item>>(
  function ComboboxItem({ className, ...props }, ref) {
    return (
      <BaseCombobox.Item
        ref={ref}
        className={cn(
          "flex cursor-pointer items-start gap-2 rounded-md px-3 py-2 text-sm text-ink outline-none pointer-coarse:min-h-11",
          "data-highlighted:bg-highlight",
          "data-disabled:pointer-events-none data-disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Empty = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof BaseCombobox.Empty>>(
  function ComboboxEmpty({ className, children, ...props }, ref) {
    // The Empty wrapper stays mounted for its live region; the visual lives on an inner element.
    return (
      <BaseCombobox.Empty ref={ref} {...props}>
        {children ? <div className={cn("px-3.5 py-3 text-[13px] text-ink-secondary", className)}>{children}</div> : null}
      </BaseCombobox.Empty>
    );
  },
);
