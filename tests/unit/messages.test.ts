import { describe, expect, it } from "vitest";
import { isXlMessage, makeMessage, type GraphqlMessage } from "@/shared/messages";

describe("isXlMessage", () => {
  it("accepts a well formed graphql message", () => {
    const msg = makeMessage<GraphqlMessage>({ kind: "graphql", op: "UserTweets", queryId: "abc", status: 200, body: {} });
    expect(isXlMessage(msg)).toBe(true);
  });

  it("rejects messages from another source or version", () => {
    expect(isXlMessage({ source: "other", v: 1, kind: "graphql", op: "a", queryId: "b", status: 200, body: {} })).toBe(false);
    expect(isXlMessage({ source: "x-lytics", v: 2, kind: "graphql", op: "a", queryId: "b", status: 200, body: {} })).toBe(false);
  });

  it("rejects malformed shapes", () => {
    expect(isXlMessage(null)).toBe(false);
    expect(isXlMessage("x-lytics")).toBe(false);
    expect(isXlMessage({ source: "x-lytics", v: 1, kind: "graphql", op: 1, queryId: "b", status: 200, body: {} })).toBe(false);
    expect(isXlMessage({ source: "x-lytics", v: 1, kind: "graphql", op: "a", queryId: "b", status: 200, body: {}, features: { x: "yes" } })).toBe(false);
    expect(isXlMessage({ source: "x-lytics", v: 1, kind: "navigate", path: "home" })).toBe(false);
    expect(isXlMessage({ source: "x-lytics", v: 1, kind: "unknown" })).toBe(false);
  });

  it("accepts dropped and navigate messages", () => {
    expect(isXlMessage({ source: "x-lytics", v: 1, kind: "dropped", op: "HomeTimeline", reason: "too-large" })).toBe(true);
    expect(isXlMessage({ source: "x-lytics", v: 1, kind: "navigate", path: "/notifications" })).toBe(true);
  });
});
