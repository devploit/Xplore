import type { FrequencyGrid, HourCell } from "@/analytics";

function shade(v: number, max: number, accent = true): string {
  if (max <= 0 || v <= 0) return "var(--xl-hover)";
  const a = 0.3 + 0.7 * Math.min(1, v / max);
  return accent ? `color-mix(in srgb, var(--xl-accent) ${Math.round(a * 100)}%, transparent)` : `rgba(249,115,22,${a.toFixed(2)})`;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Numeric key under a heatmap so color is never the only carrier of the value. */
function Legend({ min, max, unit }: { min: number; max: number; unit: string }) {
  return (
    <div class="flex items-center gap-1.5 text-[10px] xl-muted mt-1.5" aria-hidden="true">
      <span>{min} {unit}</span>
      <span class="inline-flex gap-[2px]">
        {[0.15, 0.4, 0.65, 0.9].map((k) => <span key={k} class="inline-block w-[10px] h-[10px] rounded-[2px]" style={{ background: shade(k * max || 1, max || 1) }} />)}
      </span>
      <span>{max} {unit}</span>
    </div>
  );
}

/** Days before `coverageStart` are drawn hatched: nothing was loaded for them, which is not the same as zero. */
export function FrequencyHeatmap({ grid, coverageStart }: { grid: FrequencyGrid; coverageStart?: number | undefined }) {
  // Month label under the first week that starts a new month.
  const labels = grid.weeks.map((w, i) => {
    const d = new Date(w[0]!.start);
    const prev = i > 0 ? new Date(grid.weeks[i - 1]![0]!.start) : null;
    return !prev || prev.getMonth() !== d.getMonth() ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : "";
  });
  return (
    <div class="flex gap-2 text-[10px] xl-muted" role="group" aria-label="Daily activity for the last 18 weeks">
      <div class="flex flex-col gap-[3px] pt-0 pr-1 text-right">
        {DAYS.map((d, i) => (
          <div key={d} class="h-[13px] leading-[13px]">{i % 2 === 0 ? d : ""}</div>
        ))}
      </div>
      <div class="flex-1 overflow-hidden">
        <div class="flex gap-[3px]">
          {grid.weeks.map((week, w) => (
            <div key={w} class="flex flex-col gap-[3px] flex-1 min-w-0">
              {week.map((c) => {
                const unknown = coverageStart !== undefined && c.start < coverageStart && c.count === 0;
                const label = unknown ? `${c.day}: not loaded yet` : `${c.count} activities on ${c.day}`;
                return <div key={c.day} class={`h-[13px] rounded-[3px] ${unknown ? "xl-unknown" : ""}`} role="img" aria-label={label} style={unknown ? undefined : { background: shade(c.count, grid.max) }} title={label} />;
              })}
            </div>
          ))}
        </div>
        <div class="flex gap-[3px] mt-1">
          {labels.map((l, i) => (
            <div key={i} class="flex-1 min-w-0 whitespace-nowrap overflow-visible">{l}</div>
          ))}
        </div>
        <Legend min={grid.min} max={grid.max} unit="posts" />
      </div>
    </div>
  );
}

type HourMetric = "impressions" | "count" | "avg";

/** Average impressions per post in the cell; the same figure "best times" ranks by. */
function cellValue(c: HourCell, metric: HourMetric): number {
  if (metric === "avg") return c.count ? Math.round(c.impressions / c.count) : 0;
  return c[metric];
}

export function HourWeekdayHeatmap({ grid, metric = "avg" }: { grid: HourCell[][]; metric?: HourMetric }) {
  const max = Math.max(0, ...grid.flat().map((c) => cellValue(c, metric)));
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div class="text-[10px] xl-muted" role="group" aria-label={`${metric} by weekday and hour`}>
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
              const avg = c.count ? Math.round(c.impressions / c.count) : 0;
              const label = c.count ? `${avg} impressions per post, ${c.count} post${c.count === 1 ? "" : "s"}, on ${DAYS_LONG[d]} at ${h}:00` : `No posts on ${DAYS_LONG[d]} at ${h}:00`;
              return <div key={`${d}-${h}`} class="h-[11px] rounded-[2px]" role="img" aria-label={label} style={{ background: shade(cellValue(c, metric), max) }} title={label} />;
            })}
          </>
        ))}
      </div>
      <Legend min={0} max={max} unit={metric === "avg" ? "avg impressions" : metric} />
    </div>
  );
}
