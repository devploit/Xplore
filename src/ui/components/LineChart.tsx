import { useEffect, useRef } from "preact/hooks";
import { CategoryScale, Chart, Filler, LineController, LineElement, LinearScale, PointElement, Tooltip } from "chart.js";
import type { Point } from "@/analytics";
import { theme } from "../store";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);

export function LineChart({ points, color, height = 120 }: { points: Point[]; color: string; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const grid = theme.value === "light" ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)";
    const tick = theme.value === "light" ? "#536471" : "#8b98a5";
    chart.current?.destroy();
    chart.current = new Chart(canvas, {
      type: "line",
      data: {
        labels: points.map((p) => p.label),
        datasets: [{ data: points.map((p) => p.value), borderColor: color, backgroundColor: `${color}33`, fill: true, tension: 0.1, pointRadius: points.length > 40 ? 0 : 2, borderWidth: 2 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { tooltip: { intersect: false, mode: "index" } },
        scales: {
          x: { ticks: { color: tick, maxTicksLimit: 6, maxRotation: 0 }, grid: { display: false } },
          y: { ticks: { color: tick, maxTicksLimit: 4 }, grid: { color: grid }, beginAtZero: true },
        },
      },
    });
    return () => {
      chart.current?.destroy();
      chart.current = null;
    };
  }, [points, color, theme.value]);
  return (
    <div style={{ height: `${height}px` }}>
      <canvas ref={ref} role="img" aria-label="Line chart" />
    </div>
  );
}
