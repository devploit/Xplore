import { makeMessage, type NavigateMessage } from "@/shared/messages";

/** Asks the interceptor to move X's SPA to `path` (for example /user/status/123). */
export function navigateX(path: string): void {
  window.postMessage(makeMessage<NavigateMessage>({ kind: "navigate", path }), window.location.origin);
}

export function tweetUrl(screenName: string, id: string): string {
  return `/${screenName}/status/${id}`;
}
