import { isXlMessage, MESSAGE_SOURCE } from "@/shared/messages";

interface CapturedRouter {
  navigate: (path: string) => void;
}

declare global {
  interface Window {
    __xlRouter?: CapturedRouter;
  }
}

/**
 * X's client stores its react-router instance on an object that gets a `history` property
 * assigned during boot. Trapping that assignment on Object.prototype (same trick SuperX uses)
 * lets the sidebar navigate the SPA without a full reload. Best effort: if the trap never fires,
 * `navigate` falls back to pushState.
 */
export function installRouterCapture(win: Window & typeof globalThis): void {
  try {
    Object.defineProperty(Object.prototype, "history", {
      configurable: true,
      set(this: Record<string, unknown>, value: unknown) {
        Object.defineProperty(this, "history", { value, writable: true, configurable: true, enumerable: true });
        const candidate = this as { navigate?: unknown };
        if (typeof candidate.navigate === "function" && !win.__xlRouter) {
          win.__xlRouter = { navigate: (path) => (candidate.navigate as (p: string) => void)(path) };
        }
      },
      get() {
        return undefined;
      },
    });
  } catch {
    // Some page may have frozen Object.prototype; fall back silently.
  }
}

export function navigate(win: Window & typeof globalThis, path: string): void {
  if (win.__xlRouter) {
    win.__xlRouter.navigate(path);
    return;
  }
  win.history.pushState({}, "", path);
  win.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
}

export function listenForNavigate(win: Window & typeof globalThis): void {
  win.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== win || event.origin !== win.location.origin) return;
    const data: unknown = event.data;
    if (!isXlMessage(data) || data.kind !== "navigate") return;
    if (data.source !== MESSAGE_SOURCE) return;
    navigate(win, data.path);
  });
}
