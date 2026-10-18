import IconArrowPath from "~icons/heroicons/arrow-path";
import IconArrowsUpDown from "~icons/heroicons/arrows-up-down";
import IconCheck from "~icons/heroicons/check";
import IconCheckCircle from "~icons/heroicons/check-circle";
import IconChevronDown from "~icons/heroicons/chevron-down";
import IconClock from "~icons/heroicons/clock";
import IconExclamationCircle from "~icons/heroicons/exclamation-circle";
import IconExclamationTriangle from "~icons/heroicons/exclamation-triangle";
import IconEye from "~icons/heroicons/eye";
import IconEyeSlash from "~icons/heroicons/eye-slash";
import IconFlag from "~icons/heroicons/flag";
import IconInformationCircle from "~icons/heroicons/information-circle";
import IconMapPin from "~icons/heroicons/map-pin";
import IconPause from "~icons/heroicons/pause";
import IconPlay from "~icons/heroicons/play";
import IconTruck from "~icons/heroicons/truck";
import IconXMark from "~icons/heroicons/x-mark";

import type { CSSProperties, HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * UI glyphs: Heroicons 2 outline (design system §4), inlined at build time by
 * unplugin-icons. No icon font, no runtime fetch. Add one by importing it
 * above and naming it in ICONS.
 */
const ICONS = {
  check: IconCheck,
  check_circle: IconCheckCircle,
  clock: IconClock,
  close: IconXMark,
  error: IconExclamationCircle,
  expand_more: IconChevronDown,
  flag: IconFlag,
  hide: IconEyeSlash,
  info: IconInformationCircle,
  pause: IconPause,
  pin: IconMapPin,
  play: IconPlay,
  refresh: IconArrowPath,
  show: IconEye,
  swap: IconArrowsUpDown,
  truck: IconTruck,
  warning: IconExclamationTriangle,
} as const;

export type IconName = keyof typeof ICONS;

interface IconProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  name: IconName;
  /** Pixel size. Defaults to 20. */
  size?: number;
}

export function Icon({ name, size = 20, className, style, ...rest }: IconProps) {
  const Svg = ICONS[name];
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
      <Svg width={size} height={size} />
    </span>
  );
}
