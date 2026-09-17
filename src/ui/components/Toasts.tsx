import { toasts } from "../store";

export function Toasts() {
  if (!toasts.value.length) return null;
  return (
    <div class="fixed bottom-4 right-4 flex flex-col gap-2 z-50" role="status" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`px-3 py-2 rounded-lg text-sm shadow ${t.kind === "error" ? "bg-red-600 text-white" : "bg-neutral-800 text-white"}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
