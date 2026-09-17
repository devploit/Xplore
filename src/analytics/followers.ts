import type { FollowerSnapshotRow } from "@/data/db";
import type { Bucket, Point } from "./types";

export interface FollowerSeries {
  absolute: Point[];
  delta: Point[];
  latest?: number;
}

/**
 * Aligns daily snapshots to buckets. Each bucket takes the first snapshot inside it; gaps are
 * forward-filled from the previous bucket, and buckets before the first snapshot use the first
 * known value so the chart does not start at zero. Deltas may be negative.
 */
export function followerSeries(snapshots: FollowerSnapshotRow[], buckets: Bucket[]): FollowerSeries {
  const sorted = [...snapshots].sort((a, b) => a.taken_at - b.taken_at);
  const absolute: Point[] = [];
  let i = 0;
  let last: number | undefined;
  const firstKnown = sorted[0]?.followers_count;
  for (const b of buckets) {
    let value: number | undefined;
    while (i < sorted.length && sorted[i]!.taken_at < b.end) {
      if (sorted[i]!.taken_at >= b.start && value === undefined) value = sorted[i]!.followers_count;
      else if (sorted[i]!.taken_at < b.start) last = sorted[i]!.followers_count;
      i++;
    }
    if (value === undefined) value = last ?? firstKnown ?? 0;
    last = value;
    absolute.push({ label: b.label, start: b.start, end: b.end, value });
  }
  const delta = absolute.map((p, idx) => ({ ...p, value: idx === 0 ? 0 : p.value - absolute[idx - 1]!.value }));
  const out: FollowerSeries = { absolute, delta };
  const latest = sorted[sorted.length - 1]?.followers_count;
  if (latest !== undefined) out.latest = latest;
  return out;
}
