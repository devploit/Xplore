import type { Bucket, Interval } from "./types";

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function dayLabel(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hourLabel(d: Date): string {
  return `${dayLabel(d)} ${pad(d.getHours())}:00`;
}

/** Local midnight `days` days ago. `days = 0` is today's midnight. */
export function periodStart(days: number, now: number = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

/**
 * Consecutive buckets covering [start, end] in local time. Day buckets are calendar days and
 * survive DST changes because they are stepped with setDate/setHours rather than fixed ms.
 */
export function makeBuckets(start: number, end: number, interval: Interval): Bucket[] {
  const buckets: Bucket[] = [];
  const cursor = new Date(start);
  if (interval === "day") cursor.setHours(0, 0, 0, 0);
  else cursor.setMinutes(0, 0, 0);
  while (cursor.getTime() <= end) {
    const bStart = cursor.getTime();
    const next = new Date(cursor);
    if (interval === "day") next.setDate(next.getDate() + 1);
    else next.setHours(next.getHours() + 1);
    buckets.push({ start: bStart, end: next.getTime(), label: interval === "day" ? dayLabel(cursor) : hourLabel(cursor) });
    cursor.setTime(next.getTime());
  }
  return buckets;
}

/** Buckets for a period selector value: hourly for Today, daily otherwise. */
export function bucketsForPeriod(days: number, now: number = Date.now(), allTimeStart?: number): { buckets: Bucket[]; interval: Interval; start: number } {
  if (days === 0) {
    const start = periodStart(0, now);
    return { buckets: makeBuckets(start, now, "hour"), interval: "hour", start };
  }
  const start = days < 0 ? (allTimeStart ?? periodStart(365, now)) : periodStart(days - 1, now);
  return { buckets: makeBuckets(start, now, "day"), interval: "day", start };
}
