import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the custom radius tokens (`rounded-tile/control/panel`),
// so a call site's `rounded-full` replaces a primitive's `rounded-tile`.
const twMerge = extendTailwindMerge({
  extend: { theme: { radius: ["tile", "control", "panel"] } },
});

export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs));
}
