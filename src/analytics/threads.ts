import type { Tweet } from "./types";
import { engagements } from "./series";
import { kindOf } from "./split";

export interface Thread {
  root: Tweet;
  /** root first, then continuations by time */
  parts: Tweet[];
  impressions: number;
  engagements: number;
}

/**
 * Groups the author's own posts into threads: a root tweet plus later posts in the same
 * conversation that reply to the author's own posts. Single posts are not threads.
 */
export function groupThreads(own: Tweet[]): Thread[] {
  const byId = new Map(own.map((t) => [t.id, t]));
  const byConversation = new Map<string, Tweet[]>();
  for (const t of own) {
    if (kindOf(t) === "retweet") continue;
    const conv = t.conversation_id_str ?? t.id;
    if (!byId.has(conv)) continue;
    const list = byConversation.get(conv) ?? [];
    list.push(t);
    byConversation.set(conv, list);
  }
  const threads: Thread[] = [];
  for (const [conv, list] of byConversation) {
    const root = byId.get(conv);
    if (!root || root.in_reply_to_status_id_str) continue;
    const parts = list.filter((t) => t.id === conv || (t.in_reply_to_user_id_str === root.user_id_str && t.in_reply_to_status_id_str)).sort((a, b) => a.created_at - b.created_at);
    if (parts.length < 2) continue;
    threads.push({ root, parts, impressions: parts.reduce((a, t) => a + t.view_count, 0), engagements: parts.reduce((a, t) => a + engagements(t), 0) });
  }
  return threads.sort((a, b) => b.root.created_at - a.root.created_at);
}
