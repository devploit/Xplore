import { useEffect, useState } from "preact/hooks";
import { liveQuery } from "dexie";
import type { TweetMetricRow, TweetRow, UserRow } from "@/data/db";
import { medianEngagementRate, metricCurve, tweetEngagementRate, type Metric } from "@/analytics";
import { services } from "../services";
import { me, ownTweets, selectedTweetId } from "../store";
import { periodData } from "../period";
import { navigateX, tweetUrl } from "../navigate";
import { compact, percent, shortDate } from "./format";
import { CardLabel, SectionTitle } from "./Section";
import { LineChart } from "./LineChart";
import { Overlay } from "./Overlay";
import { TweetCard } from "./TweetCard";
import { Icon } from "./icons";
import { METRIC_COLORS } from "../pages/Activities";

const CURVES: { metric: Metric; title: string; color: string }[] = [
  { metric: "view_count", title: "Impressions", color: METRIC_COLORS.impressions },
  { metric: "favorite_count", title: "Likes", color: METRIC_COLORS.likes },
];

/** Everything captured about one post: counters, its first 48 hours and who answered it. */
export function PostDetail({ tweetId }: { tweetId: string }) {
  const [tweet, setTweet] = useState<TweetRow | undefined>(undefined);
  const [metrics, setMetrics] = useState<TweetMetricRow[]>([]);
  const [replies, setReplies] = useState<{ tweet: TweetRow; author: UserRow | undefined }[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const close = () => (selectedTweetId.value = undefined);

  useEffect(() => {
    const db = services.db;
    const sub = liveQuery(async () => {
      const t = await db.tweets.get(tweetId);
      const m = await db.tweetMetrics.where("tweet_id").equals(tweetId).toArray();
      const r = await db.tweets.where("in_reply_to_status_id_str").equals(tweetId).toArray();
      const q = await db.tweets.where("quoted_status_id_str").equals(tweetId).toArray();
      const all = [...r, ...q].filter((x) => x.user_id_str !== t?.user_id_str).sort((a, b) => b.favorite_count - a.favorite_count);
      const authors = await db.users.bulkGet([...new Set(all.map((x) => x.user_id_str))]);
      const byId = new Map(authors.filter((u): u is UserRow => !!u).map((u) => [u.id, u]));
      return { t, m, list: all.map((x) => ({ tweet: x, author: byId.get(x.user_id_str) })) };
    }).subscribe({
      next: ({ t, m, list }) => { setTweet(t); setMetrics(m); setReplies(list); },
      error: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    });
    return () => sub.unsubscribe();
  }, [tweetId]);

  if (error) return <Overlay title="Post" onClose={close}><div class="text-xs text-red-400">Could not load this post: {error}</div></Overlay>;
  if (!tweet) return <Overlay title="Post" onClose={close}><div class="text-xs xl-muted">Loading…</div></Overlay>;
  const handle = tweet.user_id_str === me.value?.id ? me.value?.screen_name ?? "i" : "i";
  const rate = tweetEngagementRate(tweet);
  const median = medianEngagementRate(periodData.value.tweets.length ? periodData.value.tweets : ownTweets.value);
  const vsMedian = rate !== undefined && median ? rate / median - 1 : undefined;
  const counters: { label: string; value: number; icon: keyof typeof Icon; color: string }[] = [
    { label: "Impressions", value: tweet.view_count, icon: "eye", color: METRIC_COLORS.impressions },
    { label: "Likes", value: tweet.favorite_count, icon: "heart", color: METRIC_COLORS.likes },
    { label: "Retweets", value: tweet.retweet_count, icon: "repeat", color: METRIC_COLORS.retweets },
    { label: "Quotes", value: tweet.quote_count, icon: "copy", color: METRIC_COLORS.retweets },
    { label: "Replies", value: tweet.reply_count, icon: "reply", color: METRIC_COLORS.replies },
    { label: "Bookmarks", value: tweet.bookmark_count, icon: "bookmark", color: METRIC_COLORS.bookmarks },
  ];

  return (
    <Overlay
      title={`Post · ${shortDate(tweet.created_at)}`}
      onClose={close}
      actions={<button class="xl-btn icon" title="Open on X" aria-label="Open on X" onClick={() => navigateX(tweetUrl(handle, tweet.id))}><Icon.external size={14} /></button>}
    >
      <TweetCard tweet={tweet} showActions={true} openDetail={false} />

      <div class="grid grid-cols-3 gap-2">
        {counters.map((c) => {
          const I = Icon[c.icon];
          return (
            <div key={c.label} class="xl-card xl-card-2 py-2">
              <div class="flex items-center gap-1 text-[10.5px] xl-muted" style={{ color: c.color }}><I size={12} /><span class="uppercase font-bold tracking-wider">{c.label}</span></div>
              <div class="text-[20px] font-extrabold leading-tight mt-0.5">{compact(c.value)}</div>
            </div>
          );
        })}
      </div>

      <div class="xl-card xl-card-2">
        <div class="flex items-center justify-between">
          <CardLabel>Engagement rate</CardLabel>
          {median !== undefined && <span class="text-[11px] xl-muted">your median {percent(median, 2)}</span>}
        </div>
        <div class="flex items-baseline gap-2 mt-1">
          <span class="text-[26px] font-extrabold leading-none">{percent(rate, 2)}</span>
          {vsMedian !== undefined && Math.abs(vsMedian) >= 0.005 && (
            <span class={`text-[13px] font-semibold ${vsMedian > 0 ? "text-emerald-400" : "text-red-400"}`} title="Compared with the median engagement rate of your posts in the selected period">
              {vsMedian > 0 ? "↑" : "↓"} {Math.round(Math.abs(vsMedian) * 100)}% vs median
            </span>
          )}
        </div>
      </div>

      <SectionTitle right={`${metrics.length} snapshot${metrics.length === 1 ? "" : "s"}`}>First 48 hours</SectionTitle>
      {CURVES.map((c) => {
        const points = metricCurve(metrics, c.metric, tweet.created_at);
        return (
          <div key={c.metric} class="xl-card xl-card-2">
            <CardLabel>{c.title}</CardLabel>
            {points.length >= 2 ? (
              <div class="mt-2"><LineChart points={points} color={c.color} height={110} format={compact} xTitle="hours after posting" /></div>
            ) : (
              <div class="text-xs xl-muted mt-1">Not enough snapshots yet. Xplore records the counters every time X reloads this post during its first week.</div>
            )}
          </div>
        );
      })}

      <SectionTitle right={String(replies.length)}>Replies and quotes captured</SectionTitle>
      {replies.length === 0 ? (
        <div class="text-xs xl-muted px-1">None captured yet. Open the post on X and they will be picked up as they load.</div>
      ) : (
        replies.slice(0, 30).map((r) => <TweetCard key={r.tweet.id} tweet={r.tweet} screenName={r.author?.screen_name ?? "i"} openDetail={false} />)
      )}
    </Overlay>
  );
}
