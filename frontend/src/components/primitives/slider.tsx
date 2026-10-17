import * as React from "react";
import { Slider as BaseSlider } from "@base-ui/react/slider";

import { cn } from "@/lib/utils";

/**
 * Base UI Slider (design system §6 → `slider`), copied from PocketWebTools:
 * 6px track in `action-secondary`, accent indicator, the thumb a 6 x 18px
 * vertical bar with a 2px white halo (never a circle). An invisible hit band
 * is 24px tall with a mouse and 44px on touch; the Root is `touch-none`.
 */
export function Root<Value extends number | readonly number[]>({
  className,
  thumbAlignment = "edge",
  ...props
}: React.ComponentProps<typeof BaseSlider.Root<Value>>) {
  return (
    <BaseSlider.Root
      thumbAlignment={thumbAlignment}
      className={cn("relative flex w-full touch-none items-center select-none", className)}
      {...props}
    />
  );
}

export const Control = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof BaseSlider.Control>>(
  function SliderControl({ className, ...props }, ref) {
    return (
      <BaseSlider.Control
        ref={ref}
        className={cn(
          "relative flex h-5 w-full items-center",
          "before:absolute before:inset-x-0 before:top-1/2 before:h-6 before:-translate-y-1/2",
          "pointer-coarse:before:h-11",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Track = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof BaseSlider.Track>>(
  function SliderTrack({ className, ...props }, ref) {
    return (
      <BaseSlider.Track
        ref={ref}
        className={cn("relative h-1.5 w-full grow overflow-hidden rounded-full bg-action-secondary", className)}
        {...props}
      />
    );
  },
);

export const Indicator = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof BaseSlider.Indicator>>(
  function SliderIndicator({ className, ...props }, ref) {
    return <BaseSlider.Indicator ref={ref} className={cn("absolute h-full bg-accent", className)} {...props} />;
  },
);

export const Thumb = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof BaseSlider.Thumb>>(
  function SliderThumb({ className, ...props }, ref) {
    return (
      <BaseSlider.Thumb
        ref={ref}
        className={cn(
          "block h-[18px] w-1.5 rounded-tile bg-accent",
          "shadow-[0_0_0_2px_var(--color-surface),var(--shadow-resting)] transition-[box-shadow] duration-200 ease-out",
          "has-[:focus-visible]:shadow-focus focus-visible:shadow-focus focus-visible:outline-none",
          className,
        )}
        {...props}
      />
    );
  },
);
