import { describe, expect, it } from "vitest";
import { XlyticsDb } from "@/data/db";
import { QueryIdRegistry, SEED } from "@/data/queryIds";
import { FEATURES_A2 } from "@/x-api/features";

describe("QueryIdRegistry", () => {
  it("falls back to the seed when nothing was observed", async () => {
    const db = new XlyticsDb("qid-seed");
    const reg = new QueryIdRegistry(db);
    expect(await reg.resolve("UserTweets")).toEqual(SEED.UserTweets);
    expect(await reg.resolve("Nope")).toBeUndefined();
    await db.delete();
  });

  it("prefers the observed id and features over the seed", async () => {
    const db = new XlyticsDb("qid-observed");
    const reg = new QueryIdRegistry(db);
    await reg.observe("UserTweets", "NEWID", { only: true });
    const spec = await reg.resolve("UserTweets");
    expect(spec).toEqual({ queryId: "NEWID", method: "GET", features: { only: true }, fieldToggles: { withArticlePlainText: false } });
    await db.delete();
  });

  it("makes observed-only operations usable and borrows sibling features", async () => {
    const db = new XlyticsDb("qid-sibling");
    const reg = new QueryIdRegistry(db);
    expect(await reg.resolve("UserTweetsAndReplies")).toBeUndefined();
    await reg.observe("UserTweetsAndReplies", "TAR1");
    expect(await reg.resolve("UserTweetsAndReplies")).toEqual({ queryId: "TAR1", method: "GET", features: FEATURES_A2 });
    await db.delete();
  });

  it("ignores stale observations and returns to the seed", async () => {
    const db = new XlyticsDb("qid-stale");
    const reg = new QueryIdRegistry(db);
    await reg.observe("FavoriteTweet", "BAD");
    await reg.markStale("FavoriteTweet");
    expect((await reg.resolve("FavoriteTweet"))?.queryId).toBe(SEED.FavoriteTweet?.queryId);
    await reg.observe("FavoriteTweet", "GOOD");
    expect((await reg.resolve("FavoriteTweet"))?.queryId).toBe("GOOD");
    await db.delete();
  });
});
