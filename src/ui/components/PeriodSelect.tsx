import { PERIODS } from "@/analytics";
import { settings, updateSettings } from "../store";

export function PeriodSelect() {
  return (
    <select class="xl-input" aria-label="Period" value={String(settings.value.period)} onChange={(e) => void updateSettings({ period: Number((e.target as HTMLSelectElement).value) })}>
      {PERIODS.map((p) => (
        <option key={p.days} value={String(p.days)}>{p.label}</option>
      ))}
    </select>
  );
}
