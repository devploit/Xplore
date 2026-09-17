import { signal } from "@preact/signals";

/** Current X path, kept in sync with X's SPA navigation. */
export const xPath = signal<string>(typeof location !== "undefined" ? location.pathname : "/");

const RESERVED = new Set(["home", "explore", "notifications", "messages", "i", "settings", "search", "compose", "login", "signup", "tos", "privacy", "about", "jobs", "hashtag", "lists", "bookmarks", "communities", "premium", "verified-choose", "account", "logout", "download", "intent", "share", "who_to_follow", "connect_people", "topics", "help", "en", "es"]);

/** Screen name when the path is a profile page (/name, /name/with_replies, /name/media, /name/likes ...). */
export function profileFromPath(path: string): string | undefined {
  const m = /^\/([A-Za-z0-9_]{1,15})(?:\/(with_replies|media|likes|highlights|articles|superfollows|affiliates))?\/?$/.exec(path);
  if (!m?.[1]) return undefined;
  const name = m[1];
  return RESERVED.has(name.toLowerCase()) ? undefined : name;
}

export function watchXRoute(): () => void {
  const update = () => {
    if (xPath.value !== location.pathname) xPath.value = location.pathname;
  };
  const nav = (window as unknown as { navigation?: { addEventListener(type: string, cb: () => void): void; removeEventListener(type: string, cb: () => void): void } }).navigation;
  if (nav) {
    nav.addEventListener("currententrychange", update);
    return () => nav.removeEventListener("currententrychange", update);
  }
  const id = setInterval(update, 500);
  window.addEventListener("popstate", update);
  return () => {
    clearInterval(id);
    window.removeEventListener("popstate", update);
  };
}
