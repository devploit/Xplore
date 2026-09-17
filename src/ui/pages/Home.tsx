import { useState } from "preact/hooks";
import { bestTweets, recentTweets, splitKinds } from "@/analytics";
import { periodData } from "../period";
import { TweetCard } from "../components/TweetCard";
import { PeriodSelect } from "../components/PeriodSelect";
import { EmptyState } from "../components/EmptyState";

export function Home() {
  const [tab, setTab] = useState<"best" | "recent">("best");
  const { tweets } = periodData.value;
  const list = tab === "best" ? bestTweets(tweets, 20) : recentTweets(splitKinds(tweets).tweets, 12);
  return (
    <section class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <div class="flex gap-2" role="tablist">
          <button role="tab" aria-selected={tab === "best"} class={`xl-btn ${tab === "best" ? "active" : ""}`} onClick={() => setTab("best")}>Highlights</button>
          <button role="tab" aria-selected={tab === "recent"} class={`xl-btn ${tab === "recent" ? "active" : ""}`} onClick={() => setTab("recent")}>Recents</button>
        </div>
        <PeriodSelect />
      </div>
      {list.length === 0 ? <EmptyState title="No posts yet" hint="Open your profile once so your posts are captured, or wait for the first sync." /> : list.map((t) => <TweetCard key={t.id} tweet={t} />)}
    </section>
  );
}
