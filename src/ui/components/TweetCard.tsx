import type { TweetRow } from "@/data/db";
import { me } from "../store";
import { navigateX, tweetUrl } from "../navigate";
import { compact, percent, relative } from "./format";
import { TweetText } from "./TweetText";
import { QuickActions } from "./QuickActions";
import { tweetEngagementRate } from "@/analytics";

export function TweetCard({ tweet, screenName, showActions = true }: { tweet: TweetRow; screenName?: string; showActions?: boolean }) {
  const handle = screenName ?? (tweet.user_id_str === me.value?.id ? me.value?.screen_name : undefined) ?? "i";
  const open = (e: Event) => {
    e.preventDefault();
    navigateX(tweetUrl(handle, tweet.id));
  };
  return (
    <article class="xl-card flex flex-col gap-2" data-tweet-id={tweet.id}>
      <div class="flex items-center justify-between text-xs xl-muted">
        <a href={`https://x.com${tweetUrl(handle, tweet.id)}`} onClick={open} class="hover:underline">
          @{handle} · {relative(tweet.created_at)}
        </a>
        <span title="Engagement rate">{percent(tweetEngagementRate(tweet))}</span>
      </div>
      <div class="text-[13px] leading-snug">
        <TweetText tweet={tweet} />
      </div>
      {tweet.media_types.length > 0 && <div class="text-xs xl-muted">{tweet.media_types.join(", ")}</div>}
      <div class="flex gap-3 text-xs xl-muted">
        <span title="Impressions">👁 {compact(tweet.view_count)}</span>
        <span title="Likes">♥ {compact(tweet.favorite_count)}</span>
        <span title="Retweets and quotes">↻ {compact(tweet.retweet_count + tweet.quote_count)}</span>
        <span title="Replies">💬 {compact(tweet.reply_count)}</span>
        <span title="Bookmarks">🔖 {compact(tweet.bookmark_count)}</span>
      </div>
      {showActions && <QuickActions tweet={tweet} />}
    </article>
  );
}
