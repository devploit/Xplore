/** Placeholder blocks shown while the database answers its first query. */
export function Skeleton({ height = 16, width = "100%", class: cls = "" }: { height?: number; width?: string; class?: string }) {
  return <div class={`xl-skeleton ${cls}`} style={{ height: `${height}px`, width }} aria-hidden="true" />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div class="xl-card xl-card-2 flex flex-col gap-2" aria-hidden="true">
      <Skeleton height={10} width="40%" />
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} height={12} width={i === lines - 1 ? "60%" : "100%"} />)}
    </div>
  );
}

export function SkeletonPage() {
  return (
    <div class="flex flex-col gap-2.5" role="status" aria-label="Loading">
      <div class="xl-card xl-card-2"><Skeleton height={90} /></div>
      <div class="grid grid-cols-2 gap-2.5">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}
