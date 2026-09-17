import type { XlyticsDb } from "../db";
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
  stoppedBy: "maxPages" | "noCursor" | "noNew" | "tooOld" | "rateLimit" | "error" | "unauthorized";
  error?: string;
}

const defaultSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Generic paginator shared by every timeline job: fetches pages, ingests them, obeys rate limits,
 * retries transient failures with backoff and stops on the conditions requested by the caller.
 */
export async function pageThrough(db: XlyticsDb, client: XClient, ingestor: Ingestor, fetchPage: (cursor?: string) => Promise<Page>, opts: PagingOptions): Promise<PagingResult> {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => Date.now());
  let cursor = opts.cursor;
  let pages = 0;
  let newTweets = 0;
  let attempt = 0;
  while (pages < opts.maxPages) {
    const limit = await client.limitFor(opts.op);
    const decision = decide(limit, now());
    if (!decision.ok) return { pages, newTweets, stoppedBy: "rateLimit", ...(cursor ? { cursor } : {}) };
    let page: Page;
    try {
      page = await fetchPage(cursor);
      attempt = 0;
    } catch (err) {
      if (err instanceof XApiError && (err.kind === "RateLimited" || err.kind === "Unavailable" || err.kind === "Network") && attempt < MAX_ATTEMPTS) {
        attempt += 1;
        await sleep(err.retryAfterMs ?? backoff(attempt));
        continue;
      }
      const stoppedBy = err instanceof XApiError && err.kind === "Unauthorized" ? "unauthorized" : "error";
      return { pages, newTweets, stoppedBy, error: err instanceof Error ? err.message : String(err), ...(cursor ? { cursor } : {}) };
    }
    pages += 1;
    const before = await db.tweets.count();
    const result = await ingestor.ingestBody(page.body, now());
    const after = await db.tweets.count();
    const added = after - before;
    newTweets += added;
    const next = bottomCursor(page.body);
    await opts.onProgress?.(pages, next);
    if (!next || next === cursor) return { pages, newTweets, stoppedBy: "noCursor" };
    cursor = next;
    if (opts.stopWhenNoNew && added === 0) return { pages, newTweets, stoppedBy: "noNew", cursor };
    if (opts.minCreatedAt !== undefined && result.tweets > 0) {
      const oldest = await oldestCreatedAtInBody(db, page.body);
      if (oldest !== undefined && oldest < opts.minCreatedAt) return { pages, newTweets, stoppedBy: "tooOld", cursor };
    }
    if (pages < opts.maxPages) await sleep(pageDelay(pages));
  }
  return { pages, newTweets, stoppedBy: "maxPages", ...(cursor ? { cursor } : {}) };
}

async function oldestCreatedAtInBody(db: XlyticsDb, body: unknown): Promise<number | undefined> {
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
