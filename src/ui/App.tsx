import { effect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { ROUTES, go, route, type Route } from "./router";
import { me, selectedBucket, selectedTweetId, settings, theme, unreadMentions, updateSettings } from "./store";
import { applyBodyClasses } from "./page-styles";
import { navigateX } from "./navigate";
import { Toasts } from "./components/Toasts";
import { Icon } from "./components/icons";
import { PeriodSelect } from "./components/PeriodSelect";
import { CustomRange } from "./components/CustomRange";
import { CUSTOM_PERIOD } from "@/analytics";
import { PostDetail } from "./components/PostDetail";
import { BucketPosts } from "./components/BucketPosts";
import logo from "./assets/logo.png?inline";
import { Home } from "./pages/Home";
import { Activities } from "./pages/Activities";
import { Tweets } from "./pages/Tweets";
import { Mentions } from "./pages/Mentions";
import { Timelines } from "./pages/Timelines";
import { SettingsPage } from "./pages/Settings";
import { Profile } from "./pages/Profile";

const PAGES = { home: Home, activities: Activities, tweets: Tweets, mentions: Mentions, timelines: Timelines, profile: Profile, settings: SettingsPage } as const;

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
  const unread = unreadMentions.value;
  const badge = unread > 0 ? <span class="xl-badge" aria-hidden="true">{unread > 99 ? "99+" : unread}</span> : null;
  if (!s.visible) {
    return (
      <button class="xl-fab" title="Open Xplore (Alt+X)" aria-label={`Open Xplore${unread ? `, ${unread} new mentions` : ""}`} onClick={() => void updateSettings({ visible: true })}>
        <img src={logo} alt="" width={22} height={22} />
        {badge}
      </button>
    );
  }
  const Page = PAGES[route.value];
  // The Sniper tab is always present so the nav never changes width; off a profile it offers a lookup.
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
  const showPeriod = route.value === "home" || route.value === "activities" || route.value === "tweets" || route.value === "profile";

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
              <button key={r.id} aria-current={route.value === r.id ? "page" : undefined} aria-label={r.id === "mentions" && unread ? `${r.label}, ${unread} new` : r.label} onClick={() => go(r.id)} onKeyDown={(e) => onNavKey(e, i)} title={r.label} class="relative">
                <I size={19} />
                {r.id === "mentions" && badge}
              </button>
            );
          })}
        </nav>
        {/* Fixed-width slot so the nav keeps its size and position on pages without a period selector. */}
        <div class="xl-period-slot">{showPeriod && <PeriodSelect />}</div>
        <button class="xl-btn icon" onClick={() => void updateSettings({ visible: false })} aria-label="Close (Alt+X)" title="Close (Alt+X)"><Icon.close size={15} /></button>
      </header>
      {showPeriod && s.period === CUSTOM_PERIOD && <CustomRange />}
      <main class="flex-1 overflow-y-auto xl-scroll p-3 xl-fade" key={route.value}>
        <Page />
      </main>
      {/* Opens X's own composer: Xplore never posts on the user's behalf. */}
      <button class="xl-compose" title="Write a post on X" aria-label="Write a post on X" onClick={() => navigateX("/compose/post")}><Icon.pencil size={18} /></button>
      {selectedTweetId.value && <PostDetail tweetId={selectedTweetId.value} />}
      {selectedBucket.value && !selectedTweetId.value && <BucketPosts {...selectedBucket.value} />}
      <Toasts />
    </div>
  );
}
