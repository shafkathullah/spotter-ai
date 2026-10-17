/**
 * Display formatting. Every function takes an optional IANA `timeZone` so
 * tests are deterministic; the app passes nothing and gets the browser zone.
 */

/** 51_720 s -> "14h 22m"; under an hour -> "42m". */
export function formatDuration(seconds: number): string {
  const totalMin = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** 966.62 -> "967 mi"; under 10 mi keeps one decimal. */
export function formatDistance(mi: number): string {
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi).toLocaleString("en-US")} mi`;
}

/** Miles inside a risk band: one decimal under 100, whole above. */
export function formatMiles(mi: number): string {
  if (mi === 0) return "0 mi";
  if (mi < 100) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi).toLocaleString("en-US")} mi`;
}

export function formatLoad(lb: number): string {
  return `${Math.round(lb).toLocaleString("en-US")} lb`;
}

export function formatMph(mph: number): string {
  return `${Math.round(mph)} mph`;
}

/** Inches per hour, two decimals ("0.00 in/hr" reads as dry, which it is). */
export function formatInHr(v: number): string {
  return `${v.toFixed(2)} in/hr`;
}

export function formatTempF(f: number | null): string {
  return f === null ? "n/a" : `${Math.round(f)}°F`;
}

export function formatAvgRisk(v: number): string {
  return v.toFixed(2);
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(options: Intl.DateTimeFormatOptions, timeZone?: string): Intl.DateTimeFormat {
  const key = JSON.stringify([options, timeZone ?? ""]);
  let f = dtfCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { ...options, ...(timeZone ? { timeZone } : {}) });
    dtfCache.set(key, f);
  }
  return f;
}

/** "Sat 2:15 PM" */
export function formatDayTime(iso: string, timeZone?: string): string {
  // ICU versions differ on a comma after the weekday; the UI never wants one.
  return dtf({ weekday: "short", hour: "numeric", minute: "2-digit" }, timeZone).format(new Date(iso)).replace(",", "");
}

/** "Sat, Oct 18, 2:15 PM CDT" */
export function formatDateTimeTz(iso: string, timeZone?: string): string {
  return dtf(
    { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" },
    timeZone,
  ).format(new Date(iso));
}

/** "Sat 2 PM", the heatmap slider's hour label. */
export function formatDayHour(iso: string, timeZone?: string): string {
  return dtf({ weekday: "short", hour: "numeric" }, timeZone).format(new Date(iso)).replace(",", "");
}

/** "CDT": the zone abbreviation the times are shown in. */
export function timeZoneAbbr(iso: string, timeZone?: string): string {
  const parts = dtf({ hour: "numeric", timeZoneName: "short" }, timeZone).formatToParts(new Date(iso));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}

/** "T+12 h" */
export function formatHourOffset(h: number): string {
  return `T+${h} h`;
}
