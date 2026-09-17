import { describe, expect, it, vi } from "vitest";
import { handleResponse, MAX_BODY_BYTES, patchFetch } from "@/interceptor/capture";
import type { DroppedMessage, GraphqlMessage } from "@/shared/messages";

const URL_GET =
  "https://x.com/i/api/graphql/p9sOCF1tLh4KfPWtt4TNGQ/UserTweets?variables=%7B%7D&features=%7B%22f%22%3Atrue%7D";

describe("handleResponse", () => {
  it("forwards a GraphQL response with its metadata", () => {
    const post = vi.fn();
    handleResponse(URL_GET, 200, JSON.stringify({ data: { ok: 1 } }), post);
    const msg = post.mock.calls[0]?.[0] as GraphqlMessage;
    expect(msg.kind).toBe("graphql");
    expect(msg.op).toBe("UserTweets");
    expect(msg.queryId).toBe("p9sOCF1tLh4KfPWtt4TNGQ");
    expect(msg.features).toEqual({ f: true });
    expect(msg.body).toEqual({ data: { ok: 1 } });
    expect(msg.status).toBe(200);
  });

  it("reads features from a POST body when the URL has none", () => {
    const post = vi.fn();
    handleResponse("/i/api/graphql/abc/CreateRetweet", 200, "{}", post, JSON.stringify({ queryId: "abc", features: { z: false } }));
    expect((post.mock.calls[0]?.[0] as GraphqlMessage).features).toEqual({ z: false });
  });

  it("ignores non GraphQL URLs", () => {
    const post = vi.fn();
    handleResponse("https://x.com/i/api/1.1/jot/client_event.json", 200, "{}", post);
    expect(post).not.toHaveBeenCalled();
  });

  it("reports invalid JSON and oversize bodies as dropped", () => {
    const post = vi.fn();
    handleResponse(URL_GET, 200, "<html>", post);
    handleResponse(URL_GET, 200, "x".repeat(MAX_BODY_BYTES + 1), post);
    const reasons = post.mock.calls.map((c) => (c[0] as DroppedMessage).reason);
    expect(reasons).toEqual(["invalid-json", "too-large"]);
  });
});

describe("patchFetch", () => {
  it("returns the original response untouched and posts a copy", async () => {
    const original = vi.fn(async () => new Response(JSON.stringify({ data: 1 }), { status: 200 }));
    const win = { fetch: original } as unknown as Window & typeof globalThis;
    const post = vi.fn();
    patchFetch(win, post);
    const res = await win.fetch(URL_GET);
    expect(await res.json()).toEqual({ data: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(post).toHaveBeenCalledTimes(1);
    expect((post.mock.calls[0]?.[0] as GraphqlMessage).body).toEqual({ data: 1 });
  });

  it("does not post for unrelated URLs", async () => {
    const original = vi.fn(async () => new Response("{}", { status: 200 }));
    const win = { fetch: original } as unknown as Window & typeof globalThis;
    const post = vi.fn();
    patchFetch(win, post);
    await win.fetch("https://x.com/home");
    await new Promise((r) => setTimeout(r, 0));
    expect(post).not.toHaveBeenCalled();
  });
});

describe("REST notifications", () => {
  it("forwards notification timelines as rest messages and ignores other REST calls", () => {
    const post = vi.fn();
    handleResponse("https://x.com/i/api/2/notifications/all.json?count=40", 200, JSON.stringify({ globalObjects: {} }), post);
    handleResponse("https://x.com/i/api/2/notifications/mentions.json", 200, "{}", post);
    handleResponse("https://x.com/i/api/1.1/jot/client_event.json", 200, "{}", post);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]?.[0]).toMatchObject({ kind: "rest", path: "/i/api/2/notifications/all.json", status: 200, body: { globalObjects: {} } });
  });
});
