import type { Tweet, TweetKind } from "./types";

/** Same rule SuperX applies: RT prefix, then reply markers, else a tweet. */
export function kindOf(t: Tweet): TweetKind {
  if (t.retweeted_status_id_str || t.full_text.startsWith("RT @")) return "retweet";
  if (t.in_reply_to_status_id_str || t.full_text.startsWith("@")) return "reply";
  return "tweet";
}

export interface Split {
  tweets: Tweet[];
  replies: Tweet[];
  retweets: Tweet[];
}

export function splitKinds(all: Tweet[]): Split {
  const out: Split = { tweets: [], replies: [], retweets: [] };
  for (const t of all) {
    const k = kindOf(t);
    if (k === "tweet") out.tweets.push(t);
    else if (k === "reply") out.replies.push(t);
    else out.retweets.push(t);
  }
  return out;
}

/** A tweet that continues the author's own thread rather than starting one. */
export function isThreadContinuation(t: Tweet): boolean {
  return !!t.conversation_id_str && t.conversation_id_str !== t.id;
}

/** Strict filter used by the Tweets tab: originals that start a conversation. */
export function isStandaloneTweet(t: Tweet): boolean {
  return kindOf(t) === "tweet" && !isThreadContinuation(t);
}
