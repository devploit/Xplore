import type { XploreDb } from "./db";

export type ThemeSetting = "system" | "dark" | "dim" | "light";

export interface Settings {
  theme: ThemeSetting;
  visible: boolean;
  hideXSidebar: boolean;
  hideDmDrawer: boolean;
  closeToMainColumn: boolean;
  period: number;
  /** local midnight of the first day and 23:59:59.999 of the last day, when period is CUSTOM_PERIOD */
  customRange: { start: number; end: number } | null;
  cumulative: boolean;
  showChange: boolean;
  showEarnings: boolean;
  retentionDays: number;
  pages: Record<string, boolean>;
  posterStyle: number;
  /** sidebar width in px */
  width: 400 | 460 | 540;
  compactCards: boolean;
  /** draw the previous period as a dashed line behind each engagement chart */
  showCompare: boolean;
  /** mentions newer than this are counted as unread; epoch ms */
  mentionsSeenAt: number;
  /** replies per day the user aims for, shown next to the reply radar */
  replyGoal: number;
  radar: { maxAgeHours: number; fewReplies: boolean; biggerOnly: boolean };
  mentionFilters: { minLikes: number; minRetweets: number; minImpressions: number; minFollowers: number; verifiedOnly: boolean; hideReplied: boolean; sort: "latest" | "top" };
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  visible: true,
  hideXSidebar: false,
  hideDmDrawer: false,
  closeToMainColumn: false,
  period: 30,
  customRange: null,
  cumulative: true,
  showChange: true,
  showEarnings: false,
  retentionDays: 90,
  pages: { home: true, activities: true, tweets: true, mentions: true, timelines: true },
  posterStyle: 0,
  width: 460,
  compactCards: false,
  showCompare: false,
  mentionsSeenAt: 0,
  replyGoal: 10,
  radar: { maxAgeHours: 3, fewReplies: true, biggerOnly: true },
  mentionFilters: { minLikes: 0, minRetweets: 0, minImpressions: 0, minFollowers: 0, verifiedOnly: false, hideReplied: false, sort: "latest" },
};

const KEY = "settings";

export async function loadSettings(db: XploreDb): Promise<Settings> {
  const row = await db.settings.get(KEY);
  const stored = (row?.value ?? {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...stored, pages: { ...DEFAULT_SETTINGS.pages, ...(stored.pages ?? {}) }, mentionFilters: { ...DEFAULT_SETTINGS.mentionFilters, ...(stored.mentionFilters ?? {}) }, radar: { ...DEFAULT_SETTINGS.radar, ...(stored.radar ?? {}) } };
}

export async function saveSettings(db: XploreDb, settings: Settings): Promise<void> {
  await db.settings.put({ key: KEY, value: settings });
}
