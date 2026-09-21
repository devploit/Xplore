import { useState } from "preact/hooks";
import { bestTweets, evergreen, recentTweets, splitKinds } from "@/analytics";
import { periodData } from "../period";
import { backfillState, ownTweets, storeReady } from "../store";
import { TweetCard } from "../components/TweetCard";
import { EmptyState } from "../components/EmptyState";
import { Segmented } from "../components/Segmented";
import { SkeletonPage } from "../components/Skeleton";
import { Welcome } from "../components/Welcome";

export function Home() {
  const [tab, setTab] = useState<"best" | "recent" | "evergreen">("best");
  const { tweets } = periodData.value;
  // Evergreen ignores the period on purpose: it looks for old posts worth bringing back.
  const list = tab === "best" ? bestTweets(tweets, 20) : tab === "recent" ? recentTweets(splitKinds(tweets).tweets, 12) : evergreen(ownTweets.value, Date.now(), 60, 10);
  if (!storeReady.value) return <SkeletonPage />;
  // Shown until history is complete, unless enough posts are already in to make the page useful.
  const onboarding = ownTweets.value.length === 0 || (!backfillState.value?.completed_at && ownTweets.value.length < 100);
  return (
    <section class="flex flex-col gap-3">
      {onboarding && <Welcome />}
      <div class="flex items-center justify-between gap-2">
        <Segmented value={tab} onChange={setTab} label="Home view" options={[{ id: "best", label: "Highlights" }, { id: "recent", label: "Recents" }, { id: "evergreen", label: "Evergreen" }]} />
        <span class="text-[11px] xl-muted">{list.length} posts</span>
      </div>
      {tab === "evergreen" && <div class="text-[11px] xl-muted px-1">Your posts older than 60 days that did well. Most people following you now never saw them: open one on X and repost or rewrite it.</div>}
      {list.length === 0 ? (onboarding ? null : <EmptyState title={tab === "evergreen" ? "Nothing to bring back yet" : "No posts in this period"} hint={tab === "evergreen" ? "Evergreen needs posts older than 60 days with likes or bookmarks." : "Try a longer period."} />) : list.map((t, i) => <TweetCard key={t.id} tweet={t} rank={tab === "best" ? i + 1 : undefined} />)}
    </section>
  );
}
