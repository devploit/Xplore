import { describe, expect, it } from "vitest";
import Dexie from "dexie";
import type { TweetMetricRow, TweetRow } from "@/data/db";
import { XploreDb } from "@/data/db";
import { Ingestor, METRIC_WINDOW_MS } from "@/data/ingest";
import { normalizeUser } from "@/data/normalizer";
import { runPrune, METRIC_RETENTION_MS } from "@/data/jobs/jobs";
import { tweetsToCsv } from "@/data/export";
import { bucketsForPeriod, bucketsForRange, groupThreads, medianEngagementRate, metricCurve, previousBuckets, series } from "@/analytics";
import * as fx from "../fixtures/builders";

const NOW = new Date(2026, 8, 17, 12).getTime();
const DAY = 86_400_000;
const HOUR = 3_600_000;

function tw(id: string, extra: Partial<TweetRow> = {}): TweetRow {
  return { id, user_id_str: "42", created_at: NOW - DAY, full_text: `t${id}`, favorite_count: 0, retweet_count: 0, reply_count: 0, quote_count: 0, bookmark_count: 0, view_count: 0, media_types: [], urls: [], hashtags: [], user_mentions: [], updated_at: NOW, ...extra };
}

function xDate(ts: number): string {
  return new Date(ts).toUTCString().replace(/,/, "");
}

function ownPage(id: string, ageMs: number, views: number) {
  return fx.userTweetsResponse([fx.itemEntry(`tweet-${id}`, fx.tweetResult(id, "42", "me", { created_at: xDate(NOW - ageMs) }, { views: { count: String(views), state: "EnabledWithCount" } }))]);
}

describe("database v2", () => {
  it("opens a v1 database and adds tweetMetrics without losing rows", async () => {
    const name = "v2-upgrade";
    const v1 = new Dexie(name);
    v1.version(1).stores({ tweets: "id, user_id_str, created_at, conversation_id_str, in_reply_to_user_id_str, quoted_status_id_str, [user_id_str+created_at]", users: "id, screen_name", followerSnapshots: "[user_id+day], user_id, day", queryIds: "op, seen_at", rateLimits: "endpoint", backfill: "key", timelines: "id, created_at", settings: "key" });
    await v1.table("tweets").put(tw("1"));
    v1.close();
    const db = new XploreDb(name);
    expect(await db.tweets.count()).toBe(1);
    expect(db.tables.map((t) => t.name)).toContain("tweetMetrics");
    await db.tweetMetrics.put({ tweet_id: "1", taken_at: NOW, view_count: 1, favorite_count: 0, retweet_count: 0, reply_count: 0, quote_count: 0, bookmark_count: 0 });
    expect(await db.tweetMetrics.where("tweet_id").equals("1").count()).toBe(1);
  });

  it("indexes replies by their parent post so post detail can list them", async () => {
    const db = new XploreDb("v3-reply-index");
    await db.tweets.bulkPut([tw("root"), tw("r1", { user_id_str: "7", in_reply_to_status_id_str: "root" }), tw("r2", { user_id_str: "8", in_reply_to_status_id_str: "root" }), tw("other", { in_reply_to_status_id_str: "x" })]);
    expect((await db.tweets.where("in_reply_to_status_id_str").equals("root").toArray()).map((t) => t.id).sort()).toEqual(["r1", "r2"]);
  });
});

describe("metric snapshots", () => {
  it("records a snapshot for recent own posts and skips unchanged counters", async () => {
    const db = new XploreDb("metrics-dedupe");
    const ing = new Ingestor(db, () => "42");
    await ing.ingestBody(ownPage("1", HOUR, 100), NOW);
    await ing.ingestBody(ownPage("1", HOUR, 100), NOW + HOUR);
    await ing.ingestBody(ownPage("1", HOUR, 250), NOW + 2 * HOUR);
    const rows = await db.tweetMetrics.where("tweet_id").equals("1").sortBy("taken_at");
    expect(rows.map((r) => r.view_count)).toEqual([100, 250]);
  });

  it("ignores old posts and other people's posts", async () => {
    const db = new XploreDb("metrics-window");
    const ing = new Ingestor(db, () => "42");
    await ing.ingestBody(ownPage("old", METRIC_WINDOW_MS + DAY, 100), NOW);
    await ing.ingestBody(fx.userTweetsResponse([fx.itemEntry("tweet-x", fx.tweetResult("x", "7", "someone", { created_at: xDate(NOW - HOUR) }))]), NOW);
    expect(await db.tweetMetrics.count()).toBe(0);
  });

  it("prune drops snapshots older than the retention window", async () => {
    const db = new XploreDb("metrics-prune");
    await db.tweetMetrics.bulkPut([
      { tweet_id: "1", taken_at: NOW - METRIC_RETENTION_MS - DAY, view_count: 1, favorite_count: 0, retweet_count: 0, reply_count: 0, quote_count: 0, bookmark_count: 0 },
      { tweet_id: "1", taken_at: NOW - DAY, view_count: 2, favorite_count: 0, retweet_count: 0, reply_count: 0, quote_count: 0, bookmark_count: 0 },
    ]);
    await runPrune(db, "42", 90, NOW);
    expect((await db.tweetMetrics.toArray()).map((r) => r.view_count)).toEqual([2]);
  });
});

describe("metricCurve", () => {
  const snap = (offsetMs: number, views: number): TweetMetricRow => ({ tweet_id: "1", taken_at: NOW + offsetMs, view_count: views, favorite_count: 0, retweet_count: 0, reply_count: 0, quote_count: 0, bookmark_count: 0 });
  it("labels points by hour offset, keeps the last snapshot per hour and stops at the window", () => {
    const points = metricCurve([snap(30 * 60_000, 10), snap(50 * 60_000, 20), snap(3 * HOUR, 90), snap(60 * HOUR, 500)], "view_count", NOW);
    expect(points.map((p) => [p.label, p.value])).toEqual([["0h", 20], ["3h", 90]]);
  });
  it("ignores snapshots taken before publication", () => {
    expect(metricCurve([snap(-HOUR, 5), snap(HOUR, 7)], "view_count", NOW)).toHaveLength(1);
  });
});

describe("groupThreads", () => {
  it("groups a root with its own continuations and ignores single posts and replies to others", () => {
    const own = [
      tw("r", { conversation_id_str: "r", created_at: NOW - 3 * HOUR, view_count: 100, favorite_count: 5 }),
      tw("p2", { conversation_id_str: "r", in_reply_to_status_id_str: "r", in_reply_to_user_id_str: "42", full_text: "part 2", created_at: NOW - 2 * HOUR, view_count: 40 }),
      tw("p3", { conversation_id_str: "r", in_reply_to_status_id_str: "p2", in_reply_to_user_id_str: "42", full_text: "part 3", created_at: NOW - HOUR, view_count: 10, favorite_count: 1 }),
      tw("single", { conversation_id_str: "single" }),
      tw("reply-out", { conversation_id_str: "other", in_reply_to_status_id_str: "other", in_reply_to_user_id_str: "7", full_text: "@someone hi" }),
    ];
    const threads = groupThreads(own);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.parts.map((t) => t.id)).toEqual(["r", "p2", "p3"]);
    expect(threads[0]!.impressions).toBe(150);
    expect(threads[0]!.engagements).toBe(6);
  });
});

describe("previousBuckets", () => {
  it("returns the same number of day buckets ending right before the current period", () => {
    const { buckets, interval } = bucketsForPeriod(7, NOW);
    const prev = previousBuckets(buckets, interval);
    expect(prev).toHaveLength(buckets.length);
    expect(prev[prev.length - 1]!.end).toBe(buckets[0]!.start);
  });
  it("carries per-bucket post counts in series", () => {
    const { buckets } = bucketsForPeriod(7, NOW);
    const pts = series([tw("a", { created_at: NOW - HOUR, view_count: 10 }), tw("b", { created_at: NOW - 2 * HOUR, view_count: 5 })], buckets, "view_count");
    const today = pts[pts.length - 1]!;
    expect(today.value).toBe(15);
    expect(today.count).toBe(2);
  });
});

describe("medianEngagementRate", () => {
  it("takes the median of per-post rates and skips posts without impressions", () => {
    const rate = medianEngagementRate([tw("a", { view_count: 100, favorite_count: 10 }), tw("b", { view_count: 100, favorite_count: 30 }), tw("c", { view_count: 100, favorite_count: 20 }), tw("d")]);
    expect(rate).toBeCloseTo(0.2);
  });
});

describe("tweetsToCsv", () => {
  it("quotes text with commas, quotes and newlines and orders newest first", () => {
    const csv = tweetsToCsv([tw("1", { created_at: NOW - DAY, full_text: 'plain' }), tw("2", { created_at: NOW, full_text: 'has "quotes", commas\nand lines', view_count: 7 })], "me");
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("id,created_at,kind,text,impressions,likes,retweets,quotes,replies,bookmarks,url");
    expect(lines[1]!.startsWith("2,")).toBe(true);
    expect(lines[1]).toContain('"has ""quotes"", commas\nand lines"');
    expect(lines[1]!.endsWith("https://x.com/me/status/2")).toBe(true);
    expect(lines[2]!.startsWith("1,")).toBe(true);
  });
});

describe("bucketsForRange", () => {
  it("uses daily buckets across days and hourly buckets inside one day", () => {
    const start = new Date(2026, 8, 1).getTime();
    const end = new Date(2026, 8, 10, 23, 59, 59, 999).getTime();
    const daily = bucketsForRange(start, end);
    expect(daily.interval).toBe("day");
    expect(daily.buckets).toHaveLength(10);
    expect(daily.buckets[0]!.label).toBe("2026-09-01");
    const hourly = bucketsForRange(new Date(2026, 8, 5, 8).getTime(), new Date(2026, 8, 5, 20).getTime());
    expect(hourly.interval).toBe("hour");
    expect(hourly.buckets[0]!.label).toBe("2026-09-05 00:00");
  });
});

describe("partial users", () => {
  const full = { rest_id: "42", legacy: { screen_name: "me", name: "Me", followers_count: 3121, friends_count: 10, statuses_count: 500 } };
  const embedded = { rest_id: "42", core: { screen_name: "me", name: "Me renamed" }, legacy: {} };

  it("flags users that arrive without counters", () => {
    expect(normalizeUser(full, NOW)?.partial).toBeUndefined();
    expect(normalizeUser(embedded, NOW)).toMatchObject({ partial: true, followers_count: 0 });
  });

  it("keeps stored counters when a partial user arrives and never snapshots from it", async () => {
    const db = new XploreDb("partial-merge");
    const ing = new Ingestor(db, () => "42");
    const page = (user: object) => fx.userTweetsResponse([fx.itemEntry("tweet-1", { ...fx.tweetResult("1", "42", "me", { created_at: xDate(NOW - HOUR) }), core: { user_results: { result: user } } })]);
    await ing.ingestBody(page(full), NOW);
    await ing.ingestBody(page(embedded), NOW + HOUR);
    const user = await db.users.get("42");
    expect(user).toMatchObject({ followers_count: 3121, name: "Me renamed" });
    expect(user?.partial).toBeUndefined();
    const points = await db.followerPoints.where("user_id").equals("42").toArray();
    expect(points.map((p) => p.followers_count)).toEqual([3121]);
  });

  it("the v5 upgrade removes bogus zero points and restores the user's counters", async () => {
    const name = "v5-repair";
    const v4 = new Dexie(name);
    v4.version(4).stores({ tweets: "id", users: "id, screen_name", followerSnapshots: "[user_id+day], user_id, day", queryIds: "op", rateLimits: "endpoint", backfill: "key", timelines: "id", settings: "key", tweetMetrics: "[tweet_id+taken_at], tweet_id, taken_at", followerPoints: "[user_id+taken_at], user_id, taken_at" });
    await v4.table("users").put({ id: "42", screen_name: "me", name: "Me", followers_count: 0, friends_count: 0, statuses_count: 0, updated_at: NOW });
    await v4.table("followerPoints").bulkPut([{ user_id: "42", taken_at: NOW - DAY, followers_count: 3121 }, { user_id: "42", taken_at: NOW, followers_count: 0 }]);
    await v4.table("followerSnapshots").bulkPut([{ user_id: "42", day: "2026-09-16", followers_count: 3121, following_count: 10, statuses_count: 500, taken_at: NOW - DAY }, { user_id: "42", day: "2026-09-17", followers_count: 0, following_count: 0, statuses_count: 0, taken_at: NOW }]);
    v4.close();
    const db = new XploreDb(name);
    expect((await db.followerPoints.toArray()).map((p) => p.followers_count)).toEqual([3121]);
    expect((await db.followerSnapshots.toArray()).map((p) => p.followers_count)).toEqual([3121]);
    expect(await db.users.get("42")).toMatchObject({ followers_count: 3121, friends_count: 10, statuses_count: 500 });
  });
});
