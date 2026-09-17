import { Icon } from "./icons";

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div class="xl-card xl-card-2 text-center py-8 flex flex-col items-center gap-2">
      <span class="xl-muted"><Icon.search size={22} /></span>
      <div class="font-semibold">{title}</div>
      {hint && <div class="text-xs xl-muted max-w-[300px]">{hint}</div>}
    </div>
  );
}
