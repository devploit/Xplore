import type { ComponentChildren } from "preact";

/** Uppercase muted section heading, the rhythm SuperX uses between blocks. */
export function SectionTitle({ children, right }: { children: ComponentChildren; right?: ComponentChildren }) {
  return (
    <div class="flex items-center justify-between px-1 pt-1">
      <h2 class="text-[11px] font-bold tracking-wider uppercase xl-muted">{children}</h2>
      {right && <div class="text-[11px] xl-muted">{right}</div>}
    </div>
  );
}

export function CardLabel({ children }: { children: ComponentChildren }) {
  return <div class="text-[10.5px] font-bold tracking-wider uppercase xl-muted">{children}</div>;
}
