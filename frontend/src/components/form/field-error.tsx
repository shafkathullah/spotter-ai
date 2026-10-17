import { Icon } from "@/components/icon";

/** Inline field error: glyph + message in the error colour, tied by `aria-describedby`. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-start gap-1.5 text-[13px] leading-snug text-error">
      <Icon name="error" size={16} className="mt-px" />
      <span>{message}</span>
    </p>
  );
}
