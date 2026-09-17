import Dexie, { type EntityTable } from "dexie";

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

export class XlyticsDb extends Dexie {
  tweets!: EntityTable<TweetRow, "id">;
  users!: EntityTable<UserRow, "id">;
  followerSnapshots!: EntityTable<FollowerSnapshotRow, "user_id">;
  queryIds!: EntityTable<QueryIdRow, "op">;
  rateLimits!: EntityTable<RateLimitRow, "endpoint">;
  backfill!: EntityTable<BackfillRow, "key">;
  timelines!: EntityTable<TimelineRow, "id">;
  settings!: EntityTable<SettingRow, "key">;

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
  }
}

let instance: XlyticsDb | undefined;

/** Shared database instance for the sidebar. Tests create their own with `new XlyticsDb(name)`. */
export function getDb(): XlyticsDb {
  instance ??= new XlyticsDb();
  return instance;
}
