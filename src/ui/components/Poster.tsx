import { useEffect, useRef, useState } from "preact/hooks";
import { toBlob } from "html-to-image";
import type { ComponentChildren } from "preact";
import { me, settings, toast, updateSettings } from "../store";

export interface PosterStyle {
  bg: string;
  mode: "dark" | "light" | "theme";
  grain?: boolean;
}

/** The 16 SuperX poster backgrounds. */
export const POSTER_STYLES: PosterStyle[] = [
  { bg: "var(--xl-bg)", mode: "theme" },
  { bg: "#fe6920", mode: "dark" },
  { bg: "#fbb81e", mode: "light" },
  { bg: "#7edbb6", mode: "light" },
  { bg: "#1acf86", mode: "light" },
  { bg: "#91d2fa", mode: "light" },
  { bg: "#1c95e0", mode: "dark" },
  { bg: "#e9254e", mode: "dark" },
  { bg: "#9721FF", mode: "dark" },
  { bg: "linear-gradient(62deg, #FBAB7E 0%, #F7CE68 100%)", mode: "light" },
  { bg: "linear-gradient(0deg, #08AEEA 0%, #2AF598 100%)", mode: "light" },
  { bg: "linear-gradient(141deg, #21ffef 0%, #8f1ef3 100%)", mode: "dark" },
  { bg: "linear-gradient(141deg, #ff6a21 0%, #8f1ef3 100%)", mode: "dark" },
  { bg: "radial-gradient(at 40% 20%, #ff9a9e 0px, transparent 50%), radial-gradient(at 80% 0%, #fad0c4 0px, transparent 50%), radial-gradient(at 0% 50%, #a18cd1 0px, transparent 50%), radial-gradient(at 80% 50%, #fbc2eb 0px, transparent 50%), radial-gradient(at 0% 100%, #a6c1ee 0px, transparent 50%), #f5f7fa", mode: "light" },
  { bg: "radial-gradient(at 0% 0%, #0f2027 0px, transparent 50%), radial-gradient(at 100% 0%, #203a43 0px, transparent 50%), radial-gradient(at 100% 100%, #2c5364 0px, transparent 50%), radial-gradient(at 0% 100%, #1a2980 0px, transparent 50%), #0b1a24", mode: "dark", grain: true },
  { bg: "radial-gradient(at 20% 30%, #f97316 0px, transparent 50%), radial-gradient(at 80% 20%, #db2777 0px, transparent 50%), radial-gradient(at 50% 90%, #7c3aed 0px, transparent 55%), #1c0a2e", mode: "dark", grain: true },
];

const GRAIN = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.18'/></svg>\")";

export function PosterModal({ title, children, onClose }: { title: string; children: ComponentChildren; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const idx = Math.min(settings.value.posterStyle, POSTER_STYLES.length - 1);
  const style = POSTER_STYLES[idx]!;
  const color = style.mode === "dark" ? "#fff" : style.mode === "light" ? "#0f1419" : "inherit";

  const render = async (): Promise<Blob | null> => {
    if (!ref.current) return null;
    setBusy(true);
    try {
      return await toBlob(ref.current, { pixelRatio: 2, cacheBust: false, skipFonts: true });
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    const blob = await render();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `x-lytics-${me.value?.screen_name ?? "me"}-${title.toLowerCase().replace(/\W+/g, "-")}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    const blob = await render();
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("Poster copied");
    } catch {
      toast("Clipboard unavailable", "error");
    }
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-label={`Share ${title}`} onClick={onClose}>
      <div class="xl-card w-[420px] max-w-[95vw] flex flex-col gap-3 xl-fade" style={{ background: "var(--xl-bg)" }} onClick={(e) => e.stopPropagation()}>
        <div class="flex items-center justify-between">
          <strong>Share {title}</strong>
          <button class="xl-btn icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div ref={ref} class="rounded-xl p-5 relative" style={{ background: style.bg, color }}>
          {style.grain && <div class="absolute inset-0 rounded-xl pointer-events-none" style={{ backgroundImage: GRAIN }} />}
          <div class="relative">{children}</div>
          <div class="relative flex items-center justify-between text-xs mt-3 opacity-80">
            <span>@{me.value?.screen_name ?? "me"}</span>
            <span>{new Date().toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" })}</span>
          </div>
        </div>
        <div class="flex flex-wrap gap-1" role="radiogroup" aria-label="Poster style">
          {POSTER_STYLES.map((s, i) => (
            <button key={i} role="radio" aria-checked={i === idx} class={`w-6 h-6 rounded-full border ${i === idx ? "ring-2 ring-orange-500" : ""}`} style={{ background: s.bg, borderColor: "var(--xl-border)" }} title={`Style ${i + 1}`} onClick={() => void updateSettings({ posterStyle: i })} />
          ))}
        </div>
        <div class="flex gap-2 justify-end">
          <button class="xl-btn" disabled={busy} onClick={() => void copy()}>Copy</button>
          <button class="xl-btn active" disabled={busy} onClick={() => void download()}>Download PNG</button>
        </div>
      </div>
    </div>
  );
}
