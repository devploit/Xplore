import { signal } from "@preact/signals";
import type { IconName } from "./components/icons";

export type Route = "home" | "activities" | "tweets" | "mentions" | "timelines" | "profile" | "settings";

export const ROUTES: { id: Route; label: string; icon: IconName }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "activities", label: "Activity", icon: "chart" },
  { id: "tweets", label: "Posts", icon: "list" },
  { id: "mentions", label: "Mentions", icon: "bell" },
  { id: "timelines", label: "Feeds", icon: "layers" },
  { id: "profile", label: "Profile", icon: "user" },
  { id: "settings", label: "Settings", icon: "gear" },
];

export const route = signal<Route>("home");

export function go(r: Route): void {
  route.value = r;
}
