import { useEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Icon } from "./icons";

/**
 * Full-panel layer for detail views. Escape and the back button close it; focus moves inside
 * on open and returns to the previously focused element on close.
 */
export function Overlay({ title, onClose, children, actions }: { title: ComponentChildren; onClose: () => void; children: ComponentChildren; actions?: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current?.getRootNode() as ShadowRoot | Document | null;
    const focused = (root && "activeElement" in root ? root.activeElement : null) as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      (focused ?? previous)?.focus?.();
    };
  }, [onClose]);
  return (
    <div ref={ref} class="xl-overlay xl-fade" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
      <header class="flex items-center gap-2 px-2 py-2 border-b xl-border shrink-0">
        <button class="xl-btn icon" onClick={onClose} aria-label="Back" title="Back (Esc)"><Icon.back size={15} /></button>
        <div class="font-semibold text-[13px] truncate flex-1 min-w-0">{title}</div>
        {actions}
      </header>
      <div class="flex-1 overflow-y-auto xl-scroll p-3 flex flex-col gap-2.5">{children}</div>
    </div>
  );
}
