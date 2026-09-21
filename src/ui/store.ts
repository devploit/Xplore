import { computed, effect, signal } from "@preact/signals";
import { liveQuery } from "dexie";
import type { BackfillRow, FollowerPointRow, FollowerSnapshotRow, RateLimitRow, TweetRow, UserRow, XploreDb } from "@/data/db";
import { currentUserId } from "@/data/identity";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "@/data/settings";
import { resolveTheme, type Theme } from "./theme";

export const settings = signal<Settings>(DEFAULT_SETTINGS);
export const theme = signal<Theme>("light");
export const userId = signal<string | undefined>(undefined);
export const me = signal<UserRow | undefined>(undefined);
export const ownTweets = signal<TweetRow[]>([]);
export const snapshots = signal<FollowerSnapshotRow[]>([]);
export const followerPoints = signal<FollowerPointRow[]>([]);
export const rateLimits = signal<RateLimitRow[]>([]);
export const jobStatus = signal<Record<string, unknown>>({});
export const captured = signal({ messages: 0, dropped: 0, tweets: 0 });
/** True once the first own-tweets query has answered; pages show skeletons until then. */
export const storeReady = signal(false);
export const backfillState = signal<BackfillRow | undefined>(undefined);
/** Replies and quotes to the user newer than settings.mentionsSeenAt. */
export const unreadMentions = signal(0);

/** Post opened in the detail overlay. */
export const selectedTweetId = signal<string | undefined>(undefined);
/** Chart bucket opened in the drill-down overlay. */
export const selectedBucket = signal<{ start: number; end: number; title: string } | undefined>(undefined);

export const toasts = signal<{ id: number; text: string; kind: "info" | "error" }[]>([]);
let toastSeq = 0;
export function toast(text: string, kind: "info" | "error" = "info"): void {
  const id = ++toastSeq;
  toasts.value = [...toasts.value, { id, text, kind }];
  setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), 4000);
}

export const period = computed(() => settings.value.period);

let dbRef: XploreDb | undefined;

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  settings.value = { ...settings.value, ...patch };
  if (dbRef) await saveSettings(dbRef, settings.value);
}

/** Wires signals to the database. Subscriptions are live: any write re-renders the UI. */
export async function initStore(db: XploreDb): Promise<() => void> {
  dbRef = db;
  settings.value = await loadSettings(db);
  userId.value = currentUserId();
  theme.value = resolveTheme(settings.value.theme);
  const subs: { unsubscribe(): void }[] = [];
  const id = userId.value;
  if (id) {
    subs.push(liveQuery(() => db.users.get(id)).subscribe({ next: (u) => (me.value = u) }));
    subs.push(liveQuery(() => db.tweets.where("user_id_str").equals(id).toArray()).subscribe({ next: (rows) => { ownTweets.value = rows; storeReady.value = true; } }));
    subs.push(liveQuery(() => db.backfill.get("backfill:UserTweets")).subscribe({ next: (row) => (backfillState.value = row) }));
    subs.push(liveQuery(() => db.tweets.where("in_reply_to_user_id_str").equals(id).toArray()).subscribe({ next: (rows) => { unreadTotal = rows.filter((t) => t.user_id_str !== id); recount(); } }));
    subs.push(liveQuery(() => db.followerSnapshots.where("user_id").equals(id).toArray()).subscribe({ next: (rows) => (snapshots.value = rows) }));
    subs.push(liveQuery(() => db.followerPoints.where("user_id").equals(id).toArray()).subscribe({ next: (rows) => (followerPoints.value = rows.sort((a, b) => a.taken_at - b.taken_at)) }));
  }
  else storeReady.value = true;
  subs.push(liveQuery(() => db.rateLimits.toArray()).subscribe({ next: (rows) => (rateLimits.value = rows) }));
  const stopUnread = effect(() => {
    settings.value.mentionsSeenAt;
    recount();
  });
  const stopTheme = effect(() => {
    theme.value = resolveTheme(settings.value.theme);
  });
  return () => {
    subs.forEach((s) => s.unsubscribe());
    stopTheme();
    stopUnread();
  };
}

let unreadTotal: TweetRow[] = [];
function recount(): void {
  const seen = settings.value.mentionsSeenAt;
  unreadMentions.value = unreadTotal.filter((t) => t.created_at > seen).length;
}
