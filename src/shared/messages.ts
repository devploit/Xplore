/**
 * Messages exchanged between the MAIN-world interceptor and the isolated-world sidebar
 * through window.postMessage. Every message carries `source` and `v` so the sidebar can
 * reject anything X itself (or another extension) might post.
 */
export const MESSAGE_SOURCE = "xplore" as const;
export const MESSAGE_VERSION = 1 as const;

interface Base {
  source: typeof MESSAGE_SOURCE;
  v: typeof MESSAGE_VERSION;
}

/** A GraphQL response X received, forwarded verbatim. Interceptor to sidebar. */
export interface GraphqlMessage extends Base {
  kind: "graphql";
  op: string;
  queryId: string;
  features?: Record<string, boolean>;
  fieldToggles?: Record<string, boolean>;
  status: number;
  body: unknown;
}

/** A REST (non GraphQL) response X received that the sidebar knows how to parse. Interceptor to sidebar. */
export interface RestMessage extends Base {
  kind: "rest";
  path: string;
  status: number;
  body: unknown;
}

/** A response that could not be forwarded (too large or unparsable). Interceptor to sidebar. */
export interface DroppedMessage extends Base {
  kind: "dropped";
  op: string;
  reason: "too-large" | "invalid-json";
}

/** Ask X's own router to navigate without a reload. Sidebar to interceptor. */
export interface NavigateMessage extends Base {
  kind: "navigate";
  path: string;
}

export type XlMessage = GraphqlMessage | RestMessage | DroppedMessage | NavigateMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoolRecord(value: unknown): value is Record<string, boolean> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === "boolean");
}

/** Structural guard for anything received over postMessage. */
export function isXlMessage(data: unknown): data is XlMessage {
  if (!isRecord(data)) return false;
  if (data.source !== MESSAGE_SOURCE || data.v !== MESSAGE_VERSION) return false;
  switch (data.kind) {
    case "graphql":
      return (
        typeof data.op === "string" &&
        typeof data.queryId === "string" &&
        typeof data.status === "number" &&
        (data.features === undefined || isBoolRecord(data.features)) &&
        (data.fieldToggles === undefined || isBoolRecord(data.fieldToggles)) &&
        "body" in data
      );
    case "rest":
      return typeof data.path === "string" && typeof data.status === "number" && "body" in data;
    case "dropped":
      return typeof data.op === "string" && (data.reason === "too-large" || data.reason === "invalid-json");
    case "navigate":
      return typeof data.path === "string" && data.path.startsWith("/");
    default:
      return false;
  }
}

export function makeMessage<T extends XlMessage>(msg: Omit<T, "source" | "v">): T {
  return { source: MESSAGE_SOURCE, v: MESSAGE_VERSION, ...msg } as T;
}
