import type { CSSProperties, HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * The one loading spinner (design system §6): a clock hand sweeping a faint
 * face in `currentColor`, one linear turn per 900ms, still under reduced
 * motion. Decorative unless given an `aria-label`; it sits beside a label
 * that says what is happening.
 *
 * Artwork from loading.dev's "Clock" (https://loading.dev/spinners/clock),
 * MIT License, Copyright (c) 2026 Jakub Krehel.
 */
interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: number;
}

export function Spinner({ size = 16, className, style, ...rest }: SpinnerProps) {
  const dim: CSSProperties = { width: size, height: size, ...style };
  return (
    <span
      data-icon=""
      aria-hidden={rest["aria-label"] ? undefined : true}
      role={rest["aria-label"] ? "img" : undefined}
      {...rest}
      className={cn("inline-flex flex-none items-center justify-center", className)}
      style={dim}
    >
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="8" fill="currentColor" opacity="0.1" />
        <path
          className="animate-spinner-clock origin-center motion-reduce:animate-none"
          d="M11.1937 2.92061C10.5206 2.49739 9.77304 2.21397 8.9954 2.08314C8.45076 1.99151 8 2.44772 8 3V7.20324C8 7.49211 8.12492 7.76686 8.34259 7.95677L11.8999 11.0603C12.3287 11.4344 12.9913 11.378 13.2643 10.8787C13.6356 10.1998 13.8736 9.45248 13.9617 8.67713C14.0892 7.55433 13.8971 6.41834 13.4074 5.39993C12.9177 4.38152 12.1503 3.5221 11.1937 2.92061Z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}
