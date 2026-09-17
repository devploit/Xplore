import { useMemo, useState } from "preact/hooks";
import type { TweetRow } from "@/data/db";
import { bestTweets, isStandaloneTweet, splitKinds, worstTweets } from "@/analytics";
import { periodData } from "../period";
import { me } from "../store";
import { navigateX, tweetUrl } from "../navigate";
import { compact, relative } from "../components/format";
import { EmptyState } from "../components/EmptyState";
import { TweetCard } from "../components/TweetCard";
import { Icon } from "../components/icons";
import { METRIC_COLORS } from "./Activities";

type Tab = "tweets" | "replies" | "retweets" | "best" | "worst";
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
  const totals = COLUMNS.map((c) => rows.reduce((a, t) => a + sortValue(t, c.key), 0));

  return (
    <section class="flex flex-col gap-2">
      <div class="flex items-center gap-3 px-1">
        <div class="flex gap-3" role="tablist" aria-label="Post type">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} class={`text-[11px] font-bold tracking-wider uppercase pb-1 border-b-2 ${tab === t.id ? "border-current" : "xl-muted border-transparent hover:opacity-80"}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <span class="ml-auto text-[11px] xl-muted">{rows.length}</span>
        <button class="xl-btn icon" aria-pressed={searching} onClick={() => { setSearching(!searching); if (searching) setQ(""); }} title="Search" aria-label="Search posts"><Icon.search size={14} /></button>
      </div>
      {searching && <input class="xl-input" type="search" autoFocus placeholder="Search text" aria-label="Search posts" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />}
      {rows.length === 0 ? (
        <EmptyState title="Nothing here" hint={tab === "worst" ? "Worst only ranks posts with at least 100 impressions." : "Try another period or tab."} />
      ) : tab === "best" || tab === "worst" ? (
        rows.map((t, i) => <TweetCard key={t.id} tweet={t} rank={i + 1} />)
      ) : (
        <table class="xl-table">
          <thead>
            <tr>
              <th aria-sort={sort === "created_at" ? (desc ? "descending" : "ascending") : "none"} class="cursor-pointer select-none" onClick={() => clickSort("created_at")}>Time{sort === "created_at" ? (desc ? " ↓" : " ↑") : ""}</th>
              <th>Content</th>
              {COLUMNS.map((c) => {
                const I = Icon[c.icon];
                return (
                  <th key={c.key} class="cursor-pointer select-none" title={`${c.title}${sort === c.key ? (desc ? " (descending)" : " (ascending)") : ""}`} aria-sort={sort === c.key ? (desc ? "descending" : "ascending") : "none"} onClick={() => clickSort(c.key)} style={sort === c.key && c.color ? { color: c.color } : undefined}>
                    <I size={14} />
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
