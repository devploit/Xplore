import type { Tweet } from "./types";

export type MediaCategory = "video" | "photo" | "gif" | "url" | "emoji" | "text";
export const MEDIA_CATEGORIES: MediaCategory[] = ["video", "photo", "gif", "url", "emoji", "text"];

const EMOJI_RE = /\p{Extended_Pictographic}/u;

/** Exclusive category by priority: video, photo, gif, url, emoji, text. */
export function categorize(t: Tweet): MediaCategory {
  if (t.media_types.includes("video")) return "video";
  if (t.media_types.includes("photo")) return "photo";
  if (t.media_types.includes("animated_gif")) return "gif";
  if (t.urls.length > 0) return "url";
  if (EMOJI_RE.test(t.full_text)) return "emoji";
  return "text";
}

export interface CategoryStats {
  category: MediaCategory;
  count: number;
  share: number;
  impressions: number;
  engagements: number;
  engagementRate?: number;
}

export function mediaBreakdown(tweets: Tweet[]): CategoryStats[] {
  const acc = new Map<MediaCategory, { count: number; impressions: number; engagements: number }>();
  for (const c of MEDIA_CATEGORIES) acc.set(c, { count: 0, impressions: 0, engagements: 0 });
  for (const t of tweets) {
    const a = acc.get(categorize(t))!;
    a.count += 1;
    a.impressions += t.view_count;
    a.engagements += t.favorite_count + t.retweet_count + t.reply_count + t.quote_count + t.bookmark_count;
  }
  return MEDIA_CATEGORIES.map((category) => {
    const a = acc.get(category)!;
    const stats: CategoryStats = { category, count: a.count, share: tweets.length ? Math.round((100 * a.count) / tweets.length) : 0, impressions: a.impressions, engagements: a.engagements };
    if (a.impressions > 0) stats.engagementRate = a.engagements / a.impressions;
    return stats;
  });
}
