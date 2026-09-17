import type { Tweet } from "./types";

export const WORST_MIN_VIEWS = 100;

export function bestTweets(tweets: Tweet[], n = 20): Tweet[] {
  return [...tweets].sort((a, b) => b.favorite_count - a.favorite_count || b.view_count - a.view_count).slice(0, n);
}

/** Lowest liked tweets that were actually seen, so unseen posts are not ranked as bad. */
export function worstTweets(tweets: Tweet[], n = 20, minViews = WORST_MIN_VIEWS): Tweet[] {
  return tweets
    .filter((t) => t.view_count >= minViews)
    .sort((a, b) => a.favorite_count - b.favorite_count || b.view_count - a.view_count)
    .slice(0, n);
}

export function recentTweets(tweets: Tweet[], n = 12): Tweet[] {
  return tweets.filter((t) => !t.in_reply_to_status_id_str).sort((a, b) => b.created_at - a.created_at).slice(0, n);
}
