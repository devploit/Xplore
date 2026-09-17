export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div class="xl-card text-center py-8">
      <div class="font-semibold">{title}</div>
      {hint && <div class="text-xs xl-muted mt-1">{hint}</div>}
    </div>
  );
}
