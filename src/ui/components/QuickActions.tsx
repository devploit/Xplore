import { useState } from "preact/hooks";
import type { TweetRow } from "@/data/db";
import { ops } from "@/x-api/operations";
import { XApiError } from "@/x-api/client";
import { services } from "../services";
import { toast } from "../store";

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
      toast("Copied");
    } catch {
      toast("Clipboard unavailable", "error");
    }
  };

  return (
    <div class="flex gap-2 text-xs">
      <button class="xl-btn" aria-pressed={state.like} disabled={busy !== null} onClick={() => run("like")} title="Like">♥</button>
      <button class="xl-btn" aria-pressed={state.retweet} disabled={busy !== null} onClick={() => run("retweet")} title="Retweet">↻</button>
      <button class="xl-btn" aria-pressed={state.bookmark} disabled={busy !== null} onClick={() => run("bookmark")} title="Bookmark">🔖</button>
      <button class="xl-btn" onClick={copy} title="Copy text">⧉</button>
    </div>
  );
}
