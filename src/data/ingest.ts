import type { FollowerSnapshotRow, XlyticsDb } from "./db";
import { normalizeGraphql, normalizeRest } from "./normalizer";
import { QueryIdRegistry } from "./queryIds";
import type { GraphqlMessage, RestMessage } from "@/shared/messages";

export interface IngestResult {
  tweets: number;
  users: number;
  snapshot: boolean;
}

/** Local calendar day as YYYY-MM-DD. */
export function localDay(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export class Ingestor {
  private readonly registry: QueryIdRegistry;

  constructor(private readonly db: XlyticsDb, private readonly currentUserId: () => string | undefined) {
    this.registry = new QueryIdRegistry(db);
  }

  /** Stores everything found in one GraphQL body and records the query id X used. */
  async ingestMessage(msg: GraphqlMessage, now: number = Date.now()): Promise<IngestResult> {
    await this.registry.observe(msg.op, msg.queryId, msg.features, msg.fieldToggles, now);
    if (msg.status >= 400) return { tweets: 0, users: 0, snapshot: false };
    return this.ingestBody(msg.body, now);
  }

  /** REST notifications carry mentions in `globalObjects`. */
  async ingestRest(msg: RestMessage, now: number = Date.now()): Promise<IngestResult> {
    if (msg.status >= 400) return { tweets: 0, users: 0, snapshot: false };
    return this.store(normalizeRest(msg.body, now), now);
  }

  /** Same as ingestMessage for bodies fetched by the active client. */
  async ingestBody(body: unknown, now: number = Date.now()): Promise<IngestResult> {
    return this.store(normalizeGraphql(body, now), now);
  }

  private async store({ tweets, users }: ReturnType<typeof normalizeGraphql>, now: number): Promise<IngestResult> {
    if (tweets.length) await this.db.tweets.bulkPut(tweets);
    if (users.length) await this.db.users.bulkPut(users);
    const me = this.currentUserId();
    const self = me ? users.find((u) => u.id === me) : undefined;
    let snapshot = false;
    if (self) {
      const day = localDay(now);
      const existing = await this.db.followerSnapshots.get([self.id, day]);
      if (!existing) {
        const row: FollowerSnapshotRow = { user_id: self.id, day, followers_count: self.followers_count, following_count: self.friends_count, statuses_count: self.statuses_count, taken_at: now };
        await this.db.followerSnapshots.put(row);
        snapshot = true;
      }
    }
    return { tweets: tweets.length, users: users.length, snapshot };
  }
}
