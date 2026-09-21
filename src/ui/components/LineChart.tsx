import { useEffect, useRef } from "preact/hooks";
import { CategoryScale, Chart, Filler, LineController, LineElement, LinearScale, PointElement, Tooltip, type ActiveElement, type ChartEvent } from "chart.js";
import type { Point } from "@/analytics";
import { theme } from "../store";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);

/**
 * Area chart. `bare` hides axes and draws a soft gradient so it can sit behind a big number,
 * the way SuperX renders its engagement cards. Tooltips stay available in both modes.
 */
interface Props {
  points: Point[];
  color: string;
  height?: number;
  bare?: boolean;
  format?: (n: number) => string;
  /** previous period, drawn dashed behind the main line; aligned by index */
  compare?: Point[] | undefined;
  /** called with the index of the clicked point */
  onSelect?: ((index: number) => void) | undefined;
  /** replaces the date in the tooltip title, for curves whose x axis is not time */
  xTitle?: string;
}

/** Full local date, or date and hour for hourly buckets, for the tooltip title. */
export function pointTitle(p: Point): string {
  const hourly = p.end - p.start <= 3_600_000;
  return new Date(p.start).toLocaleString([], hourly ? { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}

export function LineChart({ points, color, height = 120, bare = false, format, compare, onSelect, xTitle }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dark = theme.value !== "light";
    const grid = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
    const tick = dark ? "#8b98a5" : "#536471";
    const fmt = format ?? String;
    chart.current?.destroy();
    chart.current = new Chart(canvas, {
      type: "line",
      data: {
        labels: points.map((p) => p.label),
        datasets: [
          ...(compare && compare.length
            ? [{ data: compare.slice(-points.length).map((p) => p.value), borderColor: dark ? "rgba(255,255,255,0.35)" : "rgba(15,20,25,0.3)", borderWidth: 1.2, borderDash: [4, 4], fill: false, tension: 0.25, pointRadius: 0, pointHitRadius: 12, order: 2 }]
            : []),
          {
            order: 1,
            data: points.map((p) => p.value),
            borderColor: bare ? (dark ? "rgba(255,255,255,0.55)" : "rgba(15,20,25,0.45)") : color,
            borderWidth: bare ? 1.5 : 2,
            fill: true,
            tension: 0.25,
            pointRadius: 0,
            pointHitRadius: 12,
            backgroundColor: (ctx) => {
              const { chartArea, ctx: c } = ctx.chart;
              if (!chartArea) return `${color}22`;
              const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
              if (bare) {
                g.addColorStop(0, dark ? "rgba(255,255,255,0.22)" : "rgba(15,20,25,0.16)");
                g.addColorStop(1, "rgba(0,0,0,0)");
              } else {
                g.addColorStop(0, `${color}66`);
                g.addColorStop(1, `${color}05`);
              }
              return g;
            },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: bare ? 0 : 2 },
        ...(onSelect
          ? {
              onClick: (_e: ChartEvent, elements: ActiveElement[]) => {
                const el = elements.find((x) => x.datasetIndex === (compare && compare.length ? 1 : 0)) ?? elements[0];
                if (el) onSelect(el.index);
              },
              onHover: (e: ChartEvent, elements: ActiveElement[]) => {
                (e.native?.target as HTMLElement | null)?.style.setProperty("cursor", elements.length ? "pointer" : "default");
              },
            }
          : {}),
        plugins: {
          tooltip: {
            intersect: false,
            mode: "index",
            displayColors: false,
            callbacks: {
              title: (items) => {
                const p = points[items[0]?.dataIndex ?? 0];
                return p ? (xTitle ? `${p.label} ${xTitle}` : pointTitle(p)) : "";
              },
              label: (item) => {
                const main = !(compare && compare.length) || item.datasetIndex === 1;
                const prev = compare?.slice(-points.length)[item.dataIndex];
                return main ? fmt(item.parsed.y ?? 0) : `previous period: ${fmt(prev?.value ?? 0)}`;
              },
              afterBody: (items) => {
                const p = points[items[0]?.dataIndex ?? 0];
                if (!p || p.count === undefined) return [];
                const lines = [`${p.count} post${p.count === 1 ? "" : "s"} published`];
                if (onSelect && p.count > 0) lines.push("click to see them");
                return lines;
              },
            },
          },
        },
        scales: bare
          ? { x: { display: false }, y: { display: false, beginAtZero: true } }
          : {
              x: { ticks: { color: tick, maxTicksLimit: 6, maxRotation: 0, font: { size: 10 } }, grid: { display: false }, border: { display: false } },
              y: { ticks: { color: tick, maxTicksLimit: 4, font: { size: 10 } }, grid: { color: grid }, border: { display: false }, beginAtZero: true },
            },
      },
    });
    return () => {
      chart.current?.destroy();
      chart.current = null;
    };
  }, [points, compare, color, bare, theme.value, onSelect, xTitle]);
  return (
    <div style={{ height: `${height}px` }} class="w-full">
      <canvas ref={ref} role="img" aria-label="Chart" />
    </div>
  );
}
