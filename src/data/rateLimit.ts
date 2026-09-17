export interface Limit {
  limit: number;
  remaining: number;
  /** epoch seconds */
  reset: number;
}

/** Reads X's rate-limit headers; returns undefined when they are absent. */
export function parseLimitHeaders(headers: Headers): Limit | undefined {
  const raw = ["x-rate-limit-limit", "x-rate-limit-remaining", "x-rate-limit-reset"].map((k) => headers.get(k));
  if (raw.some((v) => v === null || v === "")) return undefined;
  const [limit, remaining, reset] = raw.map(Number);
  if (limit === undefined || remaining === undefined || reset === undefined) return undefined;
  if (![limit, remaining, reset].every(Number.isFinite)) return undefined;
  return { limit, remaining, reset };
}

export interface Decision {
  ok: boolean;
  /** how long to wait before the next call when `ok` is false */
  waitMs: number;
}

export const MIN_REMAINING = 30;

/**
 * Decides whether a paging job may make another request.
 * Stops when fewer than `minRemaining` calls are left and the reset is more than a minute away.
 */
export function decide(limit: Limit | undefined, now: number = Date.now(), minRemaining: number = MIN_REMAINING): Decision {
  if (!limit) return { ok: true, waitMs: 0 };
  const untilReset = limit.reset * 1000 - now;
  if (limit.remaining < minRemaining && untilReset > 60_000) return { ok: false, waitMs: untilReset };
  if (limit.remaining <= 0 && untilReset > 0) return { ok: false, waitMs: untilReset };
  return { ok: true, waitMs: 0 };
}

export const PAGE_DELAY_MS = 1_000;
export const BATCH_DELAY_MS = 10_000;
export const BATCH_SIZE = 6;

/** Delay to apply after the page number `pageIndex` (1-based) has been fetched. */
export function pageDelay(pageIndex: number): number {
  return pageIndex % BATCH_SIZE === 0 ? BATCH_DELAY_MS : PAGE_DELAY_MS;
}

export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;

/** Exponential backoff for HTTP 429 and 503: 30 s, 60 s, 120 s, 240 s, 480 s, capped at 10 min. */
export function backoff(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
}
