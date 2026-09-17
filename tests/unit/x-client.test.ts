import { describe, expect, it, vi } from "vitest";
import { XlyticsDb } from "@/data/db";
import { XApiError, XClient } from "@/x-api/client";
import { ops } from "@/x-api/operations";
import { bottomCursor } from "@/x-api/cursor";
import { SEED } from "@/data/queryIds";
import * as fx from "../fixtures/builders";

const COOKIE = "twid=u%3D42; ct0=CSRF";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function makeClient(name: string, fetchImpl: typeof fetch) {
  const db = new XlyticsDb(name);
  const client = new XClient({ db, fetch: fetchImpl, cookie: () => COOKIE, origin: "https://x.com", now: () => 1_700_000_000_000 });
  return { db, client };
}

describe("XClient", () => {
  it("builds a GET with variables, features, fieldToggles and session headers", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { user: {} } }, 200, { "x-rate-limit-limit": "50", "x-rate-limit-remaining": "49", "x-rate-limit-reset": "1700000900" }));
    const { db, client } = makeClient("client-get", fetchImpl as unknown as typeof fetch);
    const res = await ops.userTweets(client, "42", "CUR");
    expect(res.status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith(`https://x.com/i/api/graphql/${SEED.UserTweets?.queryId}/UserTweets?variables=`)).toBe(true);
    const params = new URL(url).searchParams;
    expect(JSON.parse(params.get("variables") ?? "{}")).toMatchObject({ userId: "42", cursor: "CUR", count: 20 });
    expect(JSON.parse(params.get("features") ?? "{}")).toEqual(SEED.UserTweets?.features);
    expect(JSON.parse(params.get("fieldToggles") ?? "{}")).toEqual({ withArticlePlainText: false });
    const headers = init.headers as Record<string, string>;
    expect(headers["x-csrf-token"]).toBe("CSRF");
    expect(headers["x-twitter-auth-type"]).toBe("OAuth2Session");
    expect(headers.authorization).toMatch(/^Bearer /);
    expect(init.credentials).toBe("include");
    expect(await db.rateLimits.get("UserTweets")).toMatchObject({ limit: 50, remaining: 49, reset: 1_700_000_900 });
    await db.delete();
  });

  it("POSTs mutations as JSON with queryId and variables", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { favorite_tweet: "Done" } }));
    const { db, client } = makeClient("client-post", fetchImpl as unknown as typeof fetch);
    await ops.favorite(client, "555");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://x.com/i/api/graphql/${SEED.FavoriteTweet?.queryId}/FavoriteTweet`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ queryId: SEED.FavoriteTweet?.queryId, variables: { tweet_id: "555" } });
    await db.delete();
  });

  it("maps HTTP statuses to typed errors and marks 404 query ids stale", async () => {
    const statuses = [429, 401, 404, 503];
    let i = 0;
    const fetchImpl = vi.fn(async () => jsonResponse({}, statuses[i++] ?? 200));
    const { db, client } = makeClient("client-errors", fetchImpl as unknown as typeof fetch);
    await db.queryIds.put({ op: "TweetDetail", queryId: "OBS", seen_at: 1, source: "observed" });
    const kinds: string[] = [];
    for (let k = 0; k < statuses.length; k++) {
      try {
        await ops.tweetDetail(client, "1");
      } catch (e) {
        kinds.push((e as XApiError).kind);
      }
    }
    expect(kinds).toEqual(["RateLimited", "Unauthorized", "StaleQueryId", "Unavailable"]);
    expect((await db.queryIds.get("TweetDetail"))?.stale).toBe(true);
    await db.delete();
  });

  it("refuses to call operations without a known query id and without a session", async () => {
    const fetchImpl = vi.fn();
    const { db, client } = makeClient("client-unknown", fetchImpl as unknown as typeof fetch);
    await expect(ops.userTweetsAndReplies(client, "42")).rejects.toMatchObject({ kind: "StaleQueryId" });
    const noCookie = new XClient({ db, fetch: fetchImpl as unknown as typeof fetch, cookie: () => "", origin: "https://x.com" });
    await expect(ops.userTweets(noCookie, "42")).rejects.toMatchObject({ kind: "Unauthorized" });
    expect(fetchImpl).not.toHaveBeenCalled();
    await db.delete();
  });

  it("surfaces GraphQL errors when no data is returned", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ errors: [{ message: "Bad", code: 1 }] }));
    const { db, client } = makeClient("client-gql", fetchImpl as unknown as typeof fetch);
    await expect(ops.userTweets(client, "42")).rejects.toMatchObject({ kind: "GraphQL", message: "Bad" });
    await db.delete();
  });
});

describe("bottomCursor", () => {
  it("finds the Bottom cursor wherever it is and ignores Top", () => {
    const body = fx.userTweetsResponse([fx.cursorEntry("TOP", "Top"), fx.itemEntry("t", fx.tweetResult("1", "42", "me")), fx.cursorEntry("BOTTOM", "Bottom")]);
    expect(bottomCursor(body)).toBe("BOTTOM");
    expect(bottomCursor(fx.userTweetsResponse([fx.cursorEntry("TOP", "Top")]))).toBeUndefined();
  });
});
