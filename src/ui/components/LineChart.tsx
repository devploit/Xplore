import { useEffect, useRef } from "preact/hooks";
import { CategoryScale, Chart, Filler, LineController, LineElement, LinearScale, PointElement, Tooltip } from "chart.js";
import type { Point } from "@/analytics";
import { theme } from "../store";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);

/**
 * Area chart. `bare` hides axes and draws a soft gradient so it can sit behind a big number,
 * the way SuperX renders its engagement cards. Tooltips stay available in both modes.
 */
export function LineChart({ points, color, height = 120, bare = false, format }: { points: Point[]; color: string; height?: number; bare?: boolean; format?: (n: number) => string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dark = theme.value !== "light";
    const grid = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
    const tick = dark ? "#8b98a5" : "#536471";
    chart.current?.destroy();
    chart.current = new Chart(canvas, {
      type: "line",
      data: {
        labels: points.map((p) => p.label),
        datasets: [
          {
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
        plugins: {
          tooltip: {
            intersect: false,
            mode: "index",
            displayColors: false,
            callbacks: { label: (item) => (format ? format(item.parsed.y ?? 0) : String(item.parsed.y)) },
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
  }, [points, color, bare, theme.value]);
  return (
    <div style={{ height: `${height}px` }} class="w-full">
      <canvas ref={ref} role="img" aria-label="Chart" />
    </div>
  );
}
