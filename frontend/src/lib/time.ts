function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A Date as the value a `<input type="datetime-local">` takes, in local time. */
export function toDateTimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The next full hour after `now`, local time (14:20 -> 15:00, 15:00 -> 16:00). */
export function nextFullHour(now: Date = new Date()): Date {
  const d = new Date(now.getTime());
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/** Parses a datetime-local value ("2026-10-18T08:00") as local time. */
export function parseDateTimeLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * ISO 8601 with the local UTC offset for that instant (DST-correct):
 * 2026-10-18T08:00:00-05:00. The backend needs the offset to place the
 * departure in time; UTC "Z" would also work but loses the driver's zone.
 */
export function toIsoWithOffset(d: Date): string {
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Whole hours from `startIso` to `iso`, as a float. */
export function hoursBetween(startIso: string, iso: string): number {
  return (new Date(iso).getTime() - new Date(startIso).getTime()) / 3_600_000;
}
