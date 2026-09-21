import type { FollowerPointRow, FollowerSnapshotRow, TweetMetricRow, TweetRow, UserRow, XploreDb } from "./db";
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

/** Own posts younger than this get a metric snapshot on every capture. */
export const METRIC_WINDOW_MS = 7 * 86_400_000;

const COUNTERS = ["view_count", "favorite_count", "retweet_count", "reply_count", "quote_count", "bookmark_count"] as const;

export class Ingestor {
  private readonly registry: QueryIdRegistry;

  constructor(private readonly db: XploreDb, private readonly currentUserId: () => string | undefined) {
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

  private async store({ tweets, users: incoming }: ReturnType<typeof normalizeGraphql>, now: number): Promise<IngestResult> {
    if (tweets.length) await this.db.tweets.bulkPut(tweets);
    const users = await this.mergeUsers(incoming);
    if (users.length) await this.db.users.bulkPut(users);
    const me = this.currentUserId();
    if (me) await this.snapshotMetrics(tweets.filter((t) => t.user_id_str === me && now - t.created_at < METRIC_WINDOW_MS), now);
    // Only a full profile object may feed the follower history; placeholders would write zeros.
    const self = me ? incoming.find((u) => u.id === me && !u.partial) : undefined;
    let snapshot = false;
    if (self) {
      // A point whenever the count moved; the daily snapshot below stays the source for the chart.
      const lastPoint = await this.db.followerPoints.where("user_id").equals(self.id).reverse().sortBy("taken_at").then((r) => r[0]);
      if (!lastPoint || lastPoint.followers_count !== self.followers_count) {
        const point: FollowerPointRow = { user_id: self.id, taken_at: now, followers_count: self.followers_count };
        await this.db.followerPoints.put(point);
      }
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

  /**
   * A user that arrived without counters must not erase the counters a full profile wrote earlier:
   * its identity fields are refreshed and the stored counts are kept.
   */
  private async mergeUsers(incoming: UserRow[]): Promise<UserRow[]> {
    const partial = incoming.filter((u) => u.partial);
    if (!partial.length) return incoming;
    const existing = new Map((await this.db.users.bulkGet(partial.map((u) => u.id))).filter((u): u is UserRow => !!u).map((u) => [u.id, u]));
    return incoming.map((u) => {
      const prev = u.partial ? existing.get(u.id) : undefined;
      if (!prev) return u;
      const merged: UserRow = { ...prev, ...u, followers_count: prev.followers_count, friends_count: prev.friends_count, statuses_count: prev.statuses_count };
      if (prev.favourites_count !== undefined) merged.favourites_count = prev.favourites_count;
      if (prev.media_count !== undefined) merged.media_count = prev.media_count;
      if (prev.listed_count !== undefined) merged.listed_count = prev.listed_count;
      if (prev.description !== undefined && u.description === undefined) merged.description = prev.description;
      if (!prev.partial) delete merged.partial;
      return merged;
    });
  }

  /** Appends a metric row per recent own tweet unless the counters are unchanged since the last one. */
  private async snapshotMetrics(recent: TweetRow[], now: number): Promise<void> {
    if (!recent.length) return;
    const rows: TweetMetricRow[] = [];
    for (const t of recent) {
      const last = await this.db.tweetMetrics.where("tweet_id").equals(t.id).reverse().sortBy("taken_at").then((r) => r[0]);
      if (last && COUNTERS.every((k) => last[k] === t[k])) continue;
      rows.push({ tweet_id: t.id, taken_at: now, view_count: t.view_count, favorite_count: t.favorite_count, retweet_count: t.retweet_count, reply_count: t.reply_count, quote_count: t.quote_count, bookmark_count: t.bookmark_count });
    }
    if (rows.length) await this.db.tweetMetrics.bulkPut(rows);
  }
}
