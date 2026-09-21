import { useEffect, useState } from "preact/hooks";
import type { TweetRow } from "@/data/db";
import { ops } from "@/x-api/operations";
import { XApiError } from "@/x-api/client";
import { services } from "../services";
import { toast } from "../store";
import { navigateX, tweetUrl } from "../navigate";
import { Icon } from "./icons";

type Action = "like" | "retweet" | "bookmark";
const FIELD: Record<Action, "favorited" | "retweeted" | "bookmarked"> = { like: "favorited", retweet: "retweeted", bookmark: "bookmarked" };

/** Like, retweet, bookmark and copy. State starts from what X reported and is written back to the local row. */
export function QuickActions({ tweet, authorHandle }: { tweet: TweetRow; authorHandle?: string }) {
  const [state, setState] = useState<Record<Action, boolean>>({ like: !!tweet.favorited, retweet: !!tweet.retweeted, bookmark: !!tweet.bookmarked });
  const [busy, setBusy] = useState<Action | null>(null);
  useEffect(() => setState({ like: !!tweet.favorited, retweet: !!tweet.retweeted, bookmark: !!tweet.bookmarked }), [tweet.id, tweet.favorited, tweet.retweeted, tweet.bookmarked]);

  const run = async (action: Action) => {
    if (busy) return;
    setBusy(action);
    const on = state[action];
    try {
      const c = services.client;
      if (action === "like") await (on ? ops.unfavorite(c, tweet.id) : ops.favorite(c, tweet.id));
      if (action === "retweet") await (on ? ops.unretweet(c, tweet.id) : ops.retweet(c, tweet.id));
      if (action === "bookmark") await (on ? ops.unbookmark(c, tweet.id) : ops.bookmark(c, tweet.id));
      setState({ ...state, [action]: !on });
      const patch: Partial<TweetRow> = { [FIELD[action]]: !on };
      if (action === "like") patch.favorite_count = Math.max(0, tweet.favorite_count + (on ? -1 : 1));
      if (action === "retweet") patch.retweet_count = Math.max(0, tweet.retweet_count + (on ? -1 : 1));
      if (action === "bookmark") patch.bookmark_count = Math.max(0, tweet.bookmark_count + (on ? -1 : 1));
      await services.db.tweets.update(tweet.id, patch);
    } catch (err) {
      toast(err instanceof XApiError ? `${action} failed: ${err.kind}` : `${action} failed`, "error");
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tweet.full_text);
      toast("Text copied");
    } catch {
      toast("Clipboard unavailable", "error");
    }
  };

  const btn = (action: Action, label: string, I: (typeof Icon)[keyof typeof Icon], activeColor: string) => (
    <button class="xl-btn icon" aria-pressed={state[action]} disabled={busy !== null} onClick={() => run(action)} title={state[action] ? `Undo ${label.toLowerCase()}` : label} aria-label={label} style={state[action] ? { background: "transparent", borderColor: "transparent", color: activeColor } : undefined}>
      <I size={13} fill={state[action] ? "currentColor" : "none"} />
    </button>
  );
  return (
    <span class="inline-flex gap-1">
      {btn("like", "Like", Icon.heart, "#f91880")}
      {btn("retweet", "Retweet", Icon.repeat, "#22c55e")}
      {btn("bookmark", "Bookmark", Icon.bookmark, "#1d9bf0")}
      <button class="xl-btn icon" onClick={() => navigateX(tweetUrl(authorHandle ?? "i", tweet.id))} title="Reply on X" aria-label="Reply on X"><Icon.reply size={13} /></button>
      <button class="xl-btn icon" onClick={copy} title="Copy text" aria-label="Copy text"><Icon.copy size={13} /></button>
    </span>
  );
}
