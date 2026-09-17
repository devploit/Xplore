import { useMemo, useState } from "preact/hooks";
import type { TweetRow } from "@/data/db";
import { bestTweets, isStandaloneTweet, splitKinds, worstTweets } from "@/analytics";
import { periodData } from "../period";
import { me } from "../store";
import { navigateX, tweetUrl } from "../navigate";
import { compact, shortDate } from "../components/format";
import { PeriodSelect } from "../components/PeriodSelect";
import { EmptyState } from "../components/EmptyState";
import { TweetCard } from "../components/TweetCard";

type Tab = "tweets" | "replies" | "retweets" | "best" | "worst";
type SortKey = "created_at" | "view_count" | "favorite_count" | "rt" | "reply_count" | "bookmark_count" | "media";

const COLUMNS: { key: SortKey; label: string; title: string }[] = [
  { key: "created_at", label: "Date", title: "Date" },
  { key: "media", label: "🖼", title: "Media count" },
  { key: "view_count", label: "👁", title: "Impressions" },
  { key: "favorite_count", label: "♥", title: "Likes" },
  { key: "rt", label: "↻", title: "Retweets and quotes" },
  { key: "reply_count", label: "💬", title: "Replies" },
  { key: "bookmark_count", label: "🔖", title: "Bookmarks" },
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
  const { tweets } = periodData.value;

  const rows = useMemo(() => {
    const split = splitKinds(tweets);
    let list: TweetRow[];
    if (tab === "tweets") list = split.tweets.filter(isStandaloneTweet);
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
    { id: "best", label: "Best" },
    { id: "worst", label: "Worst" },
  ];

  return (
    <section class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <div class="flex gap-1" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} class={`xl-btn ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <PeriodSelect />
      </div>
      <input class="xl-input" type="search" placeholder="Search text" aria-label="Search tweets" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing here" hint={tab === "worst" ? "Worst only ranks posts with at least 100 impressions." : "Try another period or tab."} />
      ) : tab === "best" || tab === "worst" ? (
        rows.map((t) => <TweetCard key={t.id} tweet={t} />)
      ) : (
        <table class="w-full text-xs">
          <thead>
            <tr class="xl-muted">
              <th class="text-left font-normal pb-1">Text</th>
              {COLUMNS.map((c) => (
                <th key={c.key} class="font-normal pb-1 cursor-pointer select-none" title={c.title} aria-sort={sort === c.key ? (desc ? "descending" : "ascending") : "none"} onClick={() => clickSort(c.key)}>
                  {c.label}{sort === c.key ? (desc ? " ↓" : " ↑") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} class="border-t xl-border align-top">
                <td class="py-1 pr-2 max-w-[160px]">
                  <a href={`https://x.com${tweetUrl(handle, t.id)}`} class="hover:underline line-clamp-2" title={t.full_text} onClick={(e) => { e.preventDefault(); navigateX(tweetUrl(handle, t.id)); }}>
                    {t.full_text.slice(0, 90)}
                  </a>
                </td>
                <td class="py-1 text-center whitespace-nowrap">{shortDate(t.created_at)}</td>
                <td class="py-1 text-center">{t.media_types.length || ""}</td>
                <td class="py-1 text-center">{compact(t.view_count)}</td>
                <td class="py-1 text-center">{compact(t.favorite_count)}</td>
                <td class="py-1 text-center">{compact(t.retweet_count + t.quote_count)}</td>
                <td class="py-1 text-center">{compact(t.reply_count)}</td>
                <td class="py-1 text-center">{compact(t.bookmark_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
