import type { ThemeSetting } from "@/data/settings";

export type Theme = "dark" | "dim" | "light";

/** X paints its theme on body.style.backgroundColor; SuperX reads the same signal. */
export function detectTheme(doc: Document = document): Theme {
  const bg = doc.body?.style.backgroundColor ?? "";
  if (bg === "rgb(0, 0, 0)") return "dark";
  if (bg === "rgb(21, 32, 43)") return "dim";
  return "light";
}

export function resolveTheme(setting: ThemeSetting, doc: Document = document): Theme {
  return setting === "system" ? detectTheme(doc) : setting;
}

/** Calls `cb` whenever X changes the body background (theme switch without reload). */
export function observeTheme(cb: (t: Theme) => void, doc: Document = document): () => void {
  if (!doc.body) return () => undefined;
  const obs = new MutationObserver(() => cb(detectTheme(doc)));
  obs.observe(doc.body, { attributes: true, attributeFilter: ["style"] });
  return () => obs.disconnect();
}

export const THEME_BG: Record<Theme, string> = { dark: "#000000", dim: "#15202b", light: "#ffffff" };
