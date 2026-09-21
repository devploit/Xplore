import { computed } from "@preact/signals";
import { bucketsForPeriod, bucketsForRange, CUSTOM_PERIOD, previousBuckets } from "@/analytics";
import { me, ownTweets, settings } from "./store";

/** Buckets and the slice of own tweets for the selected period, shared by Home, Activities and Tweets. */
export const periodData = computed(() => {
  const period = settings.value.period;
  const range = period === CUSTOM_PERIOD ? settings.value.customRange : null;
  const now = Date.now();
  // A custom range may end in the past; every other period ends now.
  const end = range ? Math.min(range.end, now) : now;
  const allTimeStart = me.value?.created_at;
  const { buckets, interval, start } = range ? bucketsForRange(range.start, end) : bucketsForPeriod(period === CUSTOM_PERIOD ? 30 : period, now, allTimeStart);
  const days = range ? Math.max(1, Math.round((end - start) / 86_400_000)) : period;
  const tweets = ownTweets.value.filter((t) => t.created_at >= start && t.created_at <= end);
  // The previous period of equal length, for the dashed comparison line. Meaningless for All time.
  const prevBuckets = days > 0 ? previousBuckets(buckets, interval) : [];
  const prevStart = prevBuckets[0]?.start ?? start;
  const prevTweets = prevBuckets.length ? ownTweets.value.filter((t) => t.created_at >= prevStart && t.created_at < start) : [];
  return { buckets, interval, start, tweets, days, prevBuckets, prevTweets };
});
