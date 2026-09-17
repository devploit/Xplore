import { useState } from "preact/hooks";
import type { TweetRow } from "@/data/db";
import { ops } from "@/x-api/operations";
import { XApiError } from "@/x-api/client";
import { services } from "../services";
import { toast } from "../store";
import { Icon } from "./icons";

type Action = "like" | "retweet" | "bookmark";

export function QuickActions({ tweet }: { tweet: TweetRow }) {
  const [state, setState] = useState<Record<Action, boolean>>({ like: false, retweet: false, bookmark: false });
  const [busy, setBusy] = useState<Action | null>(null);

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

  const btn = (action: Action, label: string, I: (typeof Icon)[keyof typeof Icon]) => (
    <button class="xl-btn icon" aria-pressed={state[action]} disabled={busy !== null} onClick={() => run(action)} title={label} aria-label={label}>
      <I size={13} />
    </button>
  );
  return (
    <span class="inline-flex gap-1">
      {btn("like", "Like", Icon.heart)}
      {btn("retweet", "Retweet", Icon.repeat)}
      {btn("bookmark", "Bookmark", Icon.bookmark)}
      <button class="xl-btn icon" onClick={copy} title="Copy text" aria-label="Copy text"><Icon.copy size={13} /></button>
    </span>
  );
}
