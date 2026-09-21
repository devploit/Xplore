import type { XploreDb } from "../db";
import type { Ingestor } from "../ingest";
import { backoff, decide, MAX_ATTEMPTS, pageDelay } from "../rateLimit";
import { XApiError, type XClient } from "@/x-api/client";
import { bottomCursor } from "@/x-api/cursor";
import type { Page } from "@/x-api/operations";

export type Sleep = (ms: number) => Promise<void>;

export interface PagingOptions {
  op: string;
  maxPages: number;
  /** stop once the oldest tweet in a page is older than this epoch ms */
  minCreatedAt?: number;
  /** stop once a page adds no new tweets (for incremental refresh) */
  stopWhenNoNew?: boolean;
  cursor?: string;
  sleep?: Sleep;
  now?: () => number;
  onProgress?: (pages: number, cursor: string | undefined) => Promise<void> | void;
}

export interface PagingResult {
  pages: number;
  newTweets: number;
  cursor?: string;
  /** oldest created_at seen in the deepest page fetched; how far back the walk has reached */
  frontier?: number;
  stoppedBy: "maxPages" | "noCursor" | "noNew" | "tooOld" | "rateLimit" | "error" | "unauthorized";
  error?: string;
}

const defaultSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Generic paginator shared by every timeline job: fetches pages, ingests them, obeys rate limits,
 * retries transient failures with backoff and stops on the conditions requested by the caller.
 */
export async function pageThrough(db: XploreDb, client: XClient, ingestor: Ingestor, fetchPage: (cursor?: string) => Promise<Page>, opts: PagingOptions): Promise<PagingResult> {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => Date.now());
  let cursor = opts.cursor;
  let pages = 0;
  let newTweets = 0;
  let attempt = 0;
  let frontier: number | undefined;
  const done = (r: Omit<PagingResult, "frontier">): PagingResult => (frontier === undefined ? r : { ...r, frontier });
  while (pages < opts.maxPages) {
    const limit = await client.limitFor(opts.op);
    const decision = decide(limit, now());
    if (!decision.ok) return done({ pages, newTweets, stoppedBy: "rateLimit", ...(cursor ? { cursor } : {}) });
    let page: Page;
    try {
      page = await fetchPage(cursor);
      attempt = 0;
    } catch (err) {
      // A rate limit, from X or from the local ceiling, ends the run: the cursor is kept and a later
      // run continues. Hammering an endpoint that already said no is exactly what gets accounts flagged.
      if (err instanceof XApiError && err.kind === "RateLimited") return done({ pages, newTweets, stoppedBy: "rateLimit", ...(cursor ? { cursor } : {}) });
      if (err instanceof XApiError && (err.kind === "Unavailable" || err.kind === "Network") && attempt < MAX_ATTEMPTS) {
        attempt += 1;
        await sleep(err.retryAfterMs ?? backoff(attempt));
        continue;
      }
      const stoppedBy = err instanceof XApiError && err.kind === "Unauthorized" ? "unauthorized" : "error";
      return done({ pages, newTweets, stoppedBy, error: err instanceof Error ? err.message : String(err), ...(cursor ? { cursor } : {}) });
    }
    pages += 1;
    const before = await db.tweets.count();
    const result = await ingestor.ingestBody(page.body, now());
    const after = await db.tweets.count();
    const added = after - before;
    newTweets += added;
    const next = bottomCursor(page.body);
    // The deepest page's oldest tweet is the frontier; a pinned post only appears on the first page,
    // so it cannot drag the frontier back once a second page has been read.
    const oldest = result.tweets > 0 ? await oldestCreatedAtInBody(db, page.body) : undefined;
    if (oldest !== undefined) frontier = oldest;
    await opts.onProgress?.(pages, next);
    if (!next || next === cursor) return done({ pages, newTweets, stoppedBy: "noCursor" });
    cursor = next;
    if (opts.stopWhenNoNew && added === 0) return done({ pages, newTweets, stoppedBy: "noNew", cursor });
    if (opts.minCreatedAt !== undefined && oldest !== undefined && oldest < opts.minCreatedAt) return done({ pages, newTweets, stoppedBy: "tooOld", cursor });
    if (pages < opts.maxPages) await sleep(pageDelay(pages));
  }
  return done({ pages, newTweets, stoppedBy: "maxPages", ...(cursor ? { cursor } : {}) });
}

async function oldestCreatedAtInBody(db: XploreDb, body: unknown): Promise<number | undefined> {
  const ids = collectTweetIds(body);
  if (!ids.length) return undefined;
  const rows = await db.tweets.bulkGet(ids);
  const dates = rows.filter((r): r is NonNullable<typeof r> => !!r).map((r) => r.created_at);
  return dates.length ? Math.min(...dates) : undefined;
}

function collectTweetIds(body: unknown): string[] {
  const ids: string[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 64) return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
    if (typeof node !== "object" || node === null) return;
    const rec = node as Record<string, unknown>;
    if (rec.__typename === "Tweet" && typeof rec.rest_id === "string") ids.push(rec.rest_id);
    for (const v of Object.values(rec)) visit(v, depth + 1);
  };
  visit(body, 0);
  return ids;
}
