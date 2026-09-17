import type { QueryIdRow, XlyticsDb } from "./db";
import { FEATURES_A, FEATURES_A2, FEATURES_LIST_TL, FEATURES_MIN, FEATURES_USER } from "@/x-api/features";

export interface QuerySpec {
  queryId: string;
  method: "GET" | "POST";
  features?: Record<string, boolean>;
  fieldToggles?: Record<string, boolean>;
}

/** Known-good query ids at the time of writing. Observed ids always take precedence. */
export const SEED: Record<string, QuerySpec> = {
  UserTweets: { queryId: "p9sOCF1tLh4KfPWtt4TNGQ", method: "GET", features: FEATURES_A2, fieldToggles: { withArticlePlainText: false } },
  UserByScreenName: { queryId: "xWw45l6nX7DP2FKRyePXSw", method: "GET", features: FEATURES_USER, fieldToggles: { withAuxiliaryUserLabels: true } },
  UsersByRestIds: { queryId: "hiTzPd4vKNScu8qzxdjM4g", method: "GET", features: FEATURES_MIN },
  TweetDetail: {
    queryId: "ghg6dnwG8DCin2Fr4ik6QQ",
    method: "GET",
    features: FEATURES_A,
    fieldToggles: { withArticleRichContentState: true, withArticlePlainText: false, withGrokAnalyze: false, withDisallowedReplyControls: false },
  },
  SearchTimeline: { queryId: "fDwnkykAJtODs46h_XZfVg", method: "GET", features: FEATURES_A },
  ExplorePage: { queryId: "9yX4NI33DnsXBZ-UJ7ZwtA", method: "GET", features: FEATURES_LIST_TL },
  CreateList: { queryId: "P51ZB9632Fy0Cv3LdqMNwg", method: "POST", features: FEATURES_MIN },
  ListAddMember: { queryId: "FpvDMFk4k8HXtkYjQGg_bw", method: "POST", features: FEATURES_MIN },
  ListByRestId: { queryId: "ZMQOSpxDo0cP5Cdt8MgEVA", method: "GET", features: FEATURES_MIN },
  UpdateList: { queryId: "bYkQRsxcmEm_YSpiMusY2g", method: "POST", features: FEATURES_MIN },
  ListsManagementPageTimeline: { queryId: "zA6TKM6kv5YKudrFKyMalQ", method: "GET", features: FEATURES_LIST_TL },
  ListMembers: { queryId: "-5OaAZ4pICdvoQhPJXsCvg", method: "GET", features: FEATURES_LIST_TL },
  ListRemoveMember: { queryId: "q1fNhjkWDJWoHTtsToP0CQ", method: "POST", features: FEATURES_MIN },
  ListLatestTweetsTimeline: { queryId: "5ge3ZlLe_8IDfG1Bx-S9lA", method: "GET", features: FEATURES_LIST_TL },
  DeleteList: { queryId: "UnN9Th1BDbeLjpgjGSpL3Q", method: "POST" },
  ListEditRecommendedUsers: { queryId: "cFO-S3tSC54Nm3DJDSoSMA", method: "GET", features: FEATURES_LIST_TL },
  FavoriteTweet: { queryId: "lI07N6Otwv1PhnEgXILM7A", method: "POST" },
  UnfavoriteTweet: { queryId: "ZYKSe-w7KEslx3JhSIk5LA", method: "POST" },
  CreateRetweet: { queryId: "ojPdsZsimiJrUGLR1sjUtA", method: "POST" },
  DeleteRetweet: { queryId: "iQtK4dl5hBmXewYZuEOKVw", method: "POST" },
  CreateBookmark: { queryId: "aoDbu3RHznuiSkQ9aNM67Q", method: "POST" },
  DeleteBookmark: { queryId: "Wlmlj2-xzyS1GN3a6cj-mQ", method: "POST" },
};

/** Operations the sidebar needs but SuperX never exposed. They become usable once observed. */
export const OBSERVED_ONLY_OPS = ["UserTweetsAndReplies", "UserByRestId", "HomeTimeline", "Likes", "Bookmarks"] as const;

/** Operations whose observed features are useful to any other operation in the same family. */
const FAMILY: Record<string, string[]> = {
  UserTweets: ["UserTweetsAndReplies", "UserMedia", "Likes"],
  UserTweetsAndReplies: ["UserTweets", "UserMedia", "Likes"],
};

export class QueryIdRegistry {
  constructor(private readonly db: XlyticsDb) {}

  /** Records what X was seen using. Called by ingestion for every intercepted response. */
  async observe(op: string, queryId: string, features?: Record<string, boolean>, fieldToggles?: Record<string, boolean>, now: number = Date.now()): Promise<void> {
    const row: QueryIdRow = { op, queryId, seen_at: now, source: "observed" };
    if (features) row.features = features;
    if (fieldToggles) row.fieldToggles = fieldToggles;
    await this.db.queryIds.put(row);
  }

  /**
   * Resolves the spec to use for an operation: observed row first, then the seed.
   * Observed features from a sibling operation fill in when the seed has none.
   */
  async resolve(op: string): Promise<QuerySpec | undefined> {
    const observed = await this.db.queryIds.get(op);
    const seed = SEED[op];
    if (observed && !observed.stale) {
      const spec: QuerySpec = { queryId: observed.queryId, method: seed?.method ?? guessMethod(op) };
      const features = observed.features ?? seed?.features ?? (await this.siblingFeatures(op));
      const fieldToggles = observed.fieldToggles ?? seed?.fieldToggles;
      if (features) spec.features = features;
      if (fieldToggles) spec.fieldToggles = fieldToggles;
      return spec;
    }
    if (seed) return { ...seed };
    return undefined;
  }

  async markStale(op: string): Promise<void> {
    const row = await this.db.queryIds.get(op);
    if (row) await this.db.queryIds.put({ ...row, stale: true });
  }

  private async siblingFeatures(op: string): Promise<Record<string, boolean> | undefined> {
    for (const sibling of FAMILY[op] ?? []) {
      const row = await this.db.queryIds.get(sibling);
      if (row?.features) return row.features;
      const seed = SEED[sibling];
      if (seed?.features) return seed.features;
    }
    return undefined;
  }
}

function guessMethod(op: string): "GET" | "POST" {
  return /^(Create|Delete|Update|Favorite|Unfavorite|Add|Remove|Mute|Unmute|Block|Unblock)/.test(op) || /Member$/.test(op) ? "POST" : "GET";
}
