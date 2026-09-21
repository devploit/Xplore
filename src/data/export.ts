import type { TweetRow } from "./db";
import { kindOf } from "@/analytics/split";

export const CSV_COLUMNS = ["id", "created_at", "kind", "text", "impressions", "likes", "retweets", "quotes", "replies", "bookmarks", "url"] as const;

function cell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV of the user's posts, newest first, with a header row. */
export function tweetsToCsv(tweets: TweetRow[], screenName: string): string {
  const rows = [...tweets].sort((a, b) => b.created_at - a.created_at).map((t) =>
    [t.id, new Date(t.created_at).toISOString(), kindOf(t), t.full_text, t.view_count, t.favorite_count, t.retweet_count, t.quote_count, t.reply_count, t.bookmark_count, `https://x.com/${screenName}/status/${t.id}`].map(cell).join(","),
  );
  return [CSV_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}
