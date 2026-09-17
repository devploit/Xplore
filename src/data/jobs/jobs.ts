import type { XlyticsDb } from "../db";
import type { Ingestor } from "../ingest";
import { localDay } from "../ingest";
import { XApiError, type XClient } from "@/x-api/client";
import { ops } from "@/x-api/operations";
import { pageThrough, type PagingResult, type Sleep } from "./paging";

export interface JobContext {
  db: XlyticsDb;
  client: XClient;
  ingestor: Ingestor;
  userId: string;
  screenName?: string;
  now?: () => number;
  sleep?: Sleep;
}

export const DAY_MS = 86_400_000;
export const BACKFILL_MAX_AGE_MS = 365 * DAY_MS;
export const BACKFILL_MAX_PAGES = 60;
export const REFRESH_PAGES = 2;
export const MENTIONS_PAGES = 2;
export const DEFAULT_RETENTION_DAYS = 90;

async function markRun(db: XlyticsDb, key: string, patch: Record<string, unknown>): Promise<void> {
  const row = (await db.backfill.get(key)) ?? { key };
  await db.backfill.put({ ...row, ...patch });
}

/** Pages the user's own tweets and replies backwards until history is complete for a year. */
export async function runBackfill(ctx: JobContext): Promise<Record<string, PagingResult>> {
  const now = ctx.now ?? (() => Date.now());
  const results: Record<string, PagingResult> = {};
  const minCreatedAt = now() - BACKFILL_MAX_AGE_MS;
  const sources: [string, (cursor?: string) => ReturnType<typeof ops.userTweets>][] = [
    ["UserTweets", (cursor) => ops.userTweets(ctx.client, ctx.userId, cursor)],
    ["UserTweetsAndReplies", (cursor) => ops.userTweetsAndReplies(ctx.client, ctx.userId, cursor)],
  ];
  for (const [op, fetchPage] of sources) {
    const key = `backfill:${op}`;
    const state = await ctx.db.backfill.get(key);
    // The first full walk must go all the way back even though passive capture already stored the
    // newest page; only once a walk has completed do we stop at the first page with nothing new.
    const incremental = !!state?.completed_at;
    const opts = { op, maxPages: BACKFILL_MAX_PAGES, minCreatedAt, stopWhenNoNew: incremental, ...(state?.cursor ? { cursor: state.cursor } : {}), ...(ctx.sleep ? { sleep: ctx.sleep } : {}), now, onProgress: (pages: number, cursor: string | undefined) => markRun(ctx.db, key, { pages, cursor }) };
    const result = await pageThrough(ctx.db, ctx.client, ctx.ingestor, fetchPage, opts);
    results[op] = result;
    const patch: Record<string, unknown> = { last_run: now(), last_error: result.error };
    // A finished walk resets the cursor so the next run starts from the newest tweets again.
    if (result.stoppedBy === "noCursor" || result.stoppedBy === "tooOld") {
      patch.cursor = undefined;
      patch.completed_at = now();
    } else if (result.stoppedBy === "noNew") patch.cursor = undefined;
    await markRun(ctx.db, key, patch);
    if (result.stoppedBy === "unauthorized") break;
  }
  return results;
}

/** Re-reads the newest pages so counters of recent posts stay fresh. */
export async function runRefresh(ctx: JobContext): Promise<Record<string, PagingResult>> {
  const now = ctx.now ?? (() => Date.now());
  const results: Record<string, PagingResult> = {};
  for (const [op, fetchPage] of [
    ["UserTweets", (c?: string) => ops.userTweets(ctx.client, ctx.userId, c)],
    ["UserTweetsAndReplies", (c?: string) => ops.userTweetsAndReplies(ctx.client, ctx.userId, c)],
  ] as const) {
    results[op] = await pageThrough(ctx.db, ctx.client, ctx.ingestor, fetchPage, { op, maxPages: REFRESH_PAGES, now, ...(ctx.sleep ? { sleep: ctx.sleep } : {}) });
    if (results[op]?.stoppedBy === "unauthorized") break;
  }
  await markRun(ctx.db, "refresh", { last_run: now() });
  return results;
}

/** Writes today's follower snapshot if none exists. Uses UserByRestId, or UserByScreenName as fallback. */
export async function runFollowerSnapshot(ctx: JobContext): Promise<boolean> {
  const now = ctx.now ?? (() => Date.now());
  const existing = await ctx.db.followerSnapshots.get([ctx.userId, localDay(now())]);
  if (existing) return false;
  try {
    const page = await ops.userByRestId(ctx.client, ctx.userId);
    const res = await ctx.ingestor.ingestBody(page.body, now());
    if (res.snapshot) return true;
  } catch (err) {
    if (!(err instanceof XApiError) || err.kind !== "StaleQueryId") throw err;
  }
  const screenName = ctx.screenName ?? (await ctx.db.users.get(ctx.userId))?.screen_name;
  if (!screenName) return false;
  const page = await ops.userByScreenName(ctx.client, screenName);
  return (await ctx.ingestor.ingestBody(page.body, now())).snapshot;
}

/** Latest replies and quotes addressed to the user. */
export async function runMentions(ctx: JobContext): Promise<PagingResult | undefined> {
  const now = ctx.now ?? (() => Date.now());
  const screenName = ctx.screenName ?? (await ctx.db.users.get(ctx.userId))?.screen_name;
  if (!screenName) return undefined;
  const query = `@${screenName} -from:${screenName}`;
  const result = await pageThrough(ctx.db, ctx.client, ctx.ingestor, (cursor) => ops.searchTimeline(ctx.client, query, "Latest", cursor), { op: "SearchTimeline", maxPages: MENTIONS_PAGES, now, ...(ctx.sleep ? { sleep: ctx.sleep } : {}) });
  await markRun(ctx.db, "mentions", { last_run: now(), last_error: result.error });
  return result;
}

/**
 * Deletes other people's tweets older than the retention window, keeping anything the user
 * replied to or quoted so conversation context survives.
 */
export async function runPrune(db: XlyticsDb, userId: string, retentionDays: number = DEFAULT_RETENTION_DAYS, now: number = Date.now()): Promise<number> {
  const cutoff = now - retentionDays * DAY_MS;
  const referenced = new Set<string>();
  await db.tweets.where("user_id_str").equals(userId).each((t) => {
    if (t.in_reply_to_status_id_str) referenced.add(t.in_reply_to_status_id_str);
    if (t.quoted_status_id_str) referenced.add(t.quoted_status_id_str);
    if (t.retweeted_status_id_str) referenced.add(t.retweeted_status_id_str);
  });
  const victims: string[] = [];
  await db.tweets.where("created_at").below(cutoff).each((t) => {
    if (t.user_id_str !== userId && !referenced.has(t.id)) victims.push(t.id);
  });
  if (victims.length) await db.tweets.bulkDelete(victims);
  return victims.length;
}
