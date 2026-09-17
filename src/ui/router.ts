import { signal } from "@preact/signals";

export type Route = "home" | "activities" | "tweets" | "mentions" | "timelines" | "settings";

export const ROUTES: { id: Route; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "⌂" },
  { id: "activities", label: "Activities", icon: "📈" },
  { id: "tweets", label: "Tweets", icon: "☰" },
  { id: "mentions", label: "Mentions", icon: "🔔" },
  { id: "timelines", label: "Timelines", icon: "📋" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

export const route = signal<Route>("home");

export function go(r: Route): void {
  route.value = r;
}
