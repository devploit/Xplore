import { describe, expect, it, vi } from "vitest";
import { XlyticsDb } from "@/data/db";
import { Ingestor } from "@/data/ingest";
import { acquireLease, releaseLease } from "@/data/jobs/lease";
import { runBackfill, runFollowerSnapshot, runMentions, runPrune, DAY_MS } from "@/data/jobs/jobs";
import { pageThrough } from "@/data/jobs/paging";
import { XApiError, XClient } from "@/x-api/client";
import * as fx from "../fixtures/builders";

const NOW = Date.UTC(2026, 8, 17, 12);
const COOKIE = "twid=u%3D42; ct0=CSRF";
const noSleep = async () => undefined;

function setup(name: string, fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  const db = new XlyticsDb(name);
  const client = new XClient({ db, fetch: fetchImpl as unknown as typeof fetch, cookie: () => COOKIE, origin: "https://x.com", now: () => NOW });
  const ingestor = new Ingestor(db, () => "42");
  return { db, client, ingestor };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function pageOf(ids: string[], cursor?: string, ageDays = 1) {
  const created = new Date(NOW - ageDays * DAY_MS).toUTCString().replace(/,/, "");
  const entries: unknown[] = ids.map((id) => fx.itemEntry(`tweet-${id}`, fx.tweetResult(id, "42", "me", { created_at: created })));
  if (cursor) entries.push(fx.cursorEntry(cursor, "Bottom"));
  return fx.userTweetsResponse(entries);
}

describe("lease", () => {
  it("lets one owner in and blocks others until release or expiry", async () => {
    const db = new XlyticsDb("lease-test");
    expect(await acquireLease(db, "j", "A", NOW)).toBe(true);
    expect(await acquireLease(db, "j", "B", NOW)).toBe(false);
    expect(await acquireLease(db, "j", "A", NOW)).toBe(true);
    await releaseLease(db, "j", "A");
    expect(await acquireLease(db, "j", "B", NOW)).toBe(true);
    expect(await acquireLease(db, "j", "C", NOW + 3 * 60_000)).toBe(true);
    await db.delete();
  });
});

describe("pageThrough", () => {
  it("follows Bottom cursors, ingests every page and stops when the cursor ends", async () => {
    const pages = [pageOf(["1", "2"], "C1"), pageOf(["3"], "C2"), pageOf(["4"])];
    let i = 0;
    const { db, client, ingestor } = setup("paging-basic", async () => json({ data: (pages[i++] as { data: unknown }).data }));
    const res = await pageThrough(db, client, ingestor, (c) => import("@/x-api/operations").then((m) => m.ops.userTweets(client, "42", c)), { op: "UserTweets", maxPages: 10, sleep: noSleep, now: () => NOW });
    expect(res).toMatchObject({ pages: 3, newTweets: 4, stoppedBy: "noCursor" });
    expect(await db.tweets.count()).toBe(4);
    await db.delete();
  });

  it("stops before exhausting the rate limit and resumes later from the cursor", async () => {
    const headers = { "x-rate-limit-limit": "50", "x-rate-limit-remaining": "10", "x-rate-limit-reset": String(Math.floor(NOW / 1000) + 900) };
    const { db, client, ingestor } = setup("paging-limit", async () => json({ data: pageOf(["1"], "C1").data }, 200, headers));
    const { ops } = await import("@/x-api/operations");
    const res = await pageThrough(db, client, ingestor, (c) => ops.userTweets(client, "42", c), { op: "UserTweets", maxPages: 10, sleep: noSleep, now: () => NOW });
    expect(res).toMatchObject({ pages: 1, stoppedBy: "rateLimit", cursor: "C1" });
    await db.delete();
  });

  it("retries 429 and 503 with backoff and gives up on 401", async () => {
    const statuses = [503, 429, 200];
    let i = 0;
    const sleep = vi.fn(async () => undefined);
    const { db, client, ingestor } = setup("paging-retry", async () => json({ data: pageOf(["1"]).data }, statuses[i++] ?? 200));
    const { ops } = await import("@/x-api/operations");
    const res = await pageThrough(db, client, ingestor, (c) => ops.userTweets(client, "42", c), { op: "UserTweets", maxPages: 3, sleep, now: () => NOW });
    expect(res.stoppedBy).toBe("noCursor");
    expect(res.pages).toBe(1);
    expect(sleep).toHaveBeenCalledTimes(2);
    const { db: db2, client: c2, ingestor: in2 } = setup("paging-401", async () => json({}, 401));
    const r2 = await pageThrough(db2, c2, in2, (c) => ops.userTweets(c2, "42", c), { op: "UserTweets", maxPages: 3, sleep: noSleep, now: () => NOW });
    expect(r2.stoppedBy).toBe("unauthorized");
    await db.delete();
    await db2.delete();
  });

  it("stops when pages are older than the minimum date or add nothing new", async () => {
    const { db, client, ingestor } = setup("paging-old", async () => json({ data: pageOf(["9"], "CX", 400).data }));
    const { ops } = await import("@/x-api/operations");
    const res = await pageThrough(db, client, ingestor, (c) => ops.userTweets(client, "42", c), { op: "UserTweets", maxPages: 5, minCreatedAt: NOW - 365 * DAY_MS, sleep: noSleep, now: () => NOW });
    expect(res.stoppedBy).toBe("tooOld");
    const res2 = await pageThrough(db, client, ingestor, (c) => ops.userTweets(client, "42", c), { op: "UserTweets", maxPages: 5, stopWhenNoNew: true, sleep: noSleep, now: () => NOW });
    expect(res2.stoppedBy).toBe("noNew");
    await db.delete();
  });
});

describe("jobs", () => {
  it("backfill walks both sources when their ids are known and persists progress", async () => {
    const calls: string[] = [];
    const { db, client, ingestor } = setup("job-backfill", async (url) => {
      calls.push(new URL(url).pathname.split("/").pop() ?? "");
      return json({ data: pageOf(["1"]).data });
    });
    await db.queryIds.put({ op: "UserTweetsAndReplies", queryId: "TAR", seen_at: 1, source: "observed" });
    const results = await runBackfill({ db, client, ingestor, userId: "42", now: () => NOW, sleep: noSleep });
    expect(Object.keys(results)).toEqual(["UserTweets", "UserTweetsAndReplies"]);
    expect(calls).toEqual(["UserTweets", "UserTweetsAndReplies"]);
    expect((await db.backfill.get("backfill:UserTweets"))?.last_run).toBe(NOW);
    await db.delete();
  });

  it("follower snapshot falls back to UserByScreenName when UserByRestId is unknown", async () => {
    const { db, client, ingestor } = setup("job-followers", async () => json(fx.userByScreenNameResponse("42", "me")));
    expect(await runFollowerSnapshot({ db, client, ingestor, userId: "42", screenName: "me", now: () => NOW })).toBe(true);
    expect(await runFollowerSnapshot({ db, client, ingestor, userId: "42", screenName: "me", now: () => NOW })).toBe(false);
    await db.delete();
  });

  it("mentions searches for the handle excluding own posts", async () => {
    let seen = "";
    const { db, client, ingestor } = setup("job-mentions", async (url) => {
      seen = url;
      return json(fx.searchResponse([fx.itemEntry("t", fx.tweetResult("77", "7", "friend", { in_reply_to_user_id_str: "42" }))]));
    });
    const res = await runMentions({ db, client, ingestor, userId: "42", screenName: "me", now: () => NOW, sleep: noSleep });
    expect(res?.pages).toBe(1);
    expect(JSON.parse(new URL(seen).searchParams.get("variables") ?? "{}")).toMatchObject({ rawQuery: "@me -from:me", product: "Latest" });
    expect((await db.tweets.get("77"))?.in_reply_to_user_id_str).toBe("42");
    await db.delete();
  });

  it("prune deletes old foreign tweets but keeps own and referenced ones", async () => {
    const db = new XlyticsDb("job-prune");
    const ingestor = new Ingestor(db, () => "42");
    const old = new Date(NOW - 200 * DAY_MS).toUTCString().replace(/,/, "");
    await ingestor.ingestBody(
      fx.searchResponse([
        fx.itemEntry("a", fx.tweetResult("100", "7", "friend", { created_at: old })),
        fx.itemEntry("b", fx.tweetResult("101", "8", "other", { created_at: old })),
        fx.itemEntry("c", fx.tweetResult("102", "42", "me", { created_at: old, in_reply_to_status_id_str: "101" })),
        fx.itemEntry("d", fx.tweetResult("103", "9", "recent", { created_at: new Date(NOW - 2 * DAY_MS).toUTCString().replace(/,/, "") })),
      ]),
      NOW,
    );
    expect(await runPrune(db, "42", 90, NOW)).toBe(1);
    expect((await db.tweets.toArray()).map((t) => t.id).sort()).toEqual(["101", "102", "103"]);
    await db.delete();
  });

  it("XApiError carries retry hints", () => {
    const e = new XApiError("RateLimited", "x", 429, 5000);
    expect(e.retryAfterMs).toBe(5000);
  });
});
