import type { Bucket, Point, Tweet } from "./types";

export type Metric = "view_count" | "favorite_count" | "retweet_count" | "reply_count" | "quote_count" | "bookmark_count";

/** Per-bucket count of tweets, or sum of a metric when `field` is given. */
export function series(tweets: Tweet[], buckets: Bucket[], field?: Metric): Point[] {
  const values = new Array<number>(buckets.length).fill(0);
  const counts = new Array<number>(buckets.length).fill(0);
  if (!buckets.length) return [];
  const first = buckets[0]!.start;
  const last = buckets[buckets.length - 1]!.end;
  for (const t of tweets) {
    if (t.created_at < first || t.created_at >= last) continue;
    // Buckets are sorted and contiguous, so a binary search finds the slot.
    let lo = 0;
    let hi = buckets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (buckets[mid]!.end <= t.created_at) lo = mid + 1;
      else hi = mid;
    }
    values[lo]! += field ? t[field] || 0 : 1;
    counts[lo]! += 1;
  }
  return buckets.map((b, i) => ({ label: b.label, start: b.start, end: b.end, value: values[i]!, count: counts[i]! }));
}

export function total(points: Point[]): number {
  return points.reduce((a, p) => a + p.value, 0);
}

export function cumulative(points: Point[]): Point[] {
  let run = 0;
  return points.map((p) => ({ ...p, value: (run += p.value) }));
}

/** Second half minus first half; for two or fewer points, last minus previous. */
export function halfChange(points: Point[]): number {
  const n = points.length;
  if (n === 0) return 0;
  if (n <= 2) return (points[n - 1]?.value ?? 0) - (points[n - 2]?.value ?? 0);
  const mid = Math.floor(n / 2);
  const first = points.slice(0, mid).reduce((a, p) => a + p.value, 0);
  const second = points.slice(n - mid).reduce((a, p) => a + p.value, 0);
  return second - first;
}

/** Each metric's share of the sum of all metric totals, rounded to whole percents. */
export function shares(totals: Record<string, number>): Record<string, number> {
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(totals)) out[k] = sum > 0 ? Math.round((100 * v) / sum) : 0;
  return out;
}

export function engagements(t: Tweet): number {
  return t.favorite_count + t.retweet_count + t.reply_count + t.quote_count + t.bookmark_count;
}

/** Engagements over impressions; undefined when there are no impressions to divide by. */
export function engagementRate(tweets: Tweet[]): number | undefined {
  let eng = 0;
  let views = 0;
  for (const t of tweets) {
    eng += engagements(t);
    views += t.view_count;
  }
  return views > 0 ? eng / views : undefined;
}

export function tweetEngagementRate(t: Tweet): number | undefined {
  return t.view_count > 0 ? engagements(t) / t.view_count : undefined;
}

/** Median of per-tweet engagement rates over tweets that have impressions. */
export function medianEngagementRate(tweets: Tweet[]): number | undefined {
  const rates = tweets.map(tweetEngagementRate).filter((r): r is number => r !== undefined).sort((a, b) => a - b);
  if (!rates.length) return undefined;
  const mid = rates.length >> 1;
  return rates.length % 2 ? rates[mid]! : (rates[mid - 1]! + rates[mid]!) / 2;
}
