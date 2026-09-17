import { computed, effect, signal } from "@preact/signals";
import { liveQuery } from "dexie";
import type { FollowerSnapshotRow, RateLimitRow, TweetRow, UserRow, XlyticsDb } from "@/data/db";
import { currentUserId } from "@/data/identity";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "@/data/settings";
import { resolveTheme, type Theme } from "./theme";

export const settings = signal<Settings>(DEFAULT_SETTINGS);
export const theme = signal<Theme>("light");
export const userId = signal<string | undefined>(undefined);
export const me = signal<UserRow | undefined>(undefined);
export const ownTweets = signal<TweetRow[]>([]);
export const snapshots = signal<FollowerSnapshotRow[]>([]);
export const rateLimits = signal<RateLimitRow[]>([]);
export const jobStatus = signal<Record<string, unknown>>({});
export const captured = signal({ messages: 0, dropped: 0, tweets: 0 });

export const toasts = signal<{ id: number; text: string; kind: "info" | "error" }[]>([]);
let toastSeq = 0;
export function toast(text: string, kind: "info" | "error" = "info"): void {
  const id = ++toastSeq;
  toasts.value = [...toasts.value, { id, text, kind }];
  setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), 4000);
}

export const period = computed(() => settings.value.period);

let dbRef: XlyticsDb | undefined;

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  settings.value = { ...settings.value, ...patch };
  if (dbRef) await saveSettings(dbRef, settings.value);
}

/** Wires signals to the database. Subscriptions are live: any write re-renders the UI. */
export async function initStore(db: XlyticsDb): Promise<() => void> {
  dbRef = db;
  settings.value = await loadSettings(db);
  userId.value = currentUserId();
  theme.value = resolveTheme(settings.value.theme);
  const subs: { unsubscribe(): void }[] = [];
  const id = userId.value;
  if (id) {
    subs.push(liveQuery(() => db.users.get(id)).subscribe({ next: (u) => (me.value = u) }));
    subs.push(liveQuery(() => db.tweets.where("user_id_str").equals(id).toArray()).subscribe({ next: (rows) => (ownTweets.value = rows) }));
    subs.push(liveQuery(() => db.followerSnapshots.where("user_id").equals(id).toArray()).subscribe({ next: (rows) => (snapshots.value = rows) }));
  }
  subs.push(liveQuery(() => db.rateLimits.toArray()).subscribe({ next: (rows) => (rateLimits.value = rows) }));
  const stopTheme = effect(() => {
    theme.value = resolveTheme(settings.value.theme);
  });
  return () => {
    subs.forEach((s) => s.unsubscribe());
    stopTheme();
  };
}
