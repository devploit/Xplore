import type { MediaItem, TweetRow, UserRow } from "./db";

export interface Normalized {
  tweets: TweetRow[];
  users: UserRow[];
}

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** X dates look like "Wed Sep 10 10:00:00 +0000 2025". */
export function parseXDate(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

function unwrapTweet(result: Rec): Rec | undefined {
  if (result.__typename === "TweetWithVisibilityResults" && isRec(result.tweet)) return result.tweet;
  if (result.__typename === "Tweet") return result;
  // Some payloads omit __typename but still look like tweets.
  if (result.__typename === undefined && typeof result.rest_id === "string" && isRec(result.legacy) && "full_text" in result.legacy) return result;
  return undefined;
}

function isUserResult(result: Rec): boolean {
  if (result.__typename === "User") return typeof result.rest_id === "string";
  return result.__typename === undefined && typeof result.rest_id === "string" && isRec(result.legacy) && ("screen_name" in result.legacy || isRec(result.core));
}

export function normalizeUser(result: Rec, now: number): UserRow | undefined {
  const id = str(result.rest_id);
  const legacy = isRec(result.legacy) ? result.legacy : {};
  const core = isRec(result.core) ? result.core : {};
  const screen_name = str(core.screen_name) ?? str(legacy.screen_name);
  if (!id || !screen_name) return undefined;
  const avatar = isRec(result.avatar) ? str(result.avatar.image_url) : undefined;
  const row: UserRow = {
    id,
    screen_name,
    name: str(core.name) ?? str(legacy.name) ?? screen_name,
    followers_count: num(legacy.followers_count),
    friends_count: num(legacy.friends_count),
    statuses_count: num(legacy.statuses_count),
    updated_at: now,
  };
  const description = str(legacy.description);
  if (description !== undefined) row.description = description;
  const created = parseXDate(core.created_at ?? legacy.created_at);
  if (created !== undefined) row.created_at = created;
  if (legacy.favourites_count !== undefined) row.favourites_count = num(legacy.favourites_count);
  if (legacy.media_count !== undefined) row.media_count = num(legacy.media_count);
  if (legacy.listed_count !== undefined) row.listed_count = num(legacy.listed_count);
  const image = avatar ?? str(legacy.profile_image_url_https);
  if (image !== undefined) row.profile_image_url_https = image;
  if (typeof result.is_blue_verified === "boolean") row.is_blue_verified = result.is_blue_verified;
  const verification = isRec(result.verification) ? result.verification : undefined;
  const verified = verification ? verification.verified : legacy.verified;
  if (typeof verified === "boolean") row.verified = verified;
  return row;
}

export function normalizeTweet(raw: Rec, now: number): TweetRow | undefined {
  const result = unwrapTweet(raw);
  if (!result) return undefined;
  const id = str(result.rest_id);
  const legacy = isRec(result.legacy) ? result.legacy : undefined;
  if (!id || !legacy) return undefined;
  const created_at = parseXDate(legacy.created_at);
  const coreUser = isRec(result.core) && isRec(result.core.user_results) && isRec(result.core.user_results.result) ? result.core.user_results.result : undefined;
  const user_id_str = str(legacy.user_id_str) ?? (coreUser ? str(coreUser.rest_id) : undefined);
  if (created_at === undefined || !user_id_str) return undefined;

  let full_text = str(legacy.full_text) ?? "";
  const note = isRec(result.note_tweet) && isRec(result.note_tweet.note_tweet_results) && isRec(result.note_tweet.note_tweet_results.result) ? result.note_tweet.note_tweet_results.result : undefined;
  const noteText = note ? str(note.text) : undefined;
  if (noteText) full_text = noteText;

  const entities = isRec(legacy.entities) ? legacy.entities : {};
  const extended = isRec(legacy.extended_entities) ? legacy.extended_entities : {};
  const mediaList = Array.isArray(extended.media) ? extended.media : Array.isArray(entities.media) ? entities.media : [];
  const mediaItems = mediaList.filter(isRec);
  const media_types = mediaItems.map((m) => str(m.type) ?? "unknown");
  const media: MediaItem[] = mediaItems
    .map((m) => ({ type: str(m.type) ?? "unknown", thumb: str(m.media_url_https) ?? "", url: str(m.expanded_url) ?? str(m.url) ?? "" }))
    .filter((m) => m.thumb.startsWith("https://pbs.twimg.com/"));
  const urls = (Array.isArray(entities.urls) ? entities.urls : []).filter(isRec).map((u) => str(u.expanded_url) ?? str(u.url) ?? "").filter(Boolean);
  const hashtags = (Array.isArray(entities.hashtags) ? entities.hashtags : []).filter(isRec).map((h) => str(h.text) ?? "").filter(Boolean);
  const user_mentions = (Array.isArray(entities.user_mentions) ? entities.user_mentions : [])
    .filter(isRec)
    .map((m) => ({ id_str: str(m.id_str) ?? "", screen_name: str(m.screen_name) ?? "" }))
    .filter((m) => m.id_str && m.screen_name);

  const views = isRec(result.views) ? result.views : {};
  const row: TweetRow = {
    id,
    user_id_str,
    created_at,
    full_text,
    favorite_count: num(legacy.favorite_count),
    retweet_count: num(legacy.retweet_count),
    reply_count: num(legacy.reply_count),
    quote_count: num(legacy.quote_count),
    bookmark_count: num(legacy.bookmark_count),
    view_count: num(views.count),
    media_types,
    urls,
    hashtags,
    user_mentions,
    updated_at: now,
  };
  const conv = str(legacy.conversation_id_str);
  if (conv) row.conversation_id_str = conv;
  const replyStatus = str(legacy.in_reply_to_status_id_str);
  if (replyStatus) row.in_reply_to_status_id_str = replyStatus;
  const replyUser = str(legacy.in_reply_to_user_id_str);
  if (replyUser) row.in_reply_to_user_id_str = replyUser;
  const replyScreen = str(legacy.in_reply_to_screen_name);
  if (replyScreen) row.in_reply_to_screen_name = replyScreen;
  const quoted = str(legacy.quoted_status_id_str);
  if (quoted) row.quoted_status_id_str = quoted;
  if (typeof legacy.is_quote_status === "boolean") row.is_quote_status = legacy.is_quote_status;
  const rtResult = isRec(legacy.retweeted_status_result) && isRec(legacy.retweeted_status_result.result) ? unwrapTweet(legacy.retweeted_status_result.result) : undefined;
  const rtId = rtResult ? str(rtResult.rest_id) : undefined;
  if (rtId) row.retweeted_status_id_str = rtId;
  const lang = str(legacy.lang);
  if (lang) row.lang = lang;
  if (media.length) row.media = media;
  if (typeof legacy.favorited === "boolean") row.favorited = legacy.favorited;
  if (typeof legacy.retweeted === "boolean") row.retweeted = legacy.retweeted;
  if (typeof legacy.bookmarked === "boolean") row.bookmarked = legacy.bookmarked;
  return row;
}

/**
 * X's older REST timelines (notifications) ship a `globalObjects` map: tweets and users keyed by id,
 * with the legacy fields at the top level. Wrapping each one lets the GraphQL normalizer do the rest.
 */
export function normalizeRest(body: unknown, now: number = Date.now()): Normalized {
  if (!isRec(body) || !isRec(body.globalObjects)) return { tweets: [], users: [] };
  const g = body.globalObjects;
  const users = isRec(g.users) ? Object.values(g.users).filter(isRec) : [];
  const tweets = isRec(g.tweets) ? Object.values(g.tweets).filter(isRec) : [];
  const userById = new Map(users.map((u) => [str(u.id_str) ?? "", u]));
  const wrapUser = (u: Rec) => ({ __typename: "User", rest_id: u.id_str, legacy: u, is_blue_verified: u.ext_is_blue_verified ?? u.is_blue_verified });
  const wrappedUsers = users.map(wrapUser);
  const wrappedTweets = tweets.map((t) => {
    const author = userById.get(str(t.user_id_str) ?? "");
    const views = isRec(t.ext_views) ? t.ext_views : isRec(t.ext) && isRec(t.ext.views) && isRec(t.ext.views.r) && isRec(t.ext.views.r.ok) ? t.ext.views.r.ok : undefined;
    return {
      __typename: "Tweet",
      rest_id: t.id_str,
      legacy: t,
      views: views ? { count: views.count } : undefined,
      core: author ? { user_results: { result: wrapUser(author) } } : undefined,
    };
  });
  return normalizeGraphql({ users: wrappedUsers, tweets: wrappedTweets }, now);
}

/**
 * Walks any GraphQL response and collects every tweet and user it contains, regardless of the
 * timeline instruction layout. Later occurrences of the same id overwrite earlier ones.
 */
export function normalizeGraphql(body: unknown, now: number = Date.now()): Normalized {
  const tweets = new Map<string, TweetRow>();
  const users = new Map<string, UserRow>();
  const seen = new WeakSet<object>();

  const visit = (node: unknown, depth: number): void => {
    if (depth > 64) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (!isRec(node) || seen.has(node)) return;
    seen.add(node);
    const tweet = normalizeTweet(node, now);
    if (tweet) tweets.set(tweet.id, tweet);
    else if (isUserResult(node)) {
      const user = normalizeUser(node, now);
      if (user) users.set(user.id, user);
    }
    for (const value of Object.values(node)) visit(value, depth + 1);
  };
  visit(body, 0);
  return { tweets: [...tweets.values()], users: [...users.values()] };
}
