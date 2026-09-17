import { useState } from "preact/hooks";
import { bestTweets, recentTweets, splitKinds } from "@/analytics";
import { periodData } from "../period";
import { TweetCard } from "../components/TweetCard";
import { EmptyState } from "../components/EmptyState";
import { Segmented } from "../components/Segmented";

export function Home() {
  const [tab, setTab] = useState<"best" | "recent">("best");
  const { tweets } = periodData.value;
  const list = tab === "best" ? bestTweets(tweets, 20) : recentTweets(splitKinds(tweets).tweets, 12);
  return (
    <section class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <Segmented value={tab} onChange={setTab} label="Home view" options={[{ id: "best", label: "Highlights" }, { id: "recent", label: "Recents" }]} />
        <span class="text-[11px] xl-muted">{list.length} posts</span>
      </div>
      {list.length === 0 ? <EmptyState title="No posts yet" hint="Open your profile once so your posts are captured, or wait for the first sync (15 s after load)." /> : list.map((t, i) => <TweetCard key={t.id} tweet={t} rank={tab === "best" ? i + 1 : undefined} />)}
    </section>
  );
}
