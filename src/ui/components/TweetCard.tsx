import type { TweetRow } from "@/data/db";
import { me, settings } from "../store";
import { navigateX, tweetUrl } from "../navigate";
import { compact, percent, relative } from "./format";
import { TweetText } from "./TweetText";
import { QuickActions } from "./QuickActions";
import { Icon } from "./icons";
import { tweetEngagementRate } from "@/analytics";

export function TweetCard({ tweet, screenName, showActions = true, rank }: { tweet: TweetRow; screenName?: string; showActions?: boolean; rank?: number | undefined }) {
  const handle = screenName ?? (tweet.user_id_str === me.value?.id ? me.value?.screen_name : undefined) ?? "i";
  const compactMode = settings.value.compactCards;
  const open = (e: Event) => {
    e.preventDefault();
    navigateX(tweetUrl(handle, tweet.id));
  };
  const rate = tweetEngagementRate(tweet);
  return (
    <article class={`xl-card flex flex-col ${compactMode ? "gap-1 py-2" : "gap-2"}`} data-tweet-id={tweet.id}>
      <div class="flex items-center justify-between text-xs xl-muted gap-2">
        <a href={`https://x.com${tweetUrl(handle, tweet.id)}`} onClick={open} class="hover:underline inline-flex items-center gap-1 min-w-0 truncate" title="Open on X">
          {rank !== undefined && <span class="xl-pill">#{rank}</span>}
          <span class="truncate">@{handle}</span>
          <span>·</span>
          <span>{relative(tweet.created_at)}</span>
          <Icon.external size={11} />
        </a>
        {rate !== undefined && <span class="xl-pill" title="Engagement rate: engagements / impressions">{percent(rate)}</span>}
      </div>
      <div class={`leading-snug ${compactMode ? "text-[12.5px] line-clamp-3" : "text-[13px]"}`}>
        <TweetText tweet={tweet} />
      </div>
      {!compactMode && tweet.media && tweet.media.length > 0 && (
        <div class={`grid gap-1 ${tweet.media.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {tweet.media.slice(0, 4).map((m, i) => (
            <a key={i} href={m.url || `https://x.com${tweetUrl(handle, tweet.id)}`} target="_blank" rel="noopener noreferrer" class="relative block overflow-hidden rounded-lg" style={{ aspectRatio: tweet.media!.length === 1 ? "16 / 9" : "1 / 1", background: "var(--xl-hover)" }} title={m.type}>
              <img src={`${m.thumb}${m.thumb.includes("?") ? "&" : "?"}name=small`} alt="" loading="lazy" referrerpolicy="no-referrer" class="w-full h-full object-cover" onError={(e) => { const a = (e.currentTarget as HTMLElement).closest("a"); if (a) a.style.display = "none"; }} />
              {m.type !== "photo" && <span class="absolute bottom-1 left-1 xl-pill" style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}>{m.type === "animated_gif" ? "GIF" : "▶ video"}</span>}
            </a>
          ))}
        </div>
      )}
      {!compactMode && (!tweet.media || tweet.media.length === 0) && tweet.media_types.length > 0 && <div class="text-[11px] xl-muted">{tweet.media_types.map((m) => (m === "animated_gif" ? "gif" : m)).join(" · ")}</div>}
      <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs xl-muted">
        <span class="xl-metric" title="Impressions"><Icon.eye size={13} />{compact(tweet.view_count)}</span>
        <span class="xl-metric" title="Likes"><Icon.heart size={13} />{compact(tweet.favorite_count)}</span>
        <span class="xl-metric" title="Retweets and quotes"><Icon.repeat size={13} />{compact(tweet.retweet_count + tweet.quote_count)}</span>
        <span class="xl-metric" title="Replies"><Icon.reply size={13} />{compact(tweet.reply_count)}</span>
        <span class="xl-metric" title="Bookmarks"><Icon.bookmark size={13} />{compact(tweet.bookmark_count)}</span>
        {showActions && <span class="ml-auto"><QuickActions tweet={tweet} /></span>}
      </div>
    </article>
  );
}
