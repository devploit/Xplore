import { PERIODS } from "@/analytics";
import { settings, updateSettings } from "../store";

const SHORT: Record<number, string> = { 0: "Today", 7: "7 days", 14: "14 days", 30: "30 days", 60: "60 days", 90: "90 days", 180: "180 days", "-1": "All time" };

export function PeriodSelect() {
  return (
    <select class="xl-input font-semibold text-[12.5px] py-[5px]" aria-label="Period" value={String(settings.value.period)} onChange={(e) => void updateSettings({ period: Number((e.target as HTMLSelectElement).value) })}>
      {PERIODS.map((p) => (
        <option key={p.days} value={String(p.days)}>{SHORT[p.days] ?? p.label}</option>
      ))}
    </select>
  );
}
