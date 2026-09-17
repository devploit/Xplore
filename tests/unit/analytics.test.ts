import { describe, expect, it } from "vitest";
import type { TweetRow } from "@/data/db";
import { bestTweets, bucketsForPeriod, categorize, cumulative, engagementRate, estimateEarnings, followerSeries, frequencyGrid, halfChange, hourWeekdayGrid, isStandaloneTweet, kindOf, makeBuckets, mediaBreakdown, periodStart, recentTweets, series, shares, splitKinds, worstTweets } from "@/analytics";

// Local noon on 2026-09-17 in whatever timezone the test runs.
const NOW = new Date(2026, 8, 17, 12).getTime();
const DAY = 86_400_000;

function tw(id: string, daysAgo: number, extra: Partial<TweetRow> = {}): TweetRow {
  return {
    id,
    user_id_str: "42",
    created_at: NOW - daysAgo * DAY,
    full_text: `t${id}`,
    favorite_count: 0,
    retweet_count: 0,
    reply_count: 0,
    quote_count: 0,
    bookmark_count: 0,
    view_count: 0,
    media_types: [],
    urls: [],
    hashtags: [],
    user_mentions: [],
    updated_at: NOW,
    ...extra,
  };
}

describe("split", () => {
  it("classifies retweets, replies and tweets", () => {
    expect(kindOf(tw("1", 0, { full_text: "RT @a: x" }))).toBe("retweet");
    expect(kindOf(tw("2", 0, { retweeted_status_id_str: "9" }))).toBe("retweet");
    expect(kindOf(tw("3", 0, { in_reply_to_status_id_str: "9" }))).toBe("reply");
    expect(kindOf(tw("4", 0, { full_text: "@a hi" }))).toBe("reply");
    expect(kindOf(tw("5", 0))).toBe("tweet");
    const s = splitKinds([tw("1", 0, { full_text: "RT @a" }), tw("3", 0, { in_reply_to_status_id_str: "9" }), tw("5", 0)]);
    expect([s.retweets.length, s.replies.length, s.tweets.length]).toEqual([1, 1, 1]);
  });
  it("excludes thread continuations from standalone tweets", () => {
    expect(isStandaloneTweet(tw("10", 0, { conversation_id_str: "10" }))).toBe(true);
    expect(isStandaloneTweet(tw("11", 0, { conversation_id_str: "10" }))).toBe(false);
  });
});

describe("buckets", () => {
  it("creates local calendar-day buckets with local labels", () => {
    const start = periodStart(2, NOW);
    const b = makeBuckets(start, NOW, "day");
    expect(b).toHaveLength(3);
    expect(b[0]?.label).toBe("2026-09-15");
    expect(b[2]?.label).toBe("2026-09-17");
    expect(new Date(b[0]!.start).getHours()).toBe(0);
  });
  it("uses hourly buckets for Today and daily otherwise", () => {
    expect(bucketsForPeriod(0, NOW).interval).toBe("hour");
    expect(bucketsForPeriod(0, NOW).buckets).toHaveLength(13);
    const week = bucketsForPeriod(7, NOW);
    expect(week.interval).toBe("day");
    expect(week.buckets).toHaveLength(7);
  });
});

describe("series", () => {
  const tweets = [tw("1", 0, { view_count: 100, favorite_count: 5 }), tw("2", 1, { view_count: 50 }), tw("3", 1, { view_count: 25, favorite_count: 2 }), tw("4", 40)];
  const { buckets } = bucketsForPeriod(7, NOW);
  it("counts and sums per bucket, ignoring tweets outside the range", () => {
    const counts = series(tweets, buckets);
    expect(counts.map((p) => p.value)).toEqual([0, 0, 0, 0, 0, 2, 1]);
    expect(series(tweets, buckets, "view_count").map((p) => p.value)).toEqual([0, 0, 0, 0, 0, 75, 100]);
  });
  it("accumulates and measures change between halves", () => {
    const pts = series(tweets, buckets, "view_count");
    expect(cumulative(pts).map((p) => p.value)).toEqual([0, 0, 0, 0, 0, 75, 175]);
    expect(halfChange(pts)).toBe(175);
    expect(halfChange(pts.slice(5))).toBe(25);
  });
  it("computes shares and engagement rate", () => {
    expect(shares({ a: 50, b: 25, c: 25 })).toEqual({ a: 50, b: 25, c: 25 });
    expect(shares({ a: 0 })).toEqual({ a: 0 });
    expect(engagementRate(tweets)).toBeCloseTo(7 / 175);
    expect(engagementRate([tw("z", 0)])).toBeUndefined();
  });
});

describe("media", () => {
  it("categorizes exclusively by priority and ignores digits as emoji", () => {
    expect(categorize(tw("1", 0, { media_types: ["photo", "video"] }))).toBe("video");
    expect(categorize(tw("2", 0, { media_types: ["photo"], urls: ["x"] }))).toBe("photo");
    expect(categorize(tw("3", 0, { media_types: ["animated_gif"] }))).toBe("gif");
    expect(categorize(tw("4", 0, { urls: ["https://a"] }))).toBe("url");
    expect(categorize(tw("5", 0, { full_text: "hi 🚀" }))).toBe("emoji");
    expect(categorize(tw("6", 0, { full_text: "top 10 #tags" }))).toBe("text");
  });
  it("breaks down counts, shares and rates", () => {
    const b = mediaBreakdown([tw("1", 0, { media_types: ["photo"], view_count: 100, favorite_count: 10 }), tw("2", 0), tw("3", 0)]);
    const photo = b.find((c) => c.category === "photo")!;
    expect(photo).toMatchObject({ count: 1, share: 33, impressions: 100, engagements: 10, engagementRate: 0.1 });
    expect(b.find((c) => c.category === "text")?.share).toBe(67);
  });
});

describe("followers", () => {
  it("aligns snapshots, forward-fills gaps and keeps negative deltas", () => {
    const { buckets } = bucketsForPeriod(5, NOW);
    const snap = (daysAgo: number, followers: number) => ({ user_id: "42", day: "", followers_count: followers, following_count: 0, statuses_count: 0, taken_at: NOW - daysAgo * DAY });
    const s = followerSeries([snap(4, 100), snap(3, 110), snap(1, 105)], buckets);
    expect(s.absolute.map((p) => p.value)).toEqual([100, 110, 110, 105, 105]);
    expect(s.delta.map((p) => p.value)).toEqual([0, 10, 0, -5, 0]);
    expect(s.latest).toBe(105);
  });
  it("uses the first known value before the first snapshot", () => {
    const { buckets } = bucketsForPeriod(3, NOW);
    const s = followerSeries([{ user_id: "42", day: "", followers_count: 7, following_count: 0, statuses_count: 0, taken_at: NOW }], buckets);
    expect(s.absolute.map((p) => p.value)).toEqual([7, 7, 7]);
  });
});

describe("ranking", () => {
  const tweets = [tw("a", 0, { favorite_count: 5, view_count: 500 }), tw("b", 0, { favorite_count: 1, view_count: 10 }), tw("c", 0, { favorite_count: 2, view_count: 300 }), tw("d", 0, { favorite_count: 9, view_count: 50, in_reply_to_status_id_str: "x" })];
  it("ranks best by likes and worst only among seen tweets", () => {
    expect(bestTweets(tweets, 2).map((t) => t.id)).toEqual(["d", "a"]);
    expect(worstTweets(tweets, 5).map((t) => t.id)).toEqual(["c", "a"]);
    expect(recentTweets(tweets, 5).map((t) => t.id)).not.toContain("d");
  });
});

describe("heatmaps", () => {
  it("builds an 18 by 7 frequency grid with stats over the period", () => {
    const g = frequencyGrid([tw("1", 0), tw("2", 0), tw("3", 3)], 18, NOW, 7);
    expect(g.weeks).toHaveLength(18);
    expect(g.weeks.every((w) => w.length === 7)).toBe(true);
    const today = g.weeks.flat().find((c) => c.day === "2026-09-17");
    expect(today?.count).toBe(2);
    expect(g.max).toBe(2);
    expect(g.min).toBe(0);
    expect(g.avg).toBeCloseTo(3 / 7);
  });
  it("sums impressions by weekday and hour", () => {
    const grid = hourWeekdayGrid([tw("1", 0, { view_count: 40 }), tw("2", 0, { view_count: 2 })]);
    const d = new Date(NOW);
    const cell = grid[(d.getDay() + 6) % 7]![d.getHours()]!;
    expect(cell).toEqual({ impressions: 42, count: 2 });
  });
});

describe("earnings", () => {
  it("applies the SuperX estimate", () => {
    expect(estimateEarnings(117_370)).toBeCloseTo(1.5);
  });
});
