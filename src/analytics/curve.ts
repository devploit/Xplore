import type { TweetMetricRow } from "@/data/db";
import type { Point } from "./types";
import type { Metric } from "./series";
import { HOUR_MS } from "./buckets";

/**
 * A metric of one post over its first `hours` hours, one point per snapshot, labelled by hour
 * offset from publication. Snapshots are sorted and deduplicated by hour so the line stays monotone in x.
 */
export function metricCurve(snapshots: TweetMetricRow[], metric: Metric, createdAt: number, hours = 48): Point[] {
  const sorted = [...snapshots].filter((s) => s.taken_at >= createdAt && s.taken_at - createdAt <= hours * HOUR_MS).sort((a, b) => a.taken_at - b.taken_at);
  const byHour = new Map<number, TweetMetricRow>();
  for (const s of sorted) byHour.set(Math.floor((s.taken_at - createdAt) / HOUR_MS), s);
  return [...byHour.entries()].map(([h, s]) => ({ label: `${h}h`, start: s.taken_at, end: s.taken_at, value: s[metric] }));
}
