import { dayLabel, periodStart } from "./buckets";
import { hourWeekdayGrid } from "./heatmaps";
import { engagements } from "./series";
import type { Tweet } from "./types";

export interface TimeSlot {
  /** 0 = Monday */
  weekday: number;
  hour: number;
  count: number;
  avgImpressions: number;
}

/** Slots where the author posted at least `minCount` times, ranked by average impressions per post. */
export function bestTimes(tweets: Tweet[], n = 3, minCount = 1): TimeSlot[] {
  const grid = hourWeekdayGrid(tweets);
  const slots: TimeSlot[] = [];
  grid.forEach((row, weekday) => row.forEach((c, hour) => {
    if (c.count >= minCount) slots.push({ weekday, hour, count: c.count, avgImpressions: c.impressions / c.count });
  }));
  return slots.sort((a, b) => b.avgImpressions - a.avgImpressions || b.count - a.count).slice(0, n);
}

export interface BestTimes {
  slots: TimeSlot[];
  /** posts required per slot; 1 means the data was too thin and single posts were allowed */
  minCount: number;
}

/**
 * The one ranking both pages use: slots with at least two posts, so one viral post cannot crown
 * its hour; when fewer than `n` such slots exist, single posts are allowed and `minCount` says so.
 */
export function bestTimesRobust(tweets: Tweet[], n = 3): BestTimes {
  const strict = bestTimes(tweets, n, 2);
  return strict.length >= n ? { slots: strict, minCount: 2 } : { slots: bestTimes(tweets, n, 1), minCount: 1 };
}

export interface Streak {
  current: number;
  longest: number;
  /** true when today has no post yet but yesterday continued the streak */
  atRisk: boolean;
}

/** Consecutive local days with at least one activity. A streak survives until the end of today. */
export function streak(tweets: Tweet[], now: number = Date.now()): Streak {
  const days = new Set(tweets.map((t) => dayLabel(new Date(t.created_at))));
  const today = new Date(periodStart(0, now));
  const has = (d: Date) => days.has(dayLabel(d));
  let current = 0;
  const cursor = new Date(today);
  const atRisk = !has(today);
  if (atRisk) cursor.setDate(cursor.getDate() - 1);
  while (has(cursor)) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }
  let longest = 0;
  const sorted = [...days].sort();
  let run = 0;
  let prev: Date | undefined;
  for (const d of sorted) {
    const [y, m, dd] = d.split("-").map(Number);
    const date = new Date(y!, m! - 1, dd!);
    run = prev && Math.round((date.getTime() - prev.getTime()) / 86_400_000) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = date;
  }
  return { current, longest, atRisk: atRisk && current > 0 };
}

export interface TagStat {
  tag: string;
  count: number;
  impressions: number;
  avgImpressions: number;
  engagementRate?: number;
}

export function hashtagStats(tweets: Tweet[], n = 8): TagStat[] {
  const acc = new Map<string, { count: number; impressions: number; eng: number }>();
  for (const t of tweets) {
    for (const raw of new Set(t.hashtags.map((h) => h.toLowerCase()))) {
      const a = acc.get(raw) ?? { count: 0, impressions: 0, eng: 0 };
      a.count++;
      a.impressions += t.view_count;
      a.eng += engagements(t);
      acc.set(raw, a);
    }
  }
  return [...acc.entries()]
    .map(([tag, a]) => {
      const s: TagStat = { tag, count: a.count, impressions: a.impressions, avgImpressions: a.impressions / a.count };
      if (a.impressions > 0) s.engagementRate = a.eng / a.impressions;
      return s;
    })
    .sort((a, b) => b.avgImpressions - a.avgImpressions || b.count - a.count)
    .slice(0, n);
}

export type LengthBucket = "short" | "medium" | "long";
export interface LengthStat {
  bucket: LengthBucket;
  label: string;
  count: number;
  avgImpressions: number;
  engagementRate?: number;
}

/** Short under 100 characters, medium up to 280, long beyond (articles and long posts). */
export function lengthStats(tweets: Tweet[]): LengthStat[] {
  const defs: { bucket: LengthBucket; label: string; test: (n: number) => boolean }[] = [
    { bucket: "short", label: "Short (< 100 chars)", test: (n) => n < 100 },
    { bucket: "medium", label: "Medium (100 to 280)", test: (n) => n >= 100 && n <= 280 },
    { bucket: "long", label: "Long (> 280)", test: (n) => n > 280 },
  ];
  return defs.map((d) => {
    const list = tweets.filter((t) => d.test(t.full_text.length));
    const impressions = list.reduce((a, t) => a + t.view_count, 0);
    const eng = list.reduce((a, t) => a + engagements(t), 0);
    const s: LengthStat = { bucket: d.bucket, label: d.label, count: list.length, avgImpressions: list.length ? impressions / list.length : 0 };
    if (impressions > 0) s.engagementRate = eng / impressions;
    return s;
  });
}

export interface HotPost {
  tweet: Tweet;
  /** engagements per hour since posting */
  velocity: number;
}

/**
 * Posts from other people captured recently that are gathering engagement fast: the local
 * stand-in for an "engage" feed. Excludes replies and retweets.
 */
export function hotPosts(tweets: Tweet[], selfId: string | undefined, now: number = Date.now(), maxAgeMs = 24 * 3_600_000, n = 30): HotPost[] {
  return tweets
    .filter((t) => t.user_id_str !== selfId && !t.in_reply_to_status_id_str && !t.retweeted_status_id_str && !t.full_text.startsWith("RT @") && now - t.created_at <= maxAgeMs && now - t.created_at > 0)
    .map((t) => ({ tweet: t, velocity: (t.favorite_count + 2 * t.reply_count + t.retweet_count + t.quote_count) / Math.max(0.25, (now - t.created_at) / 3_600_000) }))
    .sort((a, b) => b.velocity - a.velocity)
    .slice(0, n);
}
