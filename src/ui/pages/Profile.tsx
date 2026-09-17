import { useEffect, useState } from "preact/hooks";
import { liveQuery } from "dexie";
import type { TweetRow, UserRow } from "@/data/db";
import { bestTimes, bucketsForPeriod, engagementRate, bestTweets, frequencyGrid, mediaBreakdown, series, splitKinds, total, streak, periodStart } from "@/analytics";
import { normalizeGraphql } from "@/data/normalizer";
import { XApiError } from "@/x-api/client";
import { ops } from "@/x-api/operations";
import { pageThrough } from "@/data/jobs/paging";
import { services } from "../services";
import { me, toast } from "../store";
import { profileFromPath, xPath } from "./../xroute";
import { compact, percent } from "../components/format";
import { CardLabel, SectionTitle } from "../components/Section";
import { FrequencyHeatmap } from "../components/Heatmap";
import { LineChart } from "../components/LineChart";
import { TweetCard } from "../components/TweetCard";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/icons";
import { METRIC_COLORS } from "./Activities";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WINDOW_DAYS = 90;

/** Analytics for whichever profile is open on X, computed from what has been captured about it. */
export function Profile() {
  const screenName = profileFromPath(xPath.value);
  const [user, setUser] = useState<UserRow | undefined>(undefined);
  const [tweets, setTweets] = useState<TweetRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!screenName) return;
    const db = services.db;
    const sub = liveQuery(async () => {
      const u = await db.users.where("screen_name").equalsIgnoreCase(screenName).first();
      const t = u ? await db.tweets.where("user_id_str").equals(u.id).toArray() : [];
      return { u, t };
    }).subscribe({ next: ({ u, t }) => { setUser(u); setTweets(t); } });
    return () => sub.unsubscribe();
  }, [screenName]);

  const load = async () => {
    if (!screenName || loading) return;
    setLoading(true);
    try {
      let target = user;
      if (!target) {
        const page = await ops.userByScreenName(services.client, screenName);
        await services.ingestor.ingestBody(page.body);
        target = normalizeGraphql(page.body).users[0];
      }
      if (!target) throw new Error("Profile not found");
      const id = target.id;
      const res = await pageThrough(services.db, services.client, services.ingestor, (c) => ops.userTweets(services.client, id, c), { op: "UserTweets", maxPages: 3, minCreatedAt: Date.now() - WINDOW_DAYS * 86_400_000 });
      toast(res.newTweets ? `${res.newTweets} posts loaded` : "Already up to date");
    } catch (err) {
      toast(err instanceof XApiError ? `Could not load: ${err.kind}` : "Could not load profile", "error");
    } finally {
      setLoading(false);
    }
  };

  if (!screenName) return <EmptyState title="Open a profile on X" hint="This tab analyses whichever profile you are looking at." />;
  const isMe = user && me.value && user.id === me.value.id;
  const since = periodStart(WINDOW_DAYS - 1);
  const recent = tweets.filter((t) => t.created_at >= since);
  const split = splitKinds(recent);
  const originals = split.tweets;
  const engaged = [...split.tweets, ...split.replies];
  const { buckets } = bucketsForPeriod(WINDOW_DAYS);
  const impressions = series(engaged, buckets, "view_count");
  const rate = engagementRate(engaged);
  const avgViews = engaged.length ? total(impressions) / engaged.length : 0;
  const times = bestTimes(engaged, 3);
  const st = streak(tweets);
  const freq = frequencyGrid(tweets, 18, Date.now(), 30);
  const media = mediaBreakdown(originals).filter((c) => c.count > 0);
  const top = bestTweets(engaged, 5);
  const perDay = recent.length / WINDOW_DAYS;

  return (
    <section class="flex flex-col gap-2.5">
      <div class="xl-card xl-card-2 flex items-center gap-3">
        {user?.profile_image_url_https ? <img src={user.profile_image_url_https} alt="" width={44} height={44} class="rounded-full" referrerpolicy="no-referrer" /> : <span class="xl-avatar" style={{ width: 44, height: 44 }}><Icon.user size={20} /></span>}
        <div class="min-w-0 flex-1">
          <div class="font-semibold truncate">{user?.name ?? `@${screenName}`}{isMe && <span class="xl-pill ml-2">you</span>}</div>
          <div class="text-xs xl-muted truncate">@{user?.screen_name ?? screenName}{user ? ` · ${compact(user.followers_count)} followers · ${compact(user.friends_count)} following · ${compact(user.statuses_count)} posts` : ""}</div>
        </div>
        <button class="xl-btn" disabled={loading} onClick={() => void load()} title={`Fetch the last ${WINDOW_DAYS} days of posts (up to 3 pages)`}><Icon.refresh size={13} /> {loading ? "Loading…" : tweets.length ? "Update" : "Load posts"}</button>
      </div>

      {recent.length === 0 ? (
        <EmptyState title={`Nothing captured about @${screenName} yet`} hint="Scroll their profile or press Load posts. Everything stays in your browser." />
      ) : (
        <>
          <SectionTitle right={`last ${WINDOW_DAYS} days · ${recent.length} posts captured`}>Overview</SectionTitle>
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
            <FrequencyHeatmap grid={freq} />
          </div>
          <div class="grid grid-cols-2 gap-2.5">
            <div class="xl-card xl-card-2">
              <CardLabel>Best times</CardLabel>
              <div class="mt-2 flex flex-col gap-1 text-[12px]">
                {times.map((s) => (
                  <div key={`${s.weekday}-${s.hour}`} class="flex justify-between"><span>{DAYS[s.weekday]} {String(s.hour).padStart(2, "0")}:00</span><span class="xl-muted">{compact(s.avgImpressions)} avg</span></div>
                ))}
                {times.length === 0 && <span class="xl-muted">Not enough data</span>}
              </div>
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
