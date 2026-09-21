import { useMemo, useState } from "preact/hooks";
import type { TweetRow } from "@/data/db";
import { bestTweets, groupThreads, isStandaloneTweet, splitKinds, worstTweets, type Thread } from "@/analytics";
import { periodData } from "../period";
import { me, selectedTweetId, storeReady } from "../store";
import { SkeletonPage } from "../components/Skeleton";
import { TweetText } from "../components/TweetText";
import { navigateX, tweetUrl } from "../navigate";
import { compact, relative } from "../components/format";
import { EmptyState } from "../components/EmptyState";
import { TweetCard } from "../components/TweetCard";
import { Icon } from "../components/icons";
import { METRIC_COLORS } from "./Activities";

type Tab = "tweets" | "replies" | "retweets" | "threads" | "best" | "worst";
type SortKey = "created_at" | "view_count" | "favorite_count" | "rt" | "reply_count" | "bookmark_count" | "media";

const COLUMNS: { key: SortKey; title: string; icon: keyof typeof Icon; color?: string }[] = [
  { key: "media", title: "Media", icon: "copy" },
  { key: "view_count", title: "Impressions", icon: "eye", color: METRIC_COLORS.impressions },
  { key: "favorite_count", title: "Likes", icon: "heart", color: METRIC_COLORS.likes },
  { key: "rt", title: "Retweets and quotes", icon: "repeat", color: METRIC_COLORS.retweets },
  { key: "reply_count", title: "Replies", icon: "reply", color: METRIC_COLORS.replies },
  { key: "bookmark_count", title: "Bookmarks", icon: "bookmark", color: METRIC_COLORS.bookmarks },
];

function sortValue(t: TweetRow, k: SortKey): number {
  if (k === "rt") return t.retweet_count + t.quote_count;
  if (k === "media") return t.media_types.length;
  return t[k];
}

export function Tweets() {
  const [tab, setTab] = useState<Tab>("tweets");
  const [sort, setSort] = useState<SortKey>("created_at");
  const [desc, setDesc] = useState(true);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const { tweets } = periodData.value;

  const threads = useMemo(() => (tab === "threads" ? groupThreads(tweets) : []), [tweets, tab]);
  const rows = useMemo(() => {
    const split = splitKinds(tweets);
    let list: TweetRow[];
    if (tab === "threads") list = [];
    else if (tab === "tweets") list = split.tweets.filter(isStandaloneTweet);
    else if (tab === "replies") list = split.replies;
    else if (tab === "retweets") list = split.retweets;
    else if (tab === "best") list = bestTweets([...split.tweets, ...split.replies]);
    else list = worstTweets([...split.tweets, ...split.replies]);
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((t) => t.full_text.toLowerCase().includes(needle));
    if (tab === "tweets" || tab === "replies" || tab === "retweets") list = [...list].sort((a, b) => (desc ? sortValue(b, sort) - sortValue(a, sort) : sortValue(a, sort) - sortValue(b, sort)));
    return list;
  }, [tweets, tab, sort, desc, q]);

  const clickSort = (k: SortKey) => {
    if (sort === k) setDesc(!desc);
    else {
      setSort(k);
      setDesc(true);
    }
  };
  const handle = me.value?.screen_name ?? "i";
  const tabs: { id: Tab; label: string }[] = [
    { id: "tweets", label: "Tweets" },
    { id: "replies", label: "Replies" },
    { id: "retweets", label: "Retweets" },
    { id: "threads", label: "Threads" },
    { id: "best", label: "Best" },
    { id: "worst", label: "Worst" },
  ];
  const totals = COLUMNS.map((c) => rows.reduce((a, t) => a + sortValue(t, c.key), 0));
  const sortLabel = (k: SortKey | "created_at") => (sort === k ? (desc ? "descending" : "ascending") : "none");
  if (!storeReady.value) return <SkeletonPage />;

  return (
    <section class="flex flex-col gap-2">
      <div class="flex items-center gap-3 px-1">
        <div class="flex gap-3" role="tablist" aria-label="Post type">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} class={`text-[11px] font-bold tracking-wider uppercase pb-1 border-b-2 ${tab === t.id ? "border-current" : "xl-muted border-transparent hover:opacity-80"}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <span class="ml-auto text-[11px] xl-muted">{tab === "threads" ? threads.length : rows.length}</span>
        <button class="xl-btn icon" aria-pressed={searching} onClick={() => { setSearching(!searching); if (searching) setQ(""); }} title="Search" aria-label="Search posts"><Icon.search size={14} /></button>
      </div>
      {searching && <input class="xl-input" type="search" autoFocus placeholder="Search text" aria-label="Search posts" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />}
      {tab === "threads" ? (
        threads.length === 0 ? <EmptyState title="No threads in this period" hint="A thread is a post followed by your own replies to it." /> : threads.map((th) => <ThreadCard key={th.root.id} thread={th} />)
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing here" hint={tab === "worst" ? "Worst only ranks posts with at least 100 impressions." : "Try another period or tab."} />
      ) : tab === "best" || tab === "worst" ? (
        rows.map((t, i) => <TweetCard key={t.id} tweet={t} rank={i + 1} />)
      ) : (
        <table class="xl-table">
          <thead>
            <tr>
              <th scope="col" aria-sort={sortLabel("created_at")}>
                <button class="xl-th" onClick={() => clickSort("created_at")} aria-label={`Sort by time, ${sortLabel("created_at")}`}>Time{sort === "created_at" ? (desc ? " ↓" : " ↑") : ""}</button>
              </th>
              <th scope="col">Content</th>
              {COLUMNS.map((c) => {
                const I = Icon[c.icon];
                return (
                  <th key={c.key} scope="col" aria-sort={sortLabel(c.key)} style={sort === c.key && c.color ? { color: c.color } : undefined}>
                    <button class="xl-th" title={c.title} aria-label={`Sort by ${c.title.toLowerCase()}, ${sortLabel(c.key)}`} onClick={() => clickSort(c.key)}><I size={14} /></button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} class="border-t xl-border">
                <td class="xl-muted">{relative(t.created_at)}</td>
                <td class="max-w-[150px]">
                  <a href={`https://x.com${tweetUrl(handle, t.id)}`} class="block truncate hover:underline" title={t.full_text} onClick={(e) => { e.preventDefault(); navigateX(tweetUrl(handle, t.id)); }}>
                    {t.full_text}
                  </a>
                </td>
                {COLUMNS.map((c) => {
                  const v = sortValue(t, c.key);
                  return <td key={c.key} style={{ color: v > 0 && c.color ? c.color : "var(--xl-muted)" }}>{c.key === "media" ? v || "" : compact(v)}</td>;
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr class="border-t xl-border xl-muted">
              <td colSpan={2} class="text-left">Total</td>
              {totals.map((v, i) => <td key={i}>{COLUMNS[i]!.key === "media" ? v : compact(v)}</td>)}
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}

/** One of the user's threads: root text plus the sum of its parts. */
function ThreadCard({ thread }: { thread: Thread }) {
  return (
    <article class="xl-card flex flex-col gap-2" data-tweet-id={thread.root.id}>
      <div class="flex items-center justify-between text-xs xl-muted gap-2">
        <span class="inline-flex items-center gap-1"><span class="xl-pill">{thread.parts.length} parts</span><span>{relative(thread.root.created_at)}</span></span>
        <button class="xl-btn icon" onClick={() => (selectedTweetId.value = thread.root.id)} title="Open the first post" aria-label="Open the first post"><Icon.chart size={12} /></button>
      </div>
      <div class="text-[13px] leading-snug line-clamp-3"><TweetText tweet={thread.root} /></div>
      <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs xl-muted">
        <span class="xl-metric" title="Impressions of all parts"><Icon.eye size={13} />{compact(thread.impressions)}</span>
        <span class="xl-metric" title="Likes, retweets, quotes, replies and bookmarks of all parts"><Icon.heart size={13} />{compact(thread.engagements)}</span>
        <span class="xl-metric" title="Impressions of the first post"><Icon.list size={13} />{compact(thread.root.view_count)} first</span>
      </div>
    </article>
  );
}
