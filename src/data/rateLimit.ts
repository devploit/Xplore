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
/** Share of every rate-limit window Xplore leaves untouched for X's own web app. */
export const RESERVED_SHARE = 0.5;

/** Calls that must stay unused in a window: half of it, and never fewer than MIN_REMAINING. */
export function reserved(limit: Limit): number {
  return Math.max(MIN_REMAINING, Math.ceil(limit.limit * RESERVED_SHARE));
}

/**
 * Decides whether a job may make another request. Xplore never spends more than half of any
 * window while the reset is more than a minute away, so X's own web app always has room left.
 * `minRemaining` overrides the reserve; 0 means "only refuse when the window is exhausted".
 */
export function decide(limit: Limit | undefined, now: number = Date.now(), minRemaining?: number): Decision {
  if (!limit) return { ok: true, waitMs: 0 };
  const untilReset = limit.reset * 1000 - now;
  const floor = minRemaining ?? reserved(limit);
  if (limit.remaining <= 0 && untilReset > 0) return { ok: false, waitMs: untilReset };
  if (limit.remaining < floor && untilReset > 60_000) return { ok: false, waitMs: untilReset };
  return { ok: true, waitMs: 0 };
}

/** Hard ceiling on requests per minute across every operation in one tab, whatever the caller. */
export const MAX_REQUESTS_PER_MINUTE = 20;

export const PAGE_DELAY_MS = 2_000;
export const BATCH_DELAY_MS = 15_000;
export const BATCH_SIZE = 6;

/** Delay after page `pageIndex` (1-based): about 14 pages a minute, under the global ceiling. */
export function pageDelay(pageIndex: number): number {
  return pageIndex % BATCH_SIZE === 0 ? BATCH_DELAY_MS : PAGE_DELAY_MS;
}

export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 10 * 60_000;
/** Transient failures (503, network) are retried this many times. A 429 is never retried: the job stops. */
export const MAX_ATTEMPTS = 3;

/** Exponential backoff for 503 and network errors: 30 s, 60 s, 120 s, capped at 10 min. */
export function backoff(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
}
