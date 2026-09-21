import { describe, expect, it } from "vitest";
import { XploreDb } from "@/data/db";
import { Ingestor, localDay } from "@/data/ingest";
import { makeMessage, type GraphqlMessage } from "@/shared/messages";
import * as fx from "../fixtures/builders";

const NOW = Date.UTC(2026, 8, 17, 12);

function msg(op: string, body: unknown, status = 200): GraphqlMessage {
  return makeMessage<GraphqlMessage>({ kind: "graphql", op, queryId: `${op}-ID`, status, body, features: { f: true } });
}

describe("Ingestor", () => {
  it("stores tweets and users and records the observed query id", async () => {
    const db = new XploreDb("ingest-basic");
    const ing = new Ingestor(db, () => "42");
    const res = await ing.ingestMessage(msg("UserTweets", fx.userTweetsResponse([fx.itemEntry("t1", fx.tweetResult("1", "42", "me"))])), NOW);
    expect(res).toEqual({ tweets: 1, users: 1, snapshot: true });
    expect(await db.tweets.count()).toBe(1);
    expect((await db.queryIds.get("UserTweets"))).toMatchObject({ queryId: "UserTweets-ID", source: "observed", features: { f: true } });
    await db.delete();
  });

  it("writes one follower snapshot per day for the current user only", async () => {
    const db = new XploreDb("ingest-snapshot");
    const ing = new Ingestor(db, () => "42");
    await ing.ingestMessage(msg("UserByScreenName", fx.userByScreenNameResponse("42", "me")), NOW);
    await ing.ingestMessage(msg("UserByScreenName", fx.userByScreenNameResponse("42", "me")), NOW + 1000);
    await ing.ingestMessage(msg("UserByScreenName", fx.userByScreenNameResponse("7", "other")), NOW);
    const snaps = await db.followerSnapshots.toArray();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ user_id: "42", day: localDay(NOW), followers_count: 1200, following_count: 300 });
    await db.delete();
  });

  it("records the query id but stores nothing for error responses", async () => {
    const db = new XploreDb("ingest-error");
    const ing = new Ingestor(db, () => "42");
    const res = await ing.ingestMessage(msg("UserTweets", { errors: [{ message: "x" }] }, 404), NOW);
    expect(res).toEqual({ tweets: 0, users: 0, snapshot: false });
    expect(await db.queryIds.get("UserTweets")).toBeDefined();
    await db.delete();
  });

  it("newer counters overwrite older rows", async () => {
    const db = new XploreDb("ingest-merge");
    const ing = new Ingestor(db, () => undefined);
    await ing.ingestBody(fx.userTweetsResponse([fx.itemEntry("t1", fx.tweetResult("1", "42", "me", { favorite_count: 1 }))]), NOW);
    await ing.ingestBody(fx.userTweetsResponse([fx.itemEntry("t1", fx.tweetResult("1", "42", "me", { favorite_count: 5 }))]), NOW + 1);
    expect((await db.tweets.get("1"))?.favorite_count).toBe(5);
    await db.delete();
  });
});
