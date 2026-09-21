import { settings, updateSettings } from "../store";
import { endOfDay } from "./PeriodSelect";

function toInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromInput(value: string): number | undefined {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d).getTime();
}

/** From/to date pickers shown under the header while the period is Custom. Applies to every page. */
export function CustomRange() {
  const range = settings.value.customRange ?? { start: Date.now(), end: endOfDay(Date.now()) };
  const today = toInput(Date.now());
  const set = (patch: Partial<typeof range>) => {
    const next = { ...range, ...patch };
    // Keep the range ordered: moving one end past the other drags the other along.
    if (next.start > next.end) {
      if (patch.start !== undefined) next.end = endOfDay(next.start);
      else next.start = new Date(next.end).setHours(0, 0, 0, 0);
    }
    void updateSettings({ customRange: next });
  };
  const days = Math.round((endOfDay(range.end) - range.start) / 86_400_000);
  return (
    <div class="flex items-center gap-2 px-3 py-1.5 border-b xl-border text-[12px] xl-fade" role="group" aria-label="Custom date range">
      <label class="flex items-center gap-1.5"><span class="xl-muted">From</span><input class="xl-input py-[3px] text-[12px]" type="date" max={today} value={toInput(range.start)} aria-label="Start date" onChange={(e) => { const v = fromInput((e.target as HTMLInputElement).value); if (v !== undefined) set({ start: v }); }} /></label>
      <label class="flex items-center gap-1.5"><span class="xl-muted">to</span><input class="xl-input py-[3px] text-[12px]" type="date" max={today} value={toInput(range.end)} aria-label="End date" onChange={(e) => { const v = fromInput((e.target as HTMLInputElement).value); if (v !== undefined) set({ end: endOfDay(v) }); }} /></label>
      <span class="ml-auto xl-muted whitespace-nowrap">{days} day{days === 1 ? "" : "s"}</span>
    </div>
  );
}
