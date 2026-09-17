import { describe, expect, it } from "vitest";
import { XlyticsDb, type TweetRow } from "@/data/db";

function tweet(id: string, overrides: Partial<TweetRow> = {}): TweetRow {
  return {
    id,
    user_id_str: "42",
    created_at: 1_700_000_000_000,
    full_text: "hello",
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
    updated_at: 1,
    ...overrides,
  };
}

describe("XlyticsDb", () => {
  it("round-trips tweets and queries by compound index", async () => {
    const db = new XlyticsDb("test-db-roundtrip");
    await db.tweets.bulkPut([tweet("1"), tweet("2", { created_at: 1_700_000_100_000 }), tweet("3", { user_id_str: "7" })]);
    const mine = await db.tweets.where("[user_id_str+created_at]").between(["42", 0], ["42", Infinity]).toArray();
    expect(mine.map((t) => t.id).sort()).toEqual(["1", "2"]);
    await db.delete();
  });

  it("stores one follower snapshot per user and day", async () => {
    const db = new XlyticsDb("test-db-snapshots");
    const row = { user_id: "42", day: "2026-09-17", followers_count: 10, following_count: 5, statuses_count: 1, taken_at: 1 };
    await db.followerSnapshots.put(row);
    await db.followerSnapshots.put({ ...row, followers_count: 11 });
    const all = await db.followerSnapshots.where("user_id").equals("42").toArray();
    expect(all).toHaveLength(1);
    expect(all[0]?.followers_count).toBe(11);
    await db.delete();
  });
});
