import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { Point } from "@/analytics";
import { cumulative, halfChange, total } from "@/analytics";
import { selectedBucket, settings } from "../store";
import { compact } from "./format";
import { AnimatedNumber } from "./AnimatedNumber";
import { LineChart, pointTitle } from "./LineChart";
import { PosterModal } from "./Poster";
import { Icon } from "./icons";
import { CardLabel } from "./Section";

interface Props {
  title: string;
  points: Point[];
  color: string;
  /** share of all engagement, shown faded bottom right like SuperX */
  share?: number | undefined;
  /** overrides the big number (for followers: latest absolute count) */
  value?: number | undefined;
  /** overrides the delta (for followers: change over the period) */
  delta?: number | undefined;
  format?: (n: number) => string;
  aside?: ComponentChildren;
  tall?: boolean;
  /** same metric over the previous period, drawn dashed when settings.showCompare is on */
  compare?: Point[] | undefined;
  /** clicking a point opens the posts of that bucket */
  drill?: boolean;
}

export function StatCard({ title, points, color, share, value, delta, format = compact, aside, tall = false, compare, drill = true }: Props) {
  const [sharing, setSharing] = useState(false);
  const s = settings.value;
  const shown = s.cumulative ? cumulative(points) : points;
  const shownCompare = s.showCompare && compare ? (s.cumulative ? cumulative(compare) : compare) : undefined;
  const select = drill ? (i: number) => { const p = points[i]; if (p) selectedBucket.value = { start: p.start, end: p.end, title: `${title} · ${pointTitle(p)}` }; } : undefined;
  const big = value ?? total(points);
  const change = delta ?? halfChange(points);
  const body = (
    <div class={`relative ${tall ? "h-[150px]" : "h-[120px]"}`}>
      <div class="absolute inset-x-0 bottom-0 h-[62%] opacity-90">
        <LineChart points={shown} color={color} height={tall ? 93 : 74} bare format={format} compare={shownCompare} onSelect={select} />
      </div>
      <div class="relative flex items-start justify-between">
        <div>
          <CardLabel>{title}</CardLabel>
          <div class="flex items-baseline gap-2 mt-1">
            <span class="text-[28px] font-extrabold leading-none tracking-tight tabular-nums"><AnimatedNumber value={big} format={format} /></span>
            {s.showChange && change !== 0 && (
              <span class={`text-[13px] font-semibold ${change > 0 ? "text-emerald-400" : "text-red-400"}`} title="Change: second half minus first half of the period">
                {change > 0 ? "↑" : "↓"} {format(Math.abs(change))}
              </span>
            )}
          </div>
        </div>
        {aside}
      </div>
      {share !== undefined && <div class="absolute bottom-0 right-1 text-[22px] font-extrabold xl-muted opacity-50 leading-none">{share}%</div>}
    </div>
  );
  return (
    <div class="xl-card xl-card-2 relative overflow-hidden group">
      <button class="xl-btn icon absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity" onClick={() => setSharing(true)} title="Share as poster" aria-label={`Share ${title} as poster`}>
        <Icon.share size={13} />
      </button>
      {body}
      {sharing && (
        <PosterModal title={title} onClose={() => setSharing(false)}>
          <div class="xl-card xl-card-2">{body}</div>
        </PosterModal>
      )}
    </div>
  );
}
