import { makeMessage, type DroppedMessage, type GraphqlMessage, type RestMessage } from "@/shared/messages";
import { parseGraphqlUrl, parseRestUrl } from "@/shared/x-urls";

export const MAX_BODY_BYTES = 8 * 1024 * 1024;

export type Post = (msg: GraphqlMessage | RestMessage | DroppedMessage) => void;

/** True for any X API response the sidebar wants to see. */
export function isObserved(url: string): boolean {
  return parseGraphqlUrl(url) !== null || parseRestUrl(url) !== null;
}

/**
 * Turns one observed X response into a message for the sidebar.
 * Pure apart from the `post` callback, so it is unit-testable without a browser.
 */
export function handleResponse(url: string, status: number, text: string, post: Post, requestBody?: string | null): void {
  const parts = parseGraphqlUrl(url);
  if (!parts) {
    const rest = parseRestUrl(url);
    if (!rest) return;
    if (text.length > MAX_BODY_BYTES) return post(makeMessage<DroppedMessage>({ kind: "dropped", op: rest.path, reason: "too-large" }));
    try {
      post(makeMessage<RestMessage>({ kind: "rest", path: rest.path, status, body: JSON.parse(text) }));
    } catch {
      post(makeMessage<DroppedMessage>({ kind: "dropped", op: rest.path, reason: "invalid-json" }));
    }
    return;
  }
  if (text.length > MAX_BODY_BYTES) {
    post(makeMessage<DroppedMessage>({ kind: "dropped", op: parts.op, reason: "too-large" }));
    return;
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    post(makeMessage<DroppedMessage>({ kind: "dropped", op: parts.op, reason: "invalid-json" }));
    return;
  }
  let features = parts.features;
  let fieldToggles = parts.fieldToggles;
  if (requestBody && (!features || !fieldToggles)) {
    const fromBody = parseRequestBody(requestBody);
    features ??= fromBody.features;
    fieldToggles ??= fromBody.fieldToggles;
  }
  const msg: GraphqlMessage = makeMessage<GraphqlMessage>({ kind: "graphql", op: parts.op, queryId: parts.queryId, status, body });
  if (features) msg.features = features;
  if (fieldToggles) msg.fieldToggles = fieldToggles;
  post(msg);
}

function parseRequestBody(raw: string): { features?: Record<string, boolean>; fieldToggles?: Record<string, boolean> } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const out: { features?: Record<string, boolean>; fieldToggles?: Record<string, boolean> } = {};
      if (obj.features && typeof obj.features === "object") out.features = obj.features as Record<string, boolean>;
      if (obj.fieldToggles && typeof obj.fieldToggles === "object") out.fieldToggles = obj.fieldToggles as Record<string, boolean>;
      return out;
    }
  } catch {
    // Not JSON.
  }
  return {};
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Wraps window.fetch so every GraphQL response is forwarded. Never alters what X receives. */
export function patchFetch(win: Window & typeof globalThis, post: Post): void {
  const original = win.fetch.bind(win);
  win.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const promise = original(input, init);
    try {
      const url = requestUrl(input);
      if (isObserved(url)) {
        const requestBody = typeof init?.body === "string" ? init.body : null;
        promise
          .then((res) => res.clone().text().then((text) => handleResponse(url, res.status, text, post, requestBody)))
          .catch(() => undefined);
      }
    } catch {
      // Never let observation break X.
    }
    return promise;
  };
}

/** Wraps XMLHttpRequest so GraphQL responses sent through XHR are forwarded too. */
export function patchXhr(win: Window & typeof globalThis, post: Post): void {
  const proto = win.XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const urls = new WeakMap<XMLHttpRequest, string>();
  proto.open = function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]): void {
    try {
      urls.set(this, typeof url === "string" ? url : url.href);
    } catch {
      // ignore
    }
    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof proto.open;
  proto.send = function patchedSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
    try {
      const url = urls.get(this);
      if (url && isObserved(url)) {
        const requestBody = typeof body === "string" ? body : null;
        this.addEventListener("load", () => {
          try {
            if (this.responseType === "" || this.responseType === "text") {
              handleResponse(url, this.status, this.responseText, post, requestBody);
            } else if (this.responseType === "json" && this.response !== null) {
              handleResponse(url, this.status, JSON.stringify(this.response), post, requestBody);
            }
          } catch {
            // ignore
          }
        });
      }
    } catch {
      // ignore
    }
    return originalSend.call(this, body);
  };
}
