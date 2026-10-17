import * as React from "react";
import { type VariantProps, cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Input (design system §6 → Forms → `text-input`), copied from PocketWebTools:
 * white, resting shadow, 4px radius, no border. Focus is the `--shadow-focus`
 * ring; `aria-invalid` paints the error ring. The visible `<label>` is the
 * caller's job. 44px tall on touch.
 */
export const inputVariants = cva(
  cn(
    "flex w-full rounded-md text-sm transition-[box-shadow,background-color] duration-200 ease-out",
    "text-ink placeholder:text-ink-label",
    "focus-visible:shadow-focus focus-visible:outline-none",
    "aria-invalid:shadow-[0_0_0_1px_var(--error),0_0_0_4px_rgb(185_28_28/0.18)]",
    "disabled:cursor-not-allowed disabled:opacity-50",
  ),
  {
    variants: {
      variant: {
        default: "bg-surface shadow-resting",
        filled: "bg-ground focus-visible:bg-surface",
      },
      inputSize: {
        sm: "h-8 px-3 py-1 text-xs",
        default: "h-10 px-3.5 py-2 pointer-coarse:h-11",
        lg: "h-[46px] px-3.5 py-2 text-[15px]",
      },
    },
    defaultVariants: { variant: "default", inputSize: "default" },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">, VariantProps<typeof inputVariants> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, variant, inputSize, type, ...props },
  ref,
) {
  return <input ref={ref} type={type} className={cn(inputVariants({ variant, inputSize }), className)} {...props} />;
});
