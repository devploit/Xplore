import { describe, expect, it } from "vitest";
import { backoff, decide, pageDelay, parseLimitHeaders, reserved } from "@/data/rateLimit";

describe("parseLimitHeaders", () => {
  it("parses the three headers and rejects partial sets", () => {
    const h = new Headers({ "x-rate-limit-limit": "150", "x-rate-limit-remaining": "149", "x-rate-limit-reset": "1700000000" });
    expect(parseLimitHeaders(h)).toEqual({ limit: 150, remaining: 149, reset: 1_700_000_000 });
    expect(parseLimitHeaders(new Headers({ "x-rate-limit-limit": "150" }))).toBeUndefined();
    expect(parseLimitHeaders(new Headers())).toBeUndefined();
  });
});

describe("decide", () => {
  const now = 1_700_000_000_000;
  it("allows when no limit is known or plenty remains", () => {
    expect(decide(undefined, now)).toEqual({ ok: true, waitMs: 0 });
    expect(decide({ limit: 150, remaining: 100, reset: 1_700_000_900 }, now).ok).toBe(true);
  });
  it("stops when few calls remain and the reset is far away", () => {
    const d = decide({ limit: 150, remaining: 10, reset: 1_700_000_600 }, now);
    expect(d.ok).toBe(false);
    expect(d.waitMs).toBe(600_000);
  });
  it("never spends more than half of a window, and at least 30 calls stay unused", () => {
    expect(reserved({ limit: 150, remaining: 150, reset: 0 })).toBe(75);
    expect(reserved({ limit: 50, remaining: 50, reset: 0 })).toBe(30);
    expect(decide({ limit: 150, remaining: 76, reset: 1_700_000_600 }, now).ok).toBe(true);
    expect(decide({ limit: 150, remaining: 74, reset: 1_700_000_600 }, now).ok).toBe(false);
    expect(decide({ limit: 50, remaining: 29, reset: 1_700_000_600 }, now).ok).toBe(false);
  });
  it("with minRemaining 0 only refuses an exhausted window", () => {
    expect(decide({ limit: 50, remaining: 1, reset: 1_700_000_600 }, now, 0).ok).toBe(true);
    expect(decide({ limit: 50, remaining: 0, reset: 1_700_000_600 }, now, 0)).toEqual({ ok: false, waitMs: 600_000 });
    expect(decide({ limit: 50, remaining: 0, reset: 1_699_999_000 }, now, 0).ok).toBe(true);
  });
  it("continues when few remain but the reset is imminent, unless exhausted", () => {
    expect(decide({ limit: 150, remaining: 10, reset: 1_700_000_030 }, now).ok).toBe(true);
    expect(decide({ limit: 150, remaining: 0, reset: 1_700_000_030 }, now)).toEqual({ ok: false, waitMs: 30_000 });
  });
});

describe("pacing", () => {
  it("waits 2 s between pages and 15 s every sixth page", () => {
    expect(pageDelay(1)).toBe(2_000);
    expect(pageDelay(5)).toBe(2_000);
    expect(pageDelay(6)).toBe(15_000);
    expect(pageDelay(12)).toBe(15_000);
  });
  it("backs off exponentially with a cap", () => {
    expect([1, 2, 3, 4, 5, 6].map(backoff)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 600_000]);
  });
});
