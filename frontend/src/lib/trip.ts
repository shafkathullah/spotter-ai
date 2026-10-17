import type { Checkpoint, LonLat } from "@/api/types";

/**
 * Where the truck is at `iso`, interpolated between the two checkpoints whose
 * ETAs bracket it. Null before departure or after arrival.
 */
export function positionAtTime(checkpoints: readonly Checkpoint[], iso: string): LonLat | null {
  const t = new Date(iso).getTime();
  const first = checkpoints[0];
  const last = checkpoints[checkpoints.length - 1];
  if (!first || !last) return null;
  if (t < new Date(first.eta).getTime() || t > new Date(last.eta).getTime()) return null;
  for (let i = 1; i < checkpoints.length; i++) {
    const a = checkpoints[i - 1] as Checkpoint;
    const b = checkpoints[i] as Checkpoint;
    const ta = new Date(a.eta).getTime();
    const tb = new Date(b.eta).getTime();
    if (t <= tb) {
      const f = tb === ta ? 0 : (t - ta) / (tb - ta);
      return [a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f];
    }
  }
  return [last.lon, last.lat];
}
