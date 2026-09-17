import type { FrequencyGrid, HourCell } from "@/analytics";

function shade(v: number, max: number, accent = true): string {
  if (max <= 0 || v <= 0) return "var(--xl-hover)";
  const a = 0.3 + 0.7 * Math.min(1, v / max);
  return accent ? `color-mix(in srgb, var(--xl-accent) ${Math.round(a * 100)}%, transparent)` : `rgba(249,115,22,${a.toFixed(2)})`;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function FrequencyHeatmap({ grid }: { grid: FrequencyGrid }) {
  // Month label under the first week that starts a new month.
  const labels = grid.weeks.map((w, i) => {
    const d = new Date(w[0]!.start);
    const prev = i > 0 ? new Date(grid.weeks[i - 1]![0]!.start) : null;
    return !prev || prev.getMonth() !== d.getMonth() ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : "";
  });
  return (
    <div class="flex gap-2 text-[10px] xl-muted" role="img" aria-label="Daily activity for the last 18 weeks">
      <div class="flex flex-col gap-[3px] pt-0 pr-1 text-right">
        {DAYS.map((d, i) => (
          <div key={d} class="h-[13px] leading-[13px]">{i % 2 === 0 ? d : ""}</div>
        ))}
      </div>
      <div class="flex-1 overflow-hidden">
        <div class="flex gap-[3px]">
          {grid.weeks.map((week, w) => (
            <div key={w} class="flex flex-col gap-[3px] flex-1 min-w-0">
              {week.map((c) => (
                <div key={c.day} class="h-[13px] rounded-[3px]" style={{ background: shade(c.count, grid.max) }} title={`${c.count} activities on ${c.day}`} />
              ))}
            </div>
          ))}
        </div>
        <div class="flex gap-[3px] mt-1">
          {labels.map((l, i) => (
            <div key={i} class="flex-1 min-w-0 whitespace-nowrap overflow-visible">{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function HourWeekdayHeatmap({ grid, metric = "impressions" }: { grid: HourCell[][]; metric?: "impressions" | "count" }) {
  const max = Math.max(0, ...grid.flat().map((c) => c[metric]));
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div class="text-[10px] xl-muted" role="img" aria-label={`${metric} by weekday and hour`}>
      <div class="grid gap-[2px]" style={{ gridTemplateColumns: "34px repeat(7, 1fr)" }}>
        <div />
        {DAYS.map((d) => (
          <div key={d} class="text-center pb-1">{d}</div>
        ))}
        {hours.map((h) => (
          <>
            <div key={`h${h}`} class="leading-[11px] pr-1 text-right">{h % 3 === 0 ? `${h}:00` : ""}</div>
            {grid.map((row, d) => {
              const c = row[h]!;
              return <div key={`${d}-${h}`} class="h-[11px] rounded-[2px]" style={{ background: shade(c[metric], max) }} title={`${c.impressions} impressions (${c.count} posts) on ${DAYS[d]} ${h}:00`} />;
            })}
          </>
        ))}
      </div>
    </div>
  );
}
