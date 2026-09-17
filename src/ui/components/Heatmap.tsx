import type { FrequencyGrid, HourCell } from "@/analytics";

function shade(v: number, max: number): string {
  if (max <= 0 || v <= 0) return "rgba(128,128,128,0.15)";
  const a = 0.25 + 0.75 * Math.min(1, v / max);
  return `rgba(249,115,22,${a.toFixed(2)})`;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function FrequencyHeatmap({ grid }: { grid: FrequencyGrid }) {
  return (
    <div class="flex gap-[3px]" role="img" aria-label="Daily activity for the last 18 weeks">
      {grid.weeks.map((week, w) => (
        <div key={w} class="flex flex-col gap-[3px]">
          {week.map((c) => (
            <div key={c.day} class="w-[14px] h-[14px] rounded-[3px]" style={{ background: shade(c.count, grid.max) }} title={`${c.count} activities on ${c.day}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function HourWeekdayHeatmap({ grid }: { grid: HourCell[][] }) {
  const max = Math.max(0, ...grid.flat().map((c) => c.impressions));
  return (
    <div class="overflow-x-auto" role="img" aria-label="Impressions by weekday and hour">
      <div class="grid gap-[2px]" style={{ gridTemplateColumns: "28px repeat(24, 12px)" }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} class="text-[8px] xl-muted text-center">{h % 6 === 0 ? h : ""}</div>
        ))}
        {grid.map((row, d) => (
          <>
            <div key={`l${d}`} class="text-[9px] xl-muted leading-[12px]">{DAYS[d]}</div>
            {row.map((c, h) => (
              <div key={`${d}-${h}`} class="w-[12px] h-[12px] rounded-[2px]" style={{ background: shade(c.impressions, max) }} title={`${c.impressions} impressions (${c.count} posts) on ${DAYS[d]} ${h}:00`} />
            ))}
          </>
        ))}
      </div>
    </div>
  );
}
