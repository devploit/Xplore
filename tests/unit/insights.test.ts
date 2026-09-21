import { describe, expect, it } from "vitest";
import type { TweetRow } from "@/data/db";
import { bestTimes, bestTimesRobust, hashtagStats, hotPosts, lengthStats, streak } from "@/analytics";

const NOW = new Date(2026, 8, 17, 12).getTime();
const DAY = 86_400_000;
const HOUR = 3_600_000;

function tw(id: string, agoMs: number, extra: Partial<TweetRow> = {}): TweetRow {
  return { id, user_id_str: "42", created_at: NOW - agoMs, full_text: `t${id}`, favorite_count: 0, retweet_count: 0, reply_count: 0, quote_count: 0, bookmark_count: 0, view_count: 0, media_types: [], urls: [], hashtags: [], user_mentions: [], updated_at: NOW, ...extra };
}

describe("bestTimes", () => {
  it("ranks weekday/hour slots by average impressions", () => {
    const a = tw("1", 0, { view_count: 1000 });
    const b = tw("2", 7 * DAY, { view_count: 3000 });
    const c = tw("3", 3 * HOUR, { view_count: 10 });
    const best = bestTimes([a, b, c], 2);
    const d = new Date(NOW);
    expect(best[0]).toMatchObject({ weekday: (d.getDay() + 6) % 7, hour: d.getHours(), count: 2, avgImpressions: 2000 });
    expect(best[1]?.avgImpressions).toBe(10);
  });
});

describe("bestTimesRobust", () => {
  it("prefers slots with two or more posts so one viral post cannot top the list", () => {
    // Two posts in the same slot a week apart, plus a lone viral post three hours earlier.
    const same = [tw("1", 0, { view_count: 1000 }), tw("2", 7 * DAY, { view_count: 3000 })];
    const viral = tw("v", 3 * HOUR, { view_count: 100_000 });
    const filler = [tw("3", DAY, { view_count: 50 }), tw("4", 8 * DAY, { view_count: 70 }), tw("5", 2 * DAY, { view_count: 5 }), tw("6", 9 * DAY, { view_count: 9 })];
    const strict = bestTimesRobust([...same, viral, ...filler], 3);
    expect(strict.minCount).toBe(2);
    expect(strict.slots[0]?.avgImpressions).toBe(2000);
    expect(strict.slots.some((s) => s.avgImpressions === 100_000)).toBe(false);
  });
  it("falls back to single posts and says so when the data is thin", () => {
    const thin = bestTimesRobust([tw("1", 0, { view_count: 10 }), tw("2", 5 * HOUR, { view_count: 20 })], 3);
    expect(thin.minCount).toBe(1);
    expect(thin.slots).toHaveLength(2);
  });
});

describe("streak", () => {
  it("counts consecutive days including today and the longest run", () => {
    const s = streak([tw("1", 0), tw("2", DAY), tw("3", 2 * DAY), tw("4", 10 * DAY), tw("5", 11 * DAY), tw("6", 12 * DAY), tw("7", 13 * DAY)], NOW);
    expect(s).toEqual({ current: 3, longest: 4, atRisk: false });
  });
  it("keeps yesterday's streak alive but flags it at risk", () => {
    expect(streak([tw("1", DAY), tw("2", 2 * DAY)], NOW)).toEqual({ current: 2, longest: 2, atRisk: true });
    expect(streak([tw("1", 3 * DAY)], NOW)).toEqual({ current: 0, longest: 1, atRisk: false });
    expect(streak([], NOW)).toEqual({ current: 0, longest: 0, atRisk: false });
  });
});

describe("hashtagStats and lengthStats", () => {
  it("aggregates per tag case-insensitively", () => {
    const stats = hashtagStats([tw("1", 0, { hashtags: ["AI", "ai"], view_count: 100, favorite_count: 10 }), tw("2", 0, { hashtags: ["ai"], view_count: 300 }), tw("3", 0, { hashtags: ["rust"], view_count: 50 })]);
    expect(stats[0]).toMatchObject({ tag: "ai", count: 2, impressions: 400, avgImpressions: 200, engagementRate: 10 / 400 });
    expect(stats[1]?.tag).toBe("rust");
  });
  it("buckets by text length", () => {
    const s = lengthStats([tw("1", 0, { full_text: "hi", view_count: 10 }), tw("2", 0, { full_text: "x".repeat(150), view_count: 30, favorite_count: 3 }), tw("3", 0, { full_text: "x".repeat(500) })]);
    expect(s.map((b) => b.count)).toEqual([1, 1, 1]);
    expect(s[1]).toMatchObject({ bucket: "medium", avgImpressions: 30, engagementRate: 0.1 });
    expect(s[2]?.engagementRate).toBeUndefined();
  });
});

describe("hotPosts", () => {
  it("ranks recent foreign posts by engagement velocity", () => {
    const mine = tw("1", HOUR, { favorite_count: 500 });
    const fast = tw("2", HOUR, { user_id_str: "7", favorite_count: 100 });
    const slow = tw("3", 20 * HOUR, { user_id_str: "8", favorite_count: 100 });
    const reply = tw("4", HOUR, { user_id_str: "9", favorite_count: 900, in_reply_to_status_id_str: "x" });
    const old = tw("5", 30 * HOUR, { user_id_str: "10", favorite_count: 9000 });
    const hot = hotPosts([mine, fast, slow, reply, old], "42", NOW);
    expect(hot.map((h) => h.tweet.id)).toEqual(["2", "3"]);
    expect(hot[0]?.velocity).toBeCloseTo(100);
  });
});
