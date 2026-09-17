import type { XlyticsDb } from "./db";

export type ThemeSetting = "system" | "dark" | "dim" | "light";

export interface Settings {
  theme: ThemeSetting;
  visible: boolean;
  hideXSidebar: boolean;
  hideDmDrawer: boolean;
  closeToMainColumn: boolean;
  period: number;
  cumulative: boolean;
  showChange: boolean;
  showEarnings: boolean;
  retentionDays: number;
  pages: Record<string, boolean>;
  posterStyle: number;
  mentionFilters: { minLikes: number; minRetweets: number; minImpressions: number; minFollowers: number; verifiedOnly: boolean; hideReplied: boolean; sort: "latest" | "top" };
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  visible: true,
  hideXSidebar: false,
  hideDmDrawer: false,
  closeToMainColumn: false,
  period: 30,
  cumulative: true,
  showChange: true,
  showEarnings: false,
  retentionDays: 90,
  pages: { home: true, activities: true, tweets: true, mentions: true, timelines: true },
  posterStyle: 0,
  mentionFilters: { minLikes: 0, minRetweets: 0, minImpressions: 0, minFollowers: 0, verifiedOnly: false, hideReplied: false, sort: "latest" },
};

const KEY = "settings";

export async function loadSettings(db: XlyticsDb): Promise<Settings> {
  const row = await db.settings.get(KEY);
  const stored = (row?.value ?? {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...stored, pages: { ...DEFAULT_SETTINGS.pages, ...(stored.pages ?? {}) }, mentionFilters: { ...DEFAULT_SETTINGS.mentionFilters, ...(stored.mentionFilters ?? {}) } };
}

export async function saveSettings(db: XlyticsDb, settings: Settings): Promise<void> {
  await db.settings.put({ key: KEY, value: settings });
}
