import { useEffect, useState } from "preact/hooks";
import { effect, signal } from "@preact/signals";
import { liveQuery } from "dexie";
import type { BackfillRow, TweetRow, UserRow } from "@/data/db";
import { bestTimesRobust, CUSTOM_PERIOD, engagementRate, bestTweets, frequencyGrid, makeBuckets, mediaBreakdown, series, splitKinds, total, streak, periodStart, DAY_MS } from "@/analytics";
import { normalizeGraphql } from "@/data/normalizer";
import { XApiError } from "@/x-api/client";
import { ops } from "@/x-api/operations";
import { pageThrough } from "@/data/jobs/paging";
import { services } from "../services";
import { me, settings, toast } from "../store";
import { profileFromPath, xPath } from "./../xroute";
import { navigateX } from "../navigate";
import { go } from "../router";
import { compact, percent } from "../components/format";
import { CardLabel, SectionTitle } from "../components/Section";
import { FrequencyHeatmap } from "../components/Heatmap";
import { LineChart } from "../components/LineChart";
import { TweetCard } from "../components/TweetCard";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/icons";
import { METRIC_COLORS } from "./Activities";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** "All time" for someone else's profile is capped at a year, the same reach as the own-posts backfill. */
const MAX_PROFILE_DAYS = 365;

interface Window {
  start: number;
  end: number;
  days: number;
  label: string;
}

/** The analysis window from the global period: Today is one day, All time a year, Custom its own dates. */
function windowFor(period: number, custom: { start: number; end: number } | null, now: number): Window {
  if (period === CUSTOM_PERIOD && custom) {
    const end = Math.min(custom.end, now);
    const days = Math.max(1, Math.round((end - custom.start) / DAY_MS));
    const fmt = (ts: number) => new Date(ts).toLocaleDateString([], { day: "numeric", month: "short" });
    return { start: custom.start, end, days, label: `${fmt(custom.start)} to ${fmt(end)}` };
  }
  const days = period === 0 ? 1 : period < 0 ? MAX_PROFILE_DAYS : period;
  return { start: periodStart(days - 1, now), end: now, days, label: period === -1 ? "last year" : days === 1 ? "today" : `last ${days} days` };
}

/** True while the user asked for the lookup form although X is on a profile page. Reset on navigation. */
const lookupMode = signal(false);
effect(() => {
  xPath.value;
  lookupMode.value = false;
});

/** True when the walk has gone back past the start of the window or the timeline simply ended. */
function coversWindow(walk: BackfillRow | undefined, windowStart: number): boolean {
  return !!walk && (!!walk.completed_at || (walk.oldest_created_at !== undefined && walk.oldest_created_at < windowStart));
}
/** Pages fetched per click of "Load posts"; the cursor is kept so the next click continues. */
const PAGES_PER_LOAD = 6;
const UPDATE_PAGES = 2;

const stateKey = (userId: string) => `profile:${userId}`;

/** Sniper tab: analytics for whichever profile is open on X, computed from what has been captured about it. */
export function Profile() {
  const screenName = profileFromPath(xPath.value);
  const [user, setUser] = useState<UserRow | undefined>(undefined);
  const [tweets, setTweets] = useState<TweetRow[]>([]);
  const [walk, setWalk] = useState<BackfillRow | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const win = windowFor(settings.value.period, settings.value.customRange, Date.now());
  const windowDays = win.days;

  useEffect(() => {
    if (!screenName) return;
    const db = services.db;
    const sub = liveQuery(async () => {
      const u = await db.users.where("screen_name").equalsIgnoreCase(screenName).first();
      const t = u ? await db.tweets.where("user_id_str").equals(u.id).toArray() : [];
      const w = u ? await db.backfill.get(stateKey(u.id)) : undefined;
      return { u, t, w };
    }).subscribe({ next: ({ u, t, w }) => { setUser(u); setTweets(t); setWalk(w); } });
    return () => sub.unsubscribe();
  }, [screenName]);

  /**
   * Walks the profile's timeline backwards a few pages per click, remembering the cursor and how far
   * back it reached, until the selected period is covered. After that, a click refreshes the newest
   * pages. Widening the period later resumes the walk from the saved cursor.
   */
  const load = async () => {
    if (!screenName || loading) return;
    setLoading(true);
    setProgress(0);
    try {
      let target = user;
      if (!target) {
        const page = await ops.userByScreenName(services.client, screenName);
        await services.ingestor.ingestBody(page.body);
        target = normalizeGraphql(page.body).users[0];
      }
      if (!target) throw new Error("Profile not found");
      const id = target.id;
      const db = services.db;
      const key = stateKey(id);
      const state = (await db.backfill.get(key)) ?? { key };
      const windowStart = win.start;
      const complete = coversWindow(state, windowStart);
      const fetchPage = (c?: string) => ops.userTweets(services.client, id, c);
      const res = await pageThrough(db, services.client, services.ingestor, fetchPage, {
        op: "UserTweets",
        maxPages: complete ? UPDATE_PAGES : PAGES_PER_LOAD,
        minCreatedAt: windowStart,
        ...(complete ? { stopWhenNoNew: true } : state.cursor ? { cursor: state.cursor } : {}),
        onProgress: (pages) => setProgress(pages),
      });
      if (!complete) {
        const patch: BackfillRow = { ...state, last_run: Date.now(), pages: (state.pages ?? 0) + res.pages };
        if (res.frontier !== undefined) patch.oldest_created_at = Math.min(state.oldest_created_at ?? Infinity, res.frontier);
        // The cursor survives a "tooOld" stop so a wider period can resume the walk later.
        if (res.stoppedBy === "noCursor") {
          patch.completed_at = Date.now();
          delete patch.cursor;
        } else if (res.cursor) patch.cursor = res.cursor;
        if (res.error) patch.last_error = res.error;
        else delete patch.last_error;
        await db.backfill.put(patch);
      } else await db.backfill.put({ ...state, last_run: Date.now() });
      if (res.stoppedBy === "rateLimit") toast("X asked to slow down; try again in a few minutes", "error");
      else toast(res.newTweets ? `${res.newTweets} posts loaded` : "Already up to date");
    } catch (err) {
      toast(err instanceof XApiError ? `Could not load: ${err.kind}` : "Could not load profile", "error");
    } finally {
      setLoading(false);
    }
  };

  if (!screenName || lookupMode.value) return <ProfileLookup current={screenName} />;
  const isMe = user && me.value && user.id === me.value.id;
  const now = win.end;
  const since = win.start;
  const inWindow = tweets.filter((t) => t.created_at >= since && t.created_at <= now);
  // How far back the data actually goes: the walk's frontier, or the oldest captured post as a fallback.
  const complete = coversWindow(walk, since);
  const frontier = walk?.oldest_created_at ?? (inWindow.length ? Math.min(...inWindow.map((t) => t.created_at)) : undefined);
  const coverageStart = complete || frontier === undefined ? since : Math.max(since, periodStart(0, frontier));
  const coveredDays = Math.max(1, Math.round((periodStart(0, now) - coverageStart) / DAY_MS) + 1);
  const partial = !complete && coveredDays < windowDays;
  const windowLabel = win.label;
  const recent = inWindow.filter((t) => t.created_at >= coverageStart);
  const split = splitKinds(recent);
  const originals = split.tweets;
  const engaged = [...split.tweets, ...split.replies];
  const buckets = makeBuckets(coverageStart, now, "day");
  const impressions = series(engaged, buckets, "view_count");
  const rate = engagementRate(engaged);
  const avgViews = engaged.length ? total(impressions) / engaged.length : 0;
  const best = bestTimesRobust(engaged, 3);
  const st = streak(tweets);
  const freq = frequencyGrid(tweets, 18, now, Math.min(30, coveredDays));
  const media = mediaBreakdown(originals).filter((c) => c.count > 0);
  const top = bestTweets(engaged, 5);
  const perDay = recent.length / coveredDays;
  const sinceLabel = new Date(coverageStart).toLocaleDateString([], { day: "numeric", month: "short" });
  const buttonLabel = loading ? (progress ? `Page ${progress}…` : "Loading…") : !walk ? "Load posts" : partial ? "Load more" : "Update";

  return (
    <section class="flex flex-col gap-2.5">
      <div class="xl-card xl-card-2 flex items-center gap-3">
        {user?.profile_image_url_https ? <img src={user.profile_image_url_https} alt="" width={44} height={44} class="rounded-full" referrerpolicy="no-referrer" /> : <span class="xl-avatar" style={{ width: 44, height: 44 }}><Icon.user size={20} /></span>}
        <div class="min-w-0 flex-1">
          <div class="font-semibold truncate">{user?.name ?? `@${screenName}`}{isMe && <span class="xl-pill ml-2">you</span>}</div>
          <div class="text-xs xl-muted truncate">@{user?.screen_name ?? screenName}{user ? ` · ${compact(user.followers_count)} followers · ${compact(user.friends_count)} following · ${compact(user.statuses_count)} posts` : ""}</div>
        </div>
        <button class="xl-btn" disabled={loading} onClick={() => void load()} title={partial ? `Fetch ${PAGES_PER_LOAD} more pages going back in time` : `Refresh the newest ${UPDATE_PAGES} pages`}><Icon.refresh size={13} /> {buttonLabel}</button>
        <button class="xl-btn icon" onClick={() => (lookupMode.value = true)} title="Look up another profile" aria-label="Look up another profile"><Icon.close size={14} /></button>
      </div>

      {(partial || loading) && recent.length > 0 && (
        <div class="xl-card xl-card-2 flex items-center gap-2.5 py-2" role="status" aria-live="polite">
          <span class={`xl-accent shrink-0 ${loading ? "xl-spin" : ""}`}><Icon.refresh size={14} /></span>
          <div class="min-w-0 flex-1 text-[12px]">
            <div class="font-semibold">{loading ? `Collecting data… page ${progress || 1}` : `Partial data: ${coveredDays} of ${windowDays} days`}</div>
            <div class="xl-muted text-[11px]">Posts before {sinceLabel} are not loaded yet. Stats below cover only the loaded days; hatched days in the heatmap are unknown, not empty.</div>
          </div>
          {!loading && <button class="xl-btn text-[12px] py-[3px] shrink-0" onClick={() => void load()}>Load more</button>}
        </div>
      )}

      {recent.length === 0 ? (
        <EmptyState title={`Nothing captured about @${screenName} yet`} hint="Scroll their profile or press Load posts. Everything stays in your browser." />
      ) : (
        <>
          <SectionTitle right={partial ? `since ${sinceLabel} · ${recent.length} posts · partial` : `${windowLabel} · ${recent.length} posts`}>Overview</SectionTitle>
          <div class="grid grid-cols-3 gap-2">
            <Kpi label="Avg impressions" value={compact(avgViews)} />
            <Kpi label="Engagement rate" value={percent(rate, 2)} />
            <Kpi label="Posts / day" value={perDay.toFixed(1)} />
          </div>
          <div class="xl-card xl-card-2">
            <div class="flex items-center justify-between mb-1"><CardLabel>Impressions per day</CardLabel><span class="text-[11px] xl-muted">{compact(total(impressions))} total</span></div>
            <LineChart points={impressions} color={METRIC_COLORS.impressions} height={110} format={compact} />
          </div>
          <div class="xl-card xl-card-2">
            <div class="flex items-center justify-between mb-2">
              <CardLabel>Frequency</CardLabel>
              <span class="text-[11px] xl-muted inline-flex items-center gap-1">{st.current > 0 && <><Icon.flame size={12} /> {st.current} day streak ·</>} Max: {freq.max}, Avg: {freq.avg.toFixed(1)}</span>
            </div>
            <FrequencyHeatmap grid={freq} coverageStart={partial ? coverageStart : undefined} />
          </div>
          <div class="grid grid-cols-2 gap-2.5">
            <div class="xl-card xl-card-2">
              <CardLabel>Best times</CardLabel>
              {isMe ? (
                <div class="mt-2 text-[12px] xl-muted">
                  Your own best times live in <button class="underline hover:opacity-80" onClick={() => go("activities")}>Activity</button>, computed over the period you select there.
                </div>
              ) : (
                <div class="mt-2 flex flex-col gap-1 text-[12px]">
                  {best.slots.map((s) => (
                    <div key={`${s.weekday}-${s.hour}`} class="flex justify-between gap-2" title={`${s.count} post${s.count === 1 ? "" : "s"} in this slot`}>
                      <span>{DAYS[s.weekday]} {String(s.hour).padStart(2, "0")}:00</span>
                      <span class="xl-muted whitespace-nowrap">{compact(s.avgImpressions)} avg · {s.count}</span>
                    </div>
                  ))}
                  {best.slots.length === 0 && <span class="xl-muted">Not enough data</span>}
                  {best.slots.length > 0 && best.minCount === 1 && <span class="xl-muted text-[11px]">Based on single posts.</span>}
                </div>
              )}
            </div>
            <div class="xl-card xl-card-2">
              <CardLabel>Post types</CardLabel>
              <div class="mt-2 flex flex-col gap-1 text-[12px]">
                {media.map((c) => (
                  <div key={c.category} class="flex justify-between"><span class="capitalize">{c.category}</span><span class="xl-muted">{c.share}% · {percent(c.engagementRate)}</span></div>
                ))}
                {media.length === 0 && <span class="xl-muted">No original posts captured</span>}
              </div>
            </div>
          </div>
          <SectionTitle>Top posts</SectionTitle>
          {top.map((t, i) => <TweetCard key={t.id} tweet={t} screenName={user?.screen_name ?? screenName} rank={i + 1} />)}
        </>
      )}
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div class="xl-card xl-card-2 py-2">
      <CardLabel>{label}</CardLabel>
      <div class="text-[20px] font-extrabold leading-tight mt-0.5">{value}</div>
    </div>
  );
}

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/** Shown when X is not on a profile page: type a handle and X navigates there, then this tab analyses it. */
function ProfileLookup({ current }: { current?: string | undefined }) {
  const [handle, setHandle] = useState("");
  const clean = handle.trim().replace(/^@/, "");
  const valid = HANDLE_RE.test(clean);
  const open = (e: Event) => {
    e.preventDefault();
    if (valid) navigateX(`/${clean}`);
  };
  return (
    <section class="flex flex-col gap-2.5">
      <form class="xl-card xl-card-2 flex flex-col gap-2" onSubmit={open}>
        <div class="flex items-center gap-1.5"><span class="xl-accent"><Icon.crosshair size={14} /></span><CardLabel>Sniper: inspect any profile</CardLabel></div>
        <div class="text-xs xl-muted">Open any account on X and this tab analyses it from what has been captured, or type a handle to jump there.</div>
        <div class="flex gap-2">
          <label class="xl-input flex items-center gap-1 flex-1 min-w-0 py-1">
            <span class="xl-muted">@</span>
            <input class="bg-transparent outline-none flex-1 min-w-0 text-[13px]" value={handle} placeholder="username" autoFocus aria-label="X username" autocomplete="off" spellcheck={false} onInput={(e) => setHandle((e.target as HTMLInputElement).value)} />
          </label>
          <button type="submit" class="xl-btn active" disabled={!valid}>Go</button>
        </div>
        <div class="flex flex-col gap-1 text-[12px] xl-muted">
          {current && <button type="button" class="text-left hover:underline" onClick={() => (lookupMode.value = false)}>Back to @{current}, the profile open on X</button>}
          {me.value && me.value.screen_name !== current && <button type="button" class="text-left hover:underline" onClick={() => navigateX(`/${me.value!.screen_name}`)}>Or open your own profile, @{me.value.screen_name}</button>}
        </div>
      </form>
    </section>
  );
}
