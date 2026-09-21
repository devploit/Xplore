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

/** Buckets for an explicit local range: hourly when it fits in one day, daily otherwise. */
export function bucketsForRange(start: number, end: number): { buckets: Bucket[]; interval: Interval; start: number } {
  const from = new Date(start);
  from.setHours(0, 0, 0, 0);
  const interval: Interval = end - from.getTime() <= DAY_MS ? "hour" : "day";
  return { buckets: makeBuckets(from.getTime(), end, interval), interval, start: from.getTime() };
}

/**
 * The period of equal length that ends where `buckets` begin, in the same interval.
 * Used to draw last period's line behind the current one.
 */
export function previousBuckets(buckets: Bucket[], interval: Interval): Bucket[] {
  if (!buckets.length) return [];
  const first = buckets[0]!;
  const cursor = new Date(first.start);
  for (let i = 0; i < buckets.length; i++) {
    if (interval === "day") cursor.setDate(cursor.getDate() - 1);
    else cursor.setHours(cursor.getHours() - 1);
  }
  const prev = makeBuckets(cursor.getTime(), first.start - 1, interval);
  return prev.slice(-buckets.length);
}
