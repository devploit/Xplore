import { ownTweets, selectedBucket } from "../store";
import { Overlay } from "./Overlay";
import { TweetCard } from "./TweetCard";
import { EmptyState } from "./EmptyState";

/** The user's posts published inside one chart bucket, opened by clicking a point. */
export function BucketPosts({ start, end, title }: { start: number; end: number; title: string }) {
  const close = () => (selectedBucket.value = undefined);
  const list = ownTweets.value.filter((t) => t.created_at >= start && t.created_at < end).sort((a, b) => b.view_count - a.view_count);
  return (
    <Overlay title={title} onClose={close}>
      <div class="text-[11px] xl-muted px-1">{list.length} post{list.length === 1 ? "" : "s"} published in this slot, by impressions</div>
      {list.length === 0 ? <EmptyState title="Nothing published here" hint="Pick another point on the chart." /> : list.map((t) => <TweetCard key={t.id} tweet={t} />)}
    </Overlay>
  );
}
