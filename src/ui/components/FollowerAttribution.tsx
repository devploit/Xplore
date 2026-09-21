import { useEffect, useState } from "preact/hooks";
import { liveQuery } from "dexie";
import type { TweetRow, UserRow } from "@/data/db";
import { externalCandidates, followerAttribution, ownCandidates, type Candidate, type PostAttribution } from "@/analytics";
import { services } from "../services";
import { followerPoints, selectedTweetId, userId } from "../store";
import { navigateX, tweetUrl } from "../navigate";
import { signed } from "./format";
import { CardLabel } from "./Section";
import { Icon } from "./icons";

const WINDOW_MS = 24 * 3_600_000;

function label(p: PostAttribution): string {
  const who = p.author ? `@${p.author.screen_name}` : "someone";
  switch (p.kind) {
    case "reply": return "Your reply: ";
    case "mention": return `${who} mentioned you: `;
    case "quote": return `${who} quoted you: `;
    case "reply-to-you": return `${who} replied to you: `;
    default: return "";
  }
}

/**
 * Which posts coincided with follower gains: yours, and other people's posts that mentioned, quoted
 * or replied to you. Built from the follower count Xplore notes as you browse.
 */
export function FollowerAttribution({ tweets, start, end }: { tweets: TweetRow[]; start: number; end: number }) {
  const me = userId.value;
  const [external, setExternal] = useState<Candidate[]>([]);
  useEffect(() => {
    if (!me) return;
    const db = services.db;
    const sub = liveQuery(async () => {
      const others = await db.tweets.where("created_at").between(start - WINDOW_MS, end, true, true).filter((t) => t.user_id_str !== me).toArray();
      const authors = await db.users.bulkGet([...new Set(others.map((t) => t.user_id_str))]);
      const byId = new Map(authors.filter((u): u is UserRow => !!u).map((u) => [u.id, u]));
      return externalCandidates(others, me, new Set(tweets.map((t) => t.id)), byId);
    }).subscribe({ next: setExternal, error: () => setExternal([]) });
    return () => sub.unsubscribe();
  }, [me, start, end, tweets]);

  const points = followerPoints.value.filter((p) => p.taken_at >= start && p.taken_at <= end);
  const r = followerAttribution(points, [...ownCandidates(tweets), ...external]);
  const top = r.posts.slice(0, 5);
  const open = (p: PostAttribution) => {
    if (p.kind === "post" || p.kind === "reply") selectedTweetId.value = p.tweet.id;
    else navigateX(tweetUrl(p.author?.screen_name ?? "i", p.tweet.id));
  };
  return (
    <div class="xl-card xl-card-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1"><Icon.user size={12} /><CardLabel>What brought followers</CardLabel></div>
        <span class="text-[11px] xl-muted">{r.points} point{r.points === 1 ? "" : "s"} · {signed(r.total)} in period</span>
      </div>
      {r.points < 2 ? (
        <div class="text-xs xl-muted mt-1.5">Xplore notes your follower count every time X reports it while you browse. Come back after a day or two of use.</div>
      ) : top.length === 0 ? (
        <div class="text-xs xl-muted mt-1.5">No follower gains landed within a day of anything Xplore saw in this period.</div>
      ) : (
        <div class="mt-2 flex flex-col gap-1.5 text-[12px]">
          {top.map((p) => (
            <button key={p.tweet.id} class="flex items-center gap-2 text-left w-full hover:opacity-80" onClick={() => open(p)} title={p.kind === "post" || p.kind === "reply" ? "Open post details" : "Open on X"}>
              <span class="font-semibold tabular-nums w-10 shrink-0 text-emerald-400">+{p.gained}</span>
              <span class="truncate flex-1 min-w-0"><span class="xl-muted">{label(p)}</span>{p.tweet.full_text}</span>
              <span class="xl-muted shrink-0 tabular-nums">{Math.round(p.share * 100)}%</span>
            </button>
          ))}
          {r.unattributed > 0 && <div class="text-[10.5px] xl-muted mt-0.5">+{r.unattributed} arrived with nothing Xplore saw in the previous 24 h.</div>}
        </div>
      )}
      <div class="text-[10.5px] xl-muted mt-1.5">Gains are split among your posts, your replies, and other people's mentions, quotes and replies to you from the previous 24 h, by impressions. Coincidence, not proof.</div>
    </div>
  );
}
