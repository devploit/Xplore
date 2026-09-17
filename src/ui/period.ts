import { computed } from "@preact/signals";
import { bucketsForPeriod } from "@/analytics";
import { me, ownTweets, settings } from "./store";

/** Buckets and the slice of own tweets for the selected period, shared by Home, Activities and Tweets. */
export const periodData = computed(() => {
  const days = settings.value.period;
  const now = Date.now();
  const allTimeStart = me.value?.created_at;
  const { buckets, interval, start } = bucketsForPeriod(days, now, allTimeStart);
  const tweets = ownTweets.value.filter((t) => t.created_at >= start && t.created_at <= now);
  return { buckets, interval, start, tweets, days };
});
