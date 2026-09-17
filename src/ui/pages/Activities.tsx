import { engagementRate, estimateEarnings, followerSeries, frequencyGrid, hourWeekdayGrid, mediaBreakdown, series, shares, splitKinds, total } from "@/analytics";
import { periodData } from "../period";
import { ownTweets, settings, snapshots, updateSettings } from "../store";
import { PeriodSelect } from "../components/PeriodSelect";
import { StatBlock } from "../components/StatBlock";
import { FrequencyHeatmap, HourWeekdayHeatmap } from "../components/Heatmap";
import { compact, percent } from "../components/format";
import { EmptyState } from "../components/EmptyState";

const COLORS = { impressions: "#F97316", tweets: "#F44336", likes: "#f91880", retweets: "#22c55e", replies: "#0ea5e9", bookmarks: "#d946ef", followers: "#6366f1" };

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
  const totals = { tweets: total(counts), likes: total(likes), retweets: total(retweets), replies: total(replies), bookmarks: total(bookmarks) };
  const sh = shares(totals);
  const rate = engagementRate(engaged);
  const freq = frequencyGrid(ownTweets.value, 18, Date.now(), days > 0 ? days : undefined);
  const hours = hourWeekdayGrid(engaged);
  const media = mediaBreakdown(split.tweets);
  const followers = followerSeries(snapshots.value, buckets);
  const views = total(impressions);

  return (
    <section class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <div class="flex gap-2 text-xs">
          <label class="flex items-center gap-1"><input type="checkbox" checked={s.cumulative} onChange={(e) => void updateSettings({ cumulative: (e.target as HTMLInputElement).checked })} /> Cumulate</label>
          <label class="flex items-center gap-1"><input type="checkbox" checked={s.showChange} onChange={(e) => void updateSettings({ showChange: (e.target as HTMLInputElement).checked })} /> Change</label>
          <label class="flex items-center gap-1"><input type="checkbox" checked={s.showEarnings} onChange={(e) => void updateSettings({ showEarnings: (e.target as HTMLInputElement).checked })} /> Earnings</label>
        </div>
        <PeriodSelect />
      </div>

      <div class="xl-card">
        <div class="flex items-baseline justify-between text-xs xl-muted mb-2">
          <span>Frequency</span>
          <span>Max {freq.max} · Min {freq.min} · Avg {freq.avg.toFixed(1)}</span>
        </div>
        <FrequencyHeatmap grid={freq} />
      </div>

      <StatBlock title="Impressions" points={impressions} color={COLORS.impressions} extra={
        <div class="flex justify-between text-xs xl-muted mt-1">
          <span>Engagement rate {percent(rate, 2)}</span>
          {s.showEarnings && <span>Est. earnings ${estimateEarnings(views).toFixed(2)}</span>}
        </div>
      } />
      <div class="grid grid-cols-2 gap-3">
        <StatBlock title="Tweets" points={counts} color={COLORS.tweets} share={sh.tweets} />
        <StatBlock title="Likes" points={likes} color={COLORS.likes} share={sh.likes} />
        <StatBlock title="Retweets" points={retweets} color={COLORS.retweets} share={sh.retweets} />
        <StatBlock title="Replies" points={replies} color={COLORS.replies} share={sh.replies} />
        <StatBlock title="Bookmarks" points={bookmarks} color={COLORS.bookmarks} share={sh.bookmarks} />
        <div class="xl-card">
          <div class="text-xs xl-muted mb-1">Post types</div>
          {media.map((c) => (
            <div key={c.category} class="flex justify-between text-xs py-[2px]" title={`${c.impressions} impressions, engagement rate ${percent(c.engagementRate)}`}>
              <span class="capitalize">{c.category}</span>
              <span>{c.count} · {c.share}%</span>
            </div>
          ))}
        </div>
      </div>

      <div class="xl-card">
        <div class="text-xs xl-muted mb-2">Activity time · impressions by weekday and hour</div>
        <HourWeekdayHeatmap grid={hours} />
      </div>

      <StatBlock title="Followers" points={s.cumulative ? followers.absolute : followers.delta} color={COLORS.followers} format={(n) => compact(followers.latest ?? n)} extra={
        <div class="text-xs xl-muted mt-1">{snapshots.value.length} daily snapshots · latest {compact(followers.latest ?? 0)}</div>
      } />
    </section>
  );
}
