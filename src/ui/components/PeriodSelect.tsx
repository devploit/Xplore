import { CUSTOM_PERIOD, PERIODS, periodStart } from "@/analytics";
import { settings, updateSettings } from "../store";

const SHORT: Record<number, string> = { 0: "Today", 7: "7 days", 14: "14 days", 30: "30 days", 60: "60 days", 90: "90 days", 180: "180 days", "-1": "All time", "-2": "Custom" };

/** End of the local day that contains `ts`. */
export function endOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function PeriodSelect() {
  const choose = (value: number) => {
    // First time in Custom: start from the last 30 days so the inputs are not empty.
    const range = value === CUSTOM_PERIOD && !settings.value.customRange ? { start: periodStart(29), end: endOfDay(Date.now()) } : settings.value.customRange;
    void updateSettings({ period: value, customRange: range });
  };
  return (
    <select class="xl-input w-full font-semibold text-[12.5px] py-[5px]" aria-label="Period" value={String(settings.value.period)} onChange={(e) => choose(Number((e.target as HTMLSelectElement).value))}>
      {PERIODS.map((p) => (
        <option key={p.days} value={String(p.days)}>{SHORT[p.days] ?? p.label}</option>
      ))}
    </select>
  );
}
