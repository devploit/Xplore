import { bestTimes, engagementRate, estimateEarnings, followerSeries, frequencyGrid, hashtagStats, hourWeekdayGrid, lengthStats, mediaBreakdown, series, shares, splitKinds, streak, total } from "@/analytics";
import { periodData } from "../period";
import { ownTweets, settings, snapshots, updateSettings } from "../store";
import { StatCard } from "../components/StatCard";
import { FrequencyHeatmap, HourWeekdayHeatmap } from "../components/Heatmap";
import { compact, percent } from "../components/format";
import { EmptyState } from "../components/EmptyState";
import { SectionTitle, CardLabel } from "../components/Section";
import { Icon } from "../components/icons";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const METRIC_COLORS = { impressions: "#F97316", tweets: "#F44336", likes: "#f91880", retweets: "#22c55e", replies: "#0ea5e9", bookmarks: "#d946ef", followers: "#6366f1" };

export function Activities() {
  const { buckets, tweets, days } = periodData.value;
  const s = settings.value;
  if (ownTweets.value.length === 0) return <EmptyState title="No data yet" hint="Your posts are captured as you browse X and synced in the background." />;
  const split = splitKinds(tweets);
  const engaged = [...split.tweets, ...split.replies];
  const impressions = series(engaged, buckets, "view_count");
  const likes = series(engaged, buckets, "favorite_count");
  const retweets = series(engaged, buckets, "retweet_count");
  const replies = series(engaged, buckets, "reply_count");
  const bookmarks = series(engaged, buckets, "bookmark_count");
  const counts = series(split.tweets, buckets);
  const sh = shares({ tweets: total(counts), likes: total(likes), retweets: total(retweets), replies: total(replies), bookmarks: total(bookmarks) });
  const rate = engagementRate(engaged);
  const freq = frequencyGrid(ownTweets.value, 18, Date.now(), days > 0 ? days : undefined);
  const hours = hourWeekdayGrid(engaged);
  const media = mediaBreakdown(split.tweets);
  const followers = followerSeries(snapshots.value, buckets);
  const views = total(impressions);
  const st = streak(ownTweets.value);
  const times = bestTimes(engaged, 3, 2).length >= 3 ? bestTimes(engaged, 3, 2) : bestTimes(engaged, 3, 1);
  const tags = hashtagStats(originalsOrAll(split.tweets, engaged), 6);
  const lengths = lengthStats(engaged).filter((l) => l.count > 0);
  const followerDelta = followers.absolute.length > 1 ? followers.absolute[followers.absolute.length - 1]!.value - followers.absolute[0]!.value : 0;

  const toggle = (key: "cumulative" | "showChange" | "showEarnings", label: string) => (
    <button class={`xl-btn text-[11px] py-[3px] ${s[key] ? "active" : ""}`} aria-pressed={s[key]} onClick={() => void updateSettings({ [key]: !s[key] })}>{label}</button>
  );

  return (
    <section class="flex flex-col gap-2.5">
      <div class="flex gap-1.5 justify-end">{toggle("cumulative", "Cumulative")}{toggle("showChange", "Change")}{toggle("showEarnings", "Earnings")}</div>

      <div class="xl-card xl-card-2">
        <div class="flex items-center justify-between mb-2">
          <CardLabel>Frequency</CardLabel>
          <span class="text-[11px] xl-muted inline-flex items-center gap-1" title={st.longest ? `Longest streak: ${st.longest} days` : undefined}>
            {st.current > 0 && <span class={`inline-flex items-center gap-0.5 ${st.atRisk ? "text-amber-400" : "xl-accent"}`}><Icon.flame size={12} /> {st.current}d{st.atRisk ? " · post today" : ""} ·</span>}
            Max: {freq.max}, Min: {freq.min}, Avg: {freq.avg.toFixed(1)}
          </span>
        </div>
        <FrequencyHeatmap grid={freq} />
      </div>

      <SectionTitle right={rate !== undefined ? `Engagement rate ${percent(rate, 2)}` : undefined}>Engagement</SectionTitle>
      <StatCard title="Impressions" points={impressions} color={METRIC_COLORS.impressions} tall aside={
        s.showEarnings ? (
          <div class="text-right">
            <CardLabel>Estimate earning</CardLabel>
            <div class="text-[26px] font-extrabold leading-none mt-1 text-emerald-400">${estimateEarnings(views).toFixed(estimateEarnings(views) < 10 ? 2 : 0)}</div>
          </div>
        ) : undefined
      } />
      <div class="grid grid-cols-2 gap-2.5">
        <StatCard title="Tweets" points={counts} color={METRIC_COLORS.tweets} share={sh.tweets} />
        <StatCard title="Likes" points={likes} color={METRIC_COLORS.likes} share={sh.likes} />
        <StatCard title="Retweets" points={retweets} color={METRIC_COLORS.retweets} share={sh.retweets} />
        <StatCard title="Replies" points={replies} color={METRIC_COLORS.replies} share={sh.replies} />
        <StatCard title="Bookmarks" points={bookmarks} color={METRIC_COLORS.bookmarks} share={sh.bookmarks} />
        <div class="xl-card xl-card-2">
          <CardLabel>Post types</CardLabel>
          <div class="mt-2 flex flex-col gap-1.5">
            {media.filter((c) => c.count > 0).map((c) => (
              <div key={c.category} class="text-[11.5px]" title={`${compact(c.impressions)} impressions · engagement rate ${percent(c.engagementRate)}`}>
                <div class="flex justify-between"><span class="capitalize">{c.category}</span><span class="xl-muted">{c.count} · {c.share}%</span></div>
                <div class="h-[4px] rounded-full mt-[3px]" style={{ background: "var(--xl-hover)" }}><div class="h-full rounded-full" style={{ width: `${c.share}%`, background: "var(--xl-accent)" }} /></div>
              </div>
            ))}
            {media.every((c) => c.count === 0) && <div class="text-xs xl-muted">No original posts in this period.</div>}
          </div>
        </div>
      </div>

      <SectionTitle>Tweets</SectionTitle>
      <div class="xl-card xl-card-2">
        <div class="flex items-center justify-between mb-2">
          <CardLabel>Activity time / impression</CardLabel>
          <span class="text-[11px] xl-muted">{engaged.length} posts</span>
        </div>
        <HourWeekdayHeatmap grid={hours} />
      </div>

      <SectionTitle>Insights</SectionTitle>
      <div class="grid grid-cols-2 gap-2.5">
        <div class="xl-card xl-card-2">
          <div class="flex items-center gap-1"><Icon.clock size={12} /><CardLabel>Best times to post</CardLabel></div>
          <div class="mt-2 flex flex-col gap-1 text-[12px]">
            {times.map((t) => (
              <div key={`${t.weekday}-${t.hour}`} class="flex justify-between" title={`${t.count} posts in this slot`}><span>{DAYS[t.weekday]} {String(t.hour).padStart(2, "0")}:00</span><span class="xl-muted">{compact(t.avgImpressions)} avg</span></div>
            ))}
            {times.length === 0 && <span class="xl-muted text-xs">Not enough posts yet.</span>}
          </div>
        </div>
        <div class="xl-card xl-card-2">
          <div class="flex items-center gap-1"><Icon.hash size={12} /><CardLabel>Hashtags that work</CardLabel></div>
          <div class="mt-2 flex flex-col gap-1 text-[12px]">
            {tags.map((t) => (
              <div key={t.tag} class="flex justify-between" title={`${t.count} posts · engagement rate ${percent(t.engagementRate)}`}><span class="truncate">#{t.tag}</span><span class="xl-muted shrink-0">{compact(t.avgImpressions)} avg</span></div>
            ))}
            {tags.length === 0 && <span class="xl-muted text-xs">No hashtags in this period.</span>}
          </div>
        </div>
        <div class="xl-card xl-card-2 col-span-2">
          <CardLabel>Length vs performance</CardLabel>
          <div class="mt-2 grid grid-cols-3 gap-2 text-[12px]">
            {lengths.map((l) => (
              <div key={l.bucket}>
                <div class="xl-muted text-[11px]">{l.label}</div>
                <div class="font-semibold">{compact(l.avgImpressions)} <span class="xl-muted font-normal">avg</span></div>
                <div class="xl-muted text-[11px]">{l.count} posts · {percent(l.engagementRate)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <SectionTitle>Profile</SectionTitle>
      <StatCard title="Followers" points={s.cumulative ? followers.absolute : followers.delta} color={METRIC_COLORS.followers} value={followers.latest ?? 0} delta={followerDelta} tall aside={
        <div class="text-right text-[11px] xl-muted pt-1">{snapshots.value.length} daily snapshot{snapshots.value.length === 1 ? "" : "s"}</div>
      } />
    </section>
  );
}

function originalsOrAll<T>(originals: T[], all: T[]): T[] {
  return originals.length ? originals : all;
}
