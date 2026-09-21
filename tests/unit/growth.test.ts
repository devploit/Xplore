import { describe, expect, it } from "vitest";
import type { FollowerPointRow, TweetRow, UserRow } from "@/data/db";
import { evergreen, externalCandidates, followerAttribution, ownCandidates, repliesToday, replyRadar, replyTargets, weeklySummary } from "@/analytics";

const NOW = new Date(2026, 8, 17, 12).getTime();
const DAY = 86_400_000;
const HOUR = 3_600_000;

function tw(id: string, agoMs: number, extra: Partial<TweetRow> = {}): TweetRow {
  return { id, user_id_str: "42", created_at: NOW - agoMs, full_text: `t${id}`, favorite_count: 0, retweet_count: 0, reply_count: 0, quote_count: 0, bookmark_count: 0, view_count: 0, media_types: [], urls: [], hashtags: [], user_mentions: [], updated_at: NOW, ...extra };
}
const pt = (agoMs: number, followers: number): FollowerPointRow => ({ user_id: "42", taken_at: NOW - agoMs, followers_count: followers });
const user = (id: string, followers: number): UserRow => ({ id, screen_name: `u${id}`, name: id, followers_count: followers, friends_count: 0, statuses_count: 0, updated_at: NOW });

describe("followerAttribution", () => {
  it("gives a change to the only post active in the window and splits shared windows by impressions", () => {
    const a = tw("a", 30 * HOUR, { view_count: 1000 });
    const b = tw("b", 5 * HOUR, { view_count: 3000 });
    const c = tw("c", 4 * HOUR, { view_count: 1000 });
    // +10 while only a was active, then +40 while b and c were active (3:1 by impressions).
    const points = [pt(31 * HOUR, 100), pt(28 * HOUR, 110), pt(6 * HOUR, 110), pt(2 * HOUR, 150)];
    const r = followerAttribution(points, ownCandidates([a, b, c]));
    expect(r.total).toBe(50);
    expect(r.points).toBe(4);
    expect(r.posts.map((p) => [p.tweet.id, p.gained, p.kind])).toEqual([["b", 30, "post"], ["a", 10, "post"], ["c", 10, "post"]]);
    expect(r.unattributed).toBe(0);
  });
  it("counts your replies as candidates but not your retweets", () => {
    const reply = tw("r", HOUR, { in_reply_to_status_id_str: "x", full_text: "@someone hi", view_count: 500 });
    const rt = tw("rt", HOUR, { full_text: "RT @x: y", view_count: 100_000 });
    const r = followerAttribution([pt(3 * HOUR, 100), pt(0, 107)], ownCandidates([reply, rt]));
    expect(r.posts.map((p) => [p.tweet.id, p.gained, p.kind])).toEqual([["r", 7, "reply"]]);
  });
  it("reports changes with nothing visible as unattributed", () => {
    const r = followerAttribution([pt(3 * HOUR, 100), pt(0, 107)], []);
    expect(r.posts).toHaveLength(0);
    expect(r.unattributed).toBe(7);
  });
  it("lets a big mention by someone else absorb the gain instead of your small post nearby", () => {
    const mine = tw("mine", 2 * HOUR, { view_count: 2000 });
    const big = tw("big", 3 * HOUR, { user_id_str: "influencer", view_count: 198_000, user_mentions: [{ id_str: "42", screen_name: "me" }] });
    const authors = new Map([["influencer", user("influencer", 900_000)]]);
    const candidates = [...ownCandidates([mine]), ...externalCandidates([big, mine], "42", new Set(["mine"]), authors)];
    const r = followerAttribution([pt(4 * HOUR, 1000), pt(0, 1100)], candidates);
    expect(r.posts.map((p) => [p.tweet.id, p.gained, p.kind, p.author?.screen_name])).toEqual([["big", 99, "mention", "uinfluencer"], ["mine", 1, "post", undefined]]);
  });
  it("classifies external candidates as quote, reply to you or mention, and skips unrelated posts", () => {
    const own = new Set(["p1"]);
    const others = [
      tw("q", HOUR, { user_id_str: "a", quoted_status_id_str: "p1" }),
      tw("r", HOUR, { user_id_str: "b", in_reply_to_status_id_str: "p1", in_reply_to_user_id_str: "42" }),
      tw("m", HOUR, { user_id_str: "c", user_mentions: [{ id_str: "42", screen_name: "me" }] }),
      tw("x", HOUR, { user_id_str: "d" }),
      tw("self", HOUR, { user_mentions: [{ id_str: "42", screen_name: "me" }] }),
    ];
    expect(externalCandidates(others, "42", own, new Map()).map((c) => [c.tweet.id, c.kind])).toEqual([["q", "quote"], ["r", "reply-to-you"], ["m", "mention"]]);
  });
});

describe("replyTargets", () => {
  it("groups own replies by the account replied to and ranks by average impressions", () => {
    const own = [
      tw("1", HOUR, { in_reply_to_status_id_str: "p1", in_reply_to_user_id_str: "big", full_text: "@big yes", view_count: 4000, favorite_count: 3 }),
      tw("2", 2 * HOUR, { in_reply_to_status_id_str: "p2", in_reply_to_user_id_str: "big", full_text: "@big no", view_count: 2000 }),
      tw("3", 3 * HOUR, { in_reply_to_status_id_str: "p3", in_reply_to_user_id_str: "small", full_text: "@small hey", view_count: 100 }),
      tw("4", 4 * HOUR, { in_reply_to_status_id_str: "p4", in_reply_to_user_id_str: "42", full_text: "@me thread part" }),
      tw("5", 5 * HOUR, { view_count: 9000 }),
    ];
    const t = replyTargets(own, "42");
    expect(t.map((x) => [x.userId, x.count, x.avgImpressions])).toEqual([["big", 2, 3000], ["small", 1, 100]]);
    expect(t[0]!.totalEngagements).toBe(3);
  });
});

describe("evergreen", () => {
  it("returns old originals with engagement, best first, and skips recent posts and replies", () => {
    const own = [
      tw("old-good", 90 * DAY, { favorite_count: 50, bookmark_count: 10, view_count: 5000 }),
      tw("old-meh", 70 * DAY, { favorite_count: 2, view_count: 1000 }),
      tw("old-none", 80 * DAY),
      tw("recent", 10 * DAY, { favorite_count: 500 }),
      tw("old-reply", 100 * DAY, { favorite_count: 80, in_reply_to_status_id_str: "x", full_text: "@a b" }),
    ];
    expect(evergreen(own, NOW).map((t) => t.id)).toEqual(["old-good", "old-meh"]);
  });
});

describe("replyRadar", () => {
  const users = new Map([["big", user("big", 50_000)], ["small", user("small", 200)]]);
  const posts = [
    tw("fresh-big", 30 * 60_000, { user_id_str: "big", view_count: 6000, reply_count: 3 }),
    tw("fresh-small", 20 * 60_000, { user_id_str: "small", view_count: 8000, reply_count: 1 }),
    tw("crowded", 40 * 60_000, { user_id_str: "big", view_count: 90_000, reply_count: 400 }),
    tw("old", 5 * HOUR, { user_id_str: "big", view_count: 100_000 }),
    tw("mine", 10 * 60_000, { user_id_str: "42", view_count: 100 }),
    tw("rt", 10 * 60_000, { user_id_str: "big", full_text: "RT @x: hi", view_count: 100 }),
  ];
  it("keeps fresh posts with few replies from bigger accounts, ranked by impressions per minute", () => {
    const r = replyRadar(posts, users, "42", { maxAgeHours: 1, maxReplies: 5, minAuthorFollowers: 1000 }, NOW);
    expect(r.map((x) => x.tweet.id)).toEqual(["fresh-big"]);
    expect(r[0]!.perMinute).toBe(200);
  });
  it("relaxes each filter independently", () => {
    expect(replyRadar(posts, users, "42", { maxAgeHours: 1 }, NOW).map((x) => x.tweet.id)).toEqual(["crowded", "fresh-small", "fresh-big"]);
    expect(replyRadar(posts, users, "42", { maxAgeHours: 24, maxReplies: 5 }, NOW).map((x) => x.tweet.id)).toEqual(["fresh-small", "old", "fresh-big"]);
  });
});

describe("repliesToday and weeklySummary", () => {
  it("counts today's replies in local time", () => {
    const own = [tw("a", HOUR, { in_reply_to_status_id_str: "x", full_text: "@a" }), tw("b", 2 * DAY, { in_reply_to_status_id_str: "x", full_text: "@b" }), tw("c", HOUR)];
    expect(repliesToday(own, NOW)).toBe(1);
  });
  it("summarises the last seven days with followers gained from the nearest points", () => {
    const own = [tw("p1", DAY, { view_count: 1000, favorite_count: 10 }), tw("p2", 3 * DAY, { view_count: 3000, favorite_count: 5 }), tw("r", 2 * DAY, { in_reply_to_status_id_str: "x", full_text: "@x", view_count: 500 }), tw("old", 20 * DAY, { view_count: 99_999 })];
    const s = weeklySummary(own, [pt(8 * DAY, 1000), pt(DAY, 1040)], NOW);
    expect(s).toMatchObject({ posts: 2, replies: 1, impressions: 4500, engagements: 15, followersGained: 40 });
    expect(s.best?.id).toBe("p2");
  });
});
