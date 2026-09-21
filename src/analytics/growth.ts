import type { FollowerPointRow, UserRow } from "@/data/db";
import type { Tweet } from "./types";
import { engagements, tweetEngagementRate } from "./series";
import { kindOf } from "./split";
import { DAY_MS, HOUR_MS, periodStart } from "./buckets";

export type CandidateKind = "post" | "reply" | "mention" | "quote" | "reply-to-you";

/** Something visible on X that could have sent people to your profile inside the window. */
export interface Candidate {
  tweet: Tweet;
  kind: CandidateKind;
  /** the other account, for posts you did not write */
  author?: UserRow | undefined;
}

export interface PostAttribution extends Candidate {
  /** followers gained in the window after this post, split with any other candidate active at the time */
  gained: number;
  /** share of all attributed gains, 0..1 */
  share: number;
}

export interface Attribution {
  posts: PostAttribution[];
  /** gains inside the period with no visible candidate */
  unattributed: number;
  /** total change of the follower count over the points given */
  total: number;
  /** how many follower points backed the computation */
  points: number;
}

/** Your own posts and replies as candidates; retweets are not yours to get credit for. */
export function ownCandidates(own: Tweet[]): Candidate[] {
  return own.filter((t) => kindOf(t) !== "retweet").map((t) => ({ tweet: t, kind: kindOf(t) === "reply" ? "reply" : "post" }));
}

/**
 * Other people's posts that put your name in front of their audience: mentions, quotes of your
 * posts and replies to you. `authors` supplies the display data; unknown authors are kept anonymous.
 */
export function externalCandidates(others: Tweet[], selfId: string, ownIds: Set<string>, authors: Map<string, UserRow>): Candidate[] {
  const out: Candidate[] = [];
  for (const t of others) {
    if (t.user_id_str === selfId || kindOf(t) === "retweet") continue;
    let kind: CandidateKind | undefined;
    if (t.quoted_status_id_str && ownIds.has(t.quoted_status_id_str)) kind = "quote";
    else if (t.in_reply_to_user_id_str === selfId) kind = "reply-to-you";
    else if (t.user_mentions.some((m) => m.id_str === selfId)) kind = "mention";
    if (kind) out.push({ tweet: t, kind, author: authors.get(t.user_id_str) });
  }
  return out;
}

/**
 * Splits every follower change between consecutive points among the candidates active in the
 * previous `windowMs`, in proportion to their impressions. A candidate that was alone gets the whole
 * change; a change with nothing visible goes to `unattributed`. Correlation, not proof of cause.
 */
export function followerAttribution(points: FollowerPointRow[], candidates: Candidate[], windowMs: number = 24 * HOUR_MS): Attribution {
  const sorted = [...points].sort((a, b) => a.taken_at - b.taken_at);
  const gained = new Map<string, number>();
  let unattributed = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const delta = cur.followers_count - prev.followers_count;
    if (delta === 0) continue;
    const active = candidates.filter((c) => c.tweet.created_at <= cur.taken_at && c.tweet.created_at > cur.taken_at - windowMs);
    if (!active.length) {
      unattributed += delta;
      continue;
    }
    const weight = active.reduce((a, c) => a + Math.max(1, c.tweet.view_count), 0);
    for (const c of active) gained.set(c.tweet.id, (gained.get(c.tweet.id) ?? 0) + (delta * Math.max(1, c.tweet.view_count)) / weight);
  }
  const positive = [...gained.entries()].filter(([, g]) => g >= 0.5);
  const sum = positive.reduce((a, [, g]) => a + g, 0);
  const byId = new Map(candidates.map((c) => [c.tweet.id, c]));
  const posts = positive
    .map(([id, g]) => ({ ...byId.get(id)!, gained: Math.round(g), share: sum > 0 ? g / sum : 0 }))
    .sort((a, b) => b.gained - a.gained);
  const total = sorted.length > 1 ? sorted[sorted.length - 1]!.followers_count - sorted[0]!.followers_count : 0;
  return { posts, unattributed: Math.round(unattributed), total, points: sorted.length };
}

export interface ReplyTarget {
  userId: string;
  count: number;
  avgImpressions: number;
  totalEngagements: number;
}

/** Which accounts your replies reach: grouped by the user replied to, ranked by average impressions. */
export function replyTargets(own: Tweet[], selfId: string, n = 6): ReplyTarget[] {
  const acc = new Map<string, { count: number; views: number; eng: number }>();
  for (const t of own) {
    const target = t.in_reply_to_user_id_str;
    if (!target || target === selfId || kindOf(t) !== "reply") continue;
    const cur = acc.get(target) ?? { count: 0, views: 0, eng: 0 };
    cur.count += 1;
    cur.views += t.view_count;
    cur.eng += engagements(t);
    acc.set(target, cur);
  }
  return [...acc.entries()]
    .map(([userId, v]) => ({ userId, count: v.count, avgImpressions: v.views / v.count, totalEngagements: v.eng }))
    .sort((a, b) => b.avgImpressions - a.avgImpressions || b.count - a.count)
    .slice(0, n);
}

/** Own original posts old enough that most current followers never saw them, ranked by how well they did. */
export function evergreen(own: Tweet[], now: number = Date.now(), minAgeDays = 60, n = 5): Tweet[] {
  const cutoff = now - minAgeDays * DAY_MS;
  return own
    .filter((t) => kindOf(t) === "tweet" && !t.in_reply_to_status_id_str && t.created_at < cutoff && (t.favorite_count > 0 || t.bookmark_count > 0))
    .sort((a, b) => b.favorite_count + 2 * b.bookmark_count - (a.favorite_count + 2 * a.bookmark_count) || (tweetEngagementRate(b) ?? 0) - (tweetEngagementRate(a) ?? 0))
    .slice(0, n);
}

export interface RadarOptions {
  maxAgeHours: number;
  /** keep only posts with at most this many replies, so a reply can still be seen */
  maxReplies?: number | undefined;
  /** keep only authors with more followers than this (typically your own count) */
  minAuthorFollowers?: number | undefined;
}

export interface RadarPost {
  tweet: Tweet;
  /** impressions per minute since posting; 0 when X did not report views */
  perMinute: number;
  /** engagements per hour, the fallback ranking */
  velocity: number;
  ageMinutes: number;
}

/**
 * Posts from other people worth replying to right now: fresh, still with few replies, from accounts
 * bigger than yours, ranked by how fast they are being seen.
 */
export function replyRadar(tweets: Tweet[], users: Map<string, UserRow>, selfId: string | undefined, opts: RadarOptions, now: number = Date.now(), n = 30): RadarPost[] {
  const maxAge = opts.maxAgeHours * HOUR_MS;
  return tweets
    .filter((t) => t.user_id_str !== selfId && !t.in_reply_to_status_id_str && !t.retweeted_status_id_str && !t.full_text.startsWith("RT @"))
    .filter((t) => now - t.created_at > 0 && now - t.created_at <= maxAge)
    .filter((t) => opts.maxReplies === undefined || t.reply_count <= opts.maxReplies)
    .filter((t) => opts.minAuthorFollowers === undefined || (users.get(t.user_id_str)?.followers_count ?? 0) > opts.minAuthorFollowers)
    .map((t) => {
      const ageMinutes = Math.max(1, (now - t.created_at) / 60_000);
      return { tweet: t, perMinute: t.view_count / ageMinutes, velocity: (t.favorite_count + 2 * t.reply_count + t.retweet_count + t.quote_count) / Math.max(0.25, ageMinutes / 60), ageMinutes };
    })
    .sort((a, b) => b.perMinute - a.perMinute || b.velocity - a.velocity)
    .slice(0, n);
}

/** How many replies the user has published today, local time. */
export function repliesToday(own: Tweet[], now: number = Date.now()): number {
  const start = periodStart(0, now);
  return own.filter((t) => kindOf(t) === "reply" && t.created_at >= start && t.created_at <= now).length;
}

export interface WeeklySummary {
  posts: number;
  replies: number;
  impressions: number;
  engagements: number;
  engagementRate: number | undefined;
  followersGained: number | undefined;
  best: Tweet | undefined;
  /** local start of the 7-day window */
  since: number;
}

/** The last seven days in one glance, for the shareable report. */
export function weeklySummary(own: Tweet[], points: FollowerPointRow[], now: number = Date.now()): WeeklySummary {
  const since = periodStart(6, now);
  const week = own.filter((t) => t.created_at >= since && t.created_at <= now && kindOf(t) !== "retweet");
  const originals = week.filter((t) => kindOf(t) === "tweet");
  const impressions = week.reduce((a, t) => a + t.view_count, 0);
  const eng = week.reduce((a, t) => a + engagements(t), 0);
  const inWindow = points.filter((p) => p.taken_at >= since).sort((a, b) => a.taken_at - b.taken_at);
  const before = points.filter((p) => p.taken_at < since).sort((a, b) => b.taken_at - a.taken_at)[0];
  const first = before ?? inWindow[0];
  const last = inWindow[inWindow.length - 1];
  const best = [...originals].sort((a, b) => b.view_count - a.view_count)[0];
  return {
    posts: originals.length,
    replies: week.length - originals.length,
    impressions,
    engagements: eng,
    engagementRate: impressions > 0 ? eng / impressions : undefined,
    followersGained: first && last && last !== first ? last.followers_count - first.followers_count : undefined,
    best,
    since,
  };
}
