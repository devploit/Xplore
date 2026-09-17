import type { XlyticsDb } from "../db";
import { currentUserId } from "../identity";
import { acquireLease, releaseLease } from "./lease";
import { DAY_MS, runBackfill, runFollowerSnapshot, runMentions, runPrune, runRefresh, type JobContext } from "./jobs";

export const REFRESH_INTERVAL_MS = 60 * 60_000;
export const MENTIONS_MIN_INTERVAL_MS = 10 * 60_000;
export const START_DELAY_MS = 15_000;

export interface SchedulerDeps {
  ctx: Omit<JobContext, "userId" | "screenName">;
  retentionDays: () => Promise<number>;
  tabId?: string;
  onEvent?: (name: string, detail: unknown) => void;
}

/**
 * Runs acquisition jobs while an X tab is open. Every job takes a lease so that several tabs
 * cooperate instead of hammering X. Background jobs never surface toasts; the UI reads state.
 */
export class Scheduler {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private readonly tabId: string;
  private stopped = false;

  constructor(private readonly deps: SchedulerDeps) {
    this.tabId = deps.tabId ?? Math.random().toString(36).slice(2);
  }

  start(): void {
    this.timers.push(setTimeout(() => void this.onLoad(), START_DELAY_MS));
    this.timers.push(setInterval(() => void this.guarded("refresh", (ctx) => runRefresh(ctx)), REFRESH_INTERVAL_MS) as unknown as ReturnType<typeof setTimeout>);
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private context(): JobContext | undefined {
    const userId = currentUserId();
    return userId ? { ...this.deps.ctx, userId } : undefined;
  }

  private async onLoad(): Promise<void> {
    const db = this.deps.ctx.db;
    const userId = currentUserId();
    if (!userId) return;
    await this.guarded("prune", async () => runPrune(db, userId, await this.deps.retentionDays()));
    await this.guarded("followers", (ctx) => runFollowerSnapshot(ctx));
    const backfill = await db.backfill.get("backfill:UserTweets");
    if (!backfill?.last_run || Date.now() - backfill.last_run > DAY_MS) await this.guarded("backfill", (ctx) => runBackfill(ctx));
    else await this.guarded("refresh", (ctx) => runRefresh(ctx));
  }

  /** Called by the Mentions page; throttled to once every 10 minutes. */
  async refreshMentions(force = false): Promise<void> {
    const row = await this.deps.ctx.db.backfill.get("mentions");
    if (!force && row?.last_run && Date.now() - row.last_run < MENTIONS_MIN_INTERVAL_MS) return;
    await this.guarded("mentions", (ctx) => runMentions(ctx));
  }

  private async guarded(name: string, job: (ctx: JobContext) => Promise<unknown>): Promise<void> {
    if (this.stopped) return;
    const ctx = this.context();
    if (!ctx) return;
    const key = `lease:${name}`;
    if (!(await acquireLease(ctx.db, key, this.tabId))) return;
    try {
      const detail = await job(ctx);
      this.deps.onEvent?.(name, detail);
    } catch (err) {
      this.deps.onEvent?.(`${name}:error`, err instanceof Error ? err.message : String(err));
    } finally {
      await releaseLease(ctx.db, key, this.tabId);
    }
  }
}
