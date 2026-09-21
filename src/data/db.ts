import Dexie, { type EntityTable } from "dexie";

export interface MediaItem {
  type: string;
  /** poster image for videos, the picture itself for photos (pbs.twimg.com) */
  thumb: string;
  /** link to the media on X */
  url: string;
}

/** A tweet as stored locally: X's `legacy` object plus a few normalized fields. */
export interface TweetRow {
  /** rest_id */
  id: string;
  user_id_str: string;
  /** epoch milliseconds */
  created_at: number;
  full_text: string;
  conversation_id_str?: string;
  in_reply_to_status_id_str?: string;
  in_reply_to_user_id_str?: string;
  in_reply_to_screen_name?: string;
  quoted_status_id_str?: string;
  is_quote_status?: boolean;
  retweeted_status_id_str?: string;
  favorite_count: number;
  retweet_count: number;
  reply_count: number;
  quote_count: number;
  bookmark_count: number;
  view_count: number;
  lang?: string;
  /** media types in order: photo, video, animated_gif */
  media_types: string[];
  /** thumbnails and links for each media item, same order as media_types */
  media?: MediaItem[];
  /** viewer state at capture time */
  favorited?: boolean;
  retweeted?: boolean;
  bookmarked?: boolean;
  urls: string[];
  hashtags: string[];
  user_mentions: { id_str: string; screen_name: string }[];
  /** when this row was last written, epoch ms */
  updated_at: number;
}

export interface UserRow {
  /** rest_id */
  id: string;
  screen_name: string;
  name: string;
  description?: string;
  /** epoch milliseconds */
  created_at?: number;
  followers_count: number;
  friends_count: number;
  statuses_count: number;
  favourites_count?: number;
  media_count?: number;
  listed_count?: number;
  profile_image_url_https?: string;
  is_blue_verified?: boolean;
  verified?: boolean;
  /** true when X sent this user without counters (embedded in a tweet); counts are placeholders */
  partial?: boolean;
  updated_at: number;
}

export interface FollowerSnapshotRow {
  user_id: string;
  /** local calendar day, YYYY-MM-DD */
  day: string;
  followers_count: number;
  following_count: number;
  statuses_count: number;
  taken_at: number;
}

export interface QueryIdRow {
  op: string;
  queryId: string;
  features?: Record<string, boolean>;
  fieldToggles?: Record<string, boolean>;
  seen_at: number;
  source: "seed" | "observed";
  stale?: boolean;
}

export interface RateLimitRow {
  endpoint: string;
  limit: number;
  remaining: number;
  /** epoch seconds */
  reset: number;
  updated_at: number;
}

export interface BackfillRow {
  key: string;
  cursor?: string;
  last_run?: number;
  pages?: number;
  oldest_created_at?: number;
  /** set when a walk reached the natural end of the timeline; enables incremental runs */
  completed_at?: number;
  /** lease owner tab id and expiry, so two tabs do not run the same job */
  lease_owner?: string;
  lease_until?: number;
  last_error?: string;
}

export type TimelineType = "list" | "user" | "search";

export interface TimelineRow {
  id: string;
  type: TimelineType;
  name: string;
  created_at: number;
  listId?: string;
  userId?: string;
  screenName?: string;
  query?: string;
  product?: "Top" | "Latest";
}

export interface SettingRow {
  key: string;
  value: unknown;
}

/** The user's follower count each time X reported it, so gains can be matched to posts. */
export interface FollowerPointRow {
  user_id: string;
  /** epoch ms */
  taken_at: number;
  followers_count: number;
}

/** Counters of one of the user's own tweets at one moment, so recent posts get a curve. */
export interface TweetMetricRow {
  tweet_id: string;
  /** epoch ms */
  taken_at: number;
  view_count: number;
  favorite_count: number;
  retweet_count: number;
  reply_count: number;
  quote_count: number;
  bookmark_count: number;
}


export class XploreDb extends Dexie {
  tweets!: EntityTable<TweetRow, "id">;
  users!: EntityTable<UserRow, "id">;
  followerSnapshots!: EntityTable<FollowerSnapshotRow, "user_id">;
  queryIds!: EntityTable<QueryIdRow, "op">;
  rateLimits!: EntityTable<RateLimitRow, "endpoint">;
  backfill!: EntityTable<BackfillRow, "key">;
  timelines!: EntityTable<TimelineRow, "id">;
  settings!: EntityTable<SettingRow, "key">;
  tweetMetrics!: EntityTable<TweetMetricRow, "tweet_id">;
  followerPoints!: EntityTable<FollowerPointRow, "user_id">;

  // The IndexedDB name predates the rename to Xplore; changing it would orphan every user's data.
  constructor(name = "xlytics") {
    super(name);
    this.version(1).stores({
      tweets: "id, user_id_str, created_at, conversation_id_str, in_reply_to_user_id_str, quoted_status_id_str, [user_id_str+created_at]",
      users: "id, screen_name",
      followerSnapshots: "[user_id+day], user_id, day",
      queryIds: "op, seen_at",
      rateLimits: "endpoint",
      backfill: "key",
      timelines: "id, created_at",
      settings: "key",
    });
    this.version(2).stores({
      tweetMetrics: "[tweet_id+taken_at], tweet_id, taken_at",
    });
    // Post detail lists the replies to a post, which needs an index on the parent id.
    this.version(3).stores({
      tweets: "id, user_id_str, created_at, conversation_id_str, in_reply_to_user_id_str, in_reply_to_status_id_str, quoted_status_id_str, [user_id_str+created_at]",
    });
    this.version(4).stores({
      followerPoints: "[user_id+taken_at], user_id, taken_at",
    });
    // Repairs data written before partial users were recognised: bogus zero follower counts.
    this.version(5).stores({}).upgrade(async (tx) => {
      const points = tx.table<FollowerPointRow>("followerPoints");
      const snaps = tx.table<FollowerSnapshotRow>("followerSnapshots");
      const users = tx.table<UserRow>("users");
      const nonZeroUsers = new Set<string>();
      await points.each((p) => { if (p.followers_count > 0) nonZeroUsers.add(p.user_id); });
      await snaps.each((sn) => { if (sn.followers_count > 0) nonZeroUsers.add(sn.user_id); });
      for (const userId of nonZeroUsers) {
        await points.where("user_id").equals(userId).filter((p) => p.followers_count === 0).delete();
        await snaps.where("user_id").equals(userId).filter((sn) => sn.followers_count === 0).delete();
        const user = await users.get(userId);
        if (user && user.followers_count === 0) {
          const latest = (await snaps.where("user_id").equals(userId).sortBy("taken_at")).pop();
          if (latest) await users.put({ ...user, followers_count: latest.followers_count, friends_count: latest.following_count, statuses_count: latest.statuses_count });
        }
      }
    });
  }
}

let instance: XploreDb | undefined;

/** Shared database instance for the sidebar. Tests create their own with `new XploreDb(name)`. */
export function getDb(): XploreDb {
  instance ??= new XploreDb();
  return instance;
}
