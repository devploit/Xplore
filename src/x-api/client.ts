import { csrfToken } from "@/data/identity";
import type { XlyticsDb } from "@/data/db";
import { QueryIdRegistry } from "@/data/queryIds";
import { parseLimitHeaders, type Limit } from "@/data/rateLimit";

/** X's public web-client bearer, identical for every browser session. */
export const WEB_BEARER = "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

export type XErrorKind = "RateLimited" | "Unauthorized" | "StaleQueryId" | "Network" | "GraphQL" | "Unavailable" | "Http";

export class XApiError extends Error {
  constructor(public readonly kind: XErrorKind, message: string, public readonly status?: number, public readonly retryAfterMs?: number) {
    super(message);
    this.name = "XApiError";
  }
}

export interface XResponse<T = unknown> {
  data: T;
  limit?: Limit;
  status: number;
}

export interface ClientDeps {
  db: XlyticsDb;
  fetch?: typeof fetch;
  cookie?: () => string;
  origin?: string;
  now?: () => number;
}

interface GraphqlEnvelope {
  data?: unknown;
  errors?: { message?: string; code?: number }[];
}

function encode(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(JSON.stringify(v))}`)
    .join("&");
}

/**
 * Same-origin client for X's internal GraphQL API using the logged-in session.
 * Query ids and feature flags come from the registry; rate limits are recorded per operation.
 */
export class XClient {
  private readonly registry: QueryIdRegistry;
  private readonly fetchImpl: typeof fetch;
  private readonly cookie: () => string;
  private readonly origin: string;
  private readonly now: () => number;

  constructor(private readonly deps: ClientDeps) {
    this.registry = new QueryIdRegistry(deps.db);
    this.fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
    this.cookie = deps.cookie ?? (() => document.cookie);
    this.origin = deps.origin ?? location.origin;
    this.now = deps.now ?? (() => Date.now());
  }

  async limitFor(op: string): Promise<Limit | undefined> {
    const row = await this.deps.db.rateLimits.get(op);
    return row ? { limit: row.limit, remaining: row.remaining, reset: row.reset } : undefined;
  }

  async graphql<T = unknown>(op: string, variables: Record<string, unknown>): Promise<XResponse<T>> {
    const spec = await this.registry.resolve(op);
    if (!spec) throw new XApiError("StaleQueryId", `No query id known for ${op}; it becomes available once X performs it.`);
    const ct0 = csrfToken(this.cookie());
    if (!ct0) throw new XApiError("Unauthorized", "No X session cookie found.");
    const headers: Record<string, string> = {
      authorization: WEB_BEARER,
      "x-csrf-token": ct0,
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "en",
    };
    const base = `${this.origin}/i/api/graphql/${spec.queryId}/${op}`;
    let response: Response;
    try {
      if (spec.method === "GET") {
        const query = encode({ variables, features: spec.features, fieldToggles: spec.fieldToggles });
        response = await this.fetchImpl(`${base}?${query}`, { method: "GET", headers, credentials: "include" });
      } else {
        headers["content-type"] = "application/json";
        const body: Record<string, unknown> = { queryId: spec.queryId, variables };
        if (spec.features) body.features = spec.features;
        response = await this.fetchImpl(base, { method: "POST", headers, credentials: "include", body: JSON.stringify(body) });
      }
    } catch (err) {
      throw new XApiError("Network", err instanceof Error ? err.message : String(err));
    }
    const limit = parseLimitHeaders(response.headers);
    if (limit) await this.deps.db.rateLimits.put({ endpoint: op, ...limit, updated_at: this.now() });
    const status = response.status;
    if (status === 429) throw new XApiError("RateLimited", `Rate limited on ${op}`, status, limit ? Math.max(0, limit.reset * 1000 - this.now()) : undefined);
    if (status === 401 || status === 403) throw new XApiError("Unauthorized", `X rejected the session on ${op} (${status})`, status);
    if (status === 404) {
      await this.registry.markStale(op);
      throw new XApiError("StaleQueryId", `Query id for ${op} is no longer valid`, status);
    }
    if (status === 503 || status === 502 || status === 504) throw new XApiError("Unavailable", `X unavailable on ${op} (${status})`, status);
    let json: GraphqlEnvelope;
    try {
      json = (await response.json()) as GraphqlEnvelope;
    } catch {
      throw new XApiError("Http", `Non-JSON response on ${op} (${status})`, status);
    }
    if (status >= 400) throw new XApiError("Http", `HTTP ${status} on ${op}`, status);
    if (json.errors?.length && json.data === undefined) {
      const message = json.errors.map((e) => e.message ?? "unknown").join("; ");
      if (json.errors.some((e) => e.code === 88)) throw new XApiError("RateLimited", message, status);
      throw new XApiError("GraphQL", message, status);
    }
    const out: XResponse<T> = { data: json.data as T, status };
    if (limit) out.limit = limit;
    return out;
  }
}
