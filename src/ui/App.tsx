import { effect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { ROUTES, go, route } from "./router";
import { me, settings, theme, updateSettings } from "./store";
import { applyBodyClasses } from "./page-styles";
import { Toasts } from "./components/Toasts";
import { Home } from "./pages/Home";
import { Activities } from "./pages/Activities";
import { Tweets } from "./pages/Tweets";
import { Mentions } from "./pages/Mentions";
import { Timelines } from "./pages/Timelines";
import { SettingsPage } from "./pages/Settings";

const PAGES = { home: Home, activities: Activities, tweets: Tweets, mentions: Mentions, timelines: Timelines, settings: SettingsPage } as const;

export function App({ host }: { host: HTMLElement }) {
  useEffect(() => {
    return effect(() => {
      host.classList.remove("dark", "dim", "light");
      host.classList.add(theme.value);
      if (theme.value === "dim") host.classList.add("dark");
      applyBodyClasses(document, { open: settings.value.visible, hideSidebar: settings.value.hideXSidebar, hideDm: settings.value.hideDmDrawer });
    });
  }, [host]);

  const s = settings.value;
  if (!s.visible) {
    return (
      <button class="fixed top-3 right-3 z-50 w-10 h-10 rounded-full shadow-lg text-white text-lg" style={{ background: "var(--xl-accent)" }} title="Open x-lytics" aria-label="Open x-lytics" onClick={() => void updateSettings({ visible: true })}>
        x
      </button>
    );
  }
  const Page = PAGES[route.value];
  const tabs = ROUTES.filter((r) => r.id === "settings" || s.pages[r.id] !== false);
  return (
    <div class="xl-panel fixed top-0 right-0 h-screen w-[460px] max-w-[100vw] flex flex-col" style={{ background: "var(--xl-bg)" }}>
      <header class="flex items-center justify-between px-3 py-2 border-b xl-border">
        <div class="flex items-center gap-2 text-sm font-semibold">
          <span class="inline-block w-6 h-6 rounded-full text-white text-center leading-6" style={{ background: "var(--xl-accent)" }}>x</span>
          x-lytics
          {me.value && <span class="xl-muted font-normal">@{me.value.screen_name}</span>}
        </div>
        <button class="xl-btn" onClick={() => void updateSettings({ visible: false })} aria-label="Close sidebar">✕</button>
      </header>
      <nav class="flex gap-1 px-2 py-1 border-b xl-border overflow-x-auto" aria-label="Pages">
        {tabs.map((r) => (
          <button key={r.id} class={`xl-btn whitespace-nowrap ${route.value === r.id ? "active" : ""}`} aria-current={route.value === r.id ? "page" : undefined} onClick={() => go(r.id)} title={r.label}>
            <span aria-hidden="true">{r.icon}</span> {r.label}
          </button>
        ))}
      </nav>
      <main class="flex-1 overflow-y-auto xl-scroll p-3">
        <Page />
      </main>
      <Toasts />
    </div>
  );
}
