/** Hosts the extension is allowed to talk to. Anything else is a bug and fails the build guard. */
export const ALLOWED_HOSTS = ["x.com", "twitter.com", "twimg.com"] as const;

/** Matches X's internal GraphQL path and captures queryId and operation name. */
export const GRAPHQL_RE = /\/i\/api\/graphql\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_]+)(?:[/?#]|$)/;

export interface GraphqlUrlParts {
  queryId: string;
  op: string;
  /** Parsed `features` query parameter, when present and valid JSON. */
  features?: Record<string, boolean>;
  /** Parsed `fieldToggles` query parameter, when present and valid JSON. */
  fieldToggles?: Record<string, boolean>;
}

function parseJsonParam(params: URLSearchParams, key: string): Record<string, boolean> | undefined {
  const raw = params.get(key);
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, boolean>;
  } catch {
    // Not JSON, ignore.
  }
  return undefined;
}

/** Returns the GraphQL parts of a URL (absolute or relative to x.com) or null when it is not a GraphQL call. */
export function parseGraphqlUrl(url: string): GraphqlUrlParts | null {
  const match = GRAPHQL_RE.exec(url);
  if (!match) return null;
  const queryId = match[1];
  const op = match[2];
  if (!queryId || !op) return null;
  const parts: GraphqlUrlParts = { queryId, op };
  const queryStart = url.indexOf("?");
  if (queryStart >= 0) {
    const params = new URLSearchParams(url.slice(queryStart + 1).split("#")[0]);
    const features = parseJsonParam(params, "features");
    const fieldToggles = parseJsonParam(params, "fieldToggles");
    if (features) parts.features = features;
    if (fieldToggles) parts.fieldToggles = fieldToggles;
  }
  return parts;
}

/** REST endpoints the sidebar parses: the notifications timelines (mentions arrive here when X does not use GraphQL for them). */
export const REST_RE = /\/i\/api\/2\/notifications\/(all|mentions|verified)\.json(?:[?#]|$)/;

export function parseRestUrl(url: string): { path: string } | null {
  const m = REST_RE.exec(url);
  if (!m) return null;
  const idx = url.indexOf("/i/api/");
  return { path: url.slice(idx).split("?")[0] ?? "" };
}
