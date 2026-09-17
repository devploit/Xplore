import { effect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { ROUTES, go, route, type Route } from "./router";
import { me, settings, theme, updateSettings } from "./store";
import { applyBodyClasses } from "./page-styles";
import { Toasts } from "./components/Toasts";
import { Icon } from "./components/icons";
import { PeriodSelect } from "./components/PeriodSelect";
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

  // Alt+X toggles the panel from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        void updateSettings({ visible: !settings.value.visible });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const s = settings.value;
  if (!s.visible) {
    return (
      <button class="xl-fab" title="Open x-lytics (Alt+X)" aria-label="Open x-lytics" onClick={() => void updateSettings({ visible: true })}>
        <Icon.logo size={14} />
      </button>
    );
  }
  const Page = PAGES[route.value];
  const tabs = ROUTES.filter((r) => r.id !== "settings" && s.pages[r.id] !== false);
  const onNavKey = (e: KeyboardEvent, idx: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = tabs[(idx + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    if (next) {
      go(next.id as Route);
      (e.currentTarget as HTMLElement).parentElement?.querySelectorAll("button")[tabs.indexOf(next)]?.focus();
    }
  };
  const showPeriod = route.value === "home" || route.value === "activities" || route.value === "tweets";

  return (
    <div class="xl-panel fixed top-0 right-0 h-screen max-w-[100vw] flex flex-col" style={{ width: `${s.width}px` }}>
      <header class="flex items-center gap-2 px-2 py-2 border-b xl-border">
        <button class={`xl-avatar ${route.value === "settings" ? "active" : ""}`} onClick={() => go("settings")} title={me.value ? `@${me.value.screen_name} · Settings` : "Settings"} aria-label="Settings" aria-current={route.value === "settings" ? "page" : undefined}>
          {me.value?.profile_image_url_https ? <img src={me.value.profile_image_url_https} alt="" width={30} height={30} referrerpolicy="no-referrer" /> : <Icon.gear size={16} />}
        </button>
        <nav class="xl-nav flex-1" aria-label="Pages">
          {tabs.map((r, i) => {
            const I = Icon[r.icon];
            return (
              <button key={r.id} aria-current={route.value === r.id ? "page" : undefined} aria-label={r.label} onClick={() => go(r.id)} onKeyDown={(e) => onNavKey(e, i)} title={r.label}>
                <I size={19} />
              </button>
            );
          })}
        </nav>
        {showPeriod && <PeriodSelect />}
        <button class="xl-btn icon" onClick={() => void updateSettings({ visible: false })} aria-label="Close (Alt+X)" title="Close (Alt+X)"><Icon.close size={15} /></button>
      </header>
      <main class="flex-1 overflow-y-auto xl-scroll p-3 xl-fade" key={route.value}>
        <Page />
      </main>
      <Toasts />
    </div>
  );
}
