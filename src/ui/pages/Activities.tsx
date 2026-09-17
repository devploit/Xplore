import { engagementRate, estimateEarnings, followerSeries, frequencyGrid, hourWeekdayGrid, mediaBreakdown, series, shares, splitKinds, total } from "@/analytics";
import { periodData } from "../period";
import { ownTweets, settings, snapshots, updateSettings } from "../store";
import { StatCard } from "../components/StatCard";
import { FrequencyHeatmap, HourWeekdayHeatmap } from "../components/Heatmap";
import { compact, percent } from "../components/format";
import { EmptyState } from "../components/EmptyState";
import { SectionTitle, CardLabel } from "../components/Section";

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
          <span class="text-[11px] xl-muted">Max: {freq.max}, Min: {freq.min}, Avg: {freq.avg.toFixed(1)}</span>
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

      <SectionTitle>Profile</SectionTitle>
      <StatCard title="Followers" points={s.cumulative ? followers.absolute : followers.delta} color={METRIC_COLORS.followers} value={followers.latest ?? 0} delta={followerDelta} tall aside={
        <div class="text-right text-[11px] xl-muted pt-1">{snapshots.value.length} daily snapshot{snapshots.value.length === 1 ? "" : "s"}</div>
      } />
    </section>
  );
}
