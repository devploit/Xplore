import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { Point } from "@/analytics";
import { cumulative, halfChange, total } from "@/analytics";
import { settings } from "../store";
import { compact, signed } from "./format";
import { LineChart } from "./LineChart";
import { PosterModal } from "./Poster";

export function StatBlock({ title, points, color, share, extra, format = compact }: { title: string; points: Point[]; color: string; share?: number | undefined; extra?: ComponentChildren; format?: (n: number) => string }) {
  const [share_, setShare] = useState(false);
  const s = settings.value;
  const shown = s.cumulative ? cumulative(points) : points;
  const sum = total(points);
  const change = halfChange(points);
  const body = (
    <div>
      <div class="flex items-baseline justify-between">
        <div class="text-xs xl-muted">{title}{share !== undefined && <span class="ml-2">{share}%</span>}</div>
        <div class="flex items-baseline gap-2">
          <strong class="text-lg">{format(sum)}</strong>
          {s.showChange && <span class={`text-xs ${change >= 0 ? "text-emerald-500" : "text-red-500"}`} title="Second half minus first half of the period">{signed(change)}</span>}
        </div>
      </div>
      <LineChart points={shown} color={color} />
      {extra}
    </div>
  );
  return (
    <div class="xl-card relative">
      <button class="xl-btn absolute top-2 right-2 text-[10px] opacity-60 hover:opacity-100" onClick={() => setShare(true)} title="Share chart">⤴</button>
      {body}
      {share_ && (
        <PosterModal title={title} onClose={() => setShare(false)}>
          {body}
        </PosterModal>
      )}
    </div>
  );
}
