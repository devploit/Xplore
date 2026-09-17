import { useEffect, useState } from "preact/hooks";
import { liveQuery } from "dexie";
import type { TweetRow, UserRow } from "@/data/db";
import { services } from "../services";
import { ownTweets, settings, updateSettings, userId } from "../store";
import { TweetCard } from "../components/TweetCard";
import { EmptyState } from "../components/EmptyState";

interface Mention {
  tweet: TweetRow;
  author?: UserRow;
  kind: "reply" | "quote";
  replied: boolean;
}

export function Mentions() {
  const [items, setItems] = useState<Mention[]>([]);
  const [loading, setLoading] = useState(false);
  const f = settings.value.mentionFilters;
  const me = userId.value;

  useEffect(() => {
    if (!me) return;
    const db = services.db;
    const sub = liveQuery(async () => {
      const ownIds = new Set(ownTweets.value.map((t) => t.id));
      const repliedTo = new Set(ownTweets.value.map((t) => t.in_reply_to_status_id_str).filter(Boolean));
      const replies = await db.tweets.where("in_reply_to_user_id_str").equals(me).toArray();
      const quotes = ownIds.size ? await db.tweets.where("quoted_status_id_str").anyOf([...ownIds]).toArray() : [];
      const all = new Map<string, Mention>();
      for (const t of replies) if (t.user_id_str !== me) all.set(t.id, { tweet: t, kind: "reply", replied: repliedTo.has(t.id) });
      for (const t of quotes) if (t.user_id_str !== me && !all.has(t.id)) all.set(t.id, { tweet: t, kind: "quote", replied: repliedTo.has(t.id) });
      const authors = await db.users.bulkGet([...new Set([...all.values()].map((m) => m.tweet.user_id_str))]);
      const byId = new Map(authors.filter((u): u is UserRow => !!u).map((u) => [u.id, u]));
      return [...all.values()].map((m) => {
        const author = byId.get(m.tweet.user_id_str);
        return author ? { ...m, author } : m;
      });
    }).subscribe({ next: setItems });
    return () => sub.unsubscribe();
  }, [me, ownTweets.value]);

  const refresh = async (force: boolean) => {
    setLoading(true);
    try {
      await services.scheduler.refreshMentions(force);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh(false);
  }, []);

  const filtered = items
    .filter((m) => m.tweet.favorite_count >= f.minLikes && m.tweet.retweet_count >= f.minRetweets && m.tweet.view_count >= f.minImpressions)
    .filter((m) => (m.author?.followers_count ?? 0) >= f.minFollowers)
    .filter((m) => !f.verifiedOnly || m.author?.is_blue_verified || m.author?.verified)
    .filter((m) => !f.hideReplied || !m.replied)
    .sort((a, b) => (f.sort === "top" ? b.tweet.favorite_count - a.tweet.favorite_count || b.tweet.view_count - a.tweet.view_count : b.tweet.created_at - a.tweet.created_at));

  const num = (key: "minLikes" | "minRetweets" | "minImpressions" | "minFollowers", label: string) => (
    <label class="flex items-center gap-1 text-xs">
      {label}
      <input class="xl-input w-16" type="number" min={0} value={f[key]} onChange={(e) => void updateSettings({ mentionFilters: { ...f, [key]: Number((e.target as HTMLInputElement).value) || 0 } })} />
    </label>
  );

  return (
    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap gap-2 items-center">
        {num("minLikes", "♥ ≥")}
        {num("minRetweets", "↻ ≥")}
        {num("minImpressions", "👁 ≥")}
        {num("minFollowers", "Followers ≥")}
        <label class="flex items-center gap-1 text-xs"><input type="checkbox" checked={f.verifiedOnly} onChange={(e) => void updateSettings({ mentionFilters: { ...f, verifiedOnly: (e.target as HTMLInputElement).checked } })} /> Verified</label>
        <label class="flex items-center gap-1 text-xs"><input type="checkbox" checked={f.hideReplied} onChange={(e) => void updateSettings({ mentionFilters: { ...f, hideReplied: (e.target as HTMLInputElement).checked } })} /> Hide replied</label>
        <select class="xl-input" aria-label="Sort" value={f.sort} onChange={(e) => void updateSettings({ mentionFilters: { ...f, sort: (e.target as HTMLSelectElement).value as "latest" | "top" } })}>
          <option value="latest">Latest</option>
          <option value="top">Top</option>
        </select>
        <button class="xl-btn ml-auto" disabled={loading} onClick={() => void refresh(true)}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="No mentions captured" hint="Mentions arrive from your notifications as you browse and from a background search every 10 minutes." />
      ) : (
        filtered.map((m) => (
          <div key={m.tweet.id} class="relative">
            <span class="absolute -top-2 left-3 text-[10px] px-1 rounded xl-muted" style={{ background: "var(--xl-bg)" }}>{m.kind}{m.replied ? " · replied" : ""}</span>
            <TweetCard tweet={m.tweet} screenName={m.author?.screen_name ?? "i"} />
          </div>
        ))
      )}
    </section>
  );
}
