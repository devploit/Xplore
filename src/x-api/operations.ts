import type { XClient, XResponse } from "./client";

const TIMELINE_DEFAULTS = { count: 20, includePromotedContent: true, withQuickPromoteEligibilityTweetFields: true, withVoice: true, withV2Timeline: true };

export interface Page {
  body: unknown;
  status: number;
}

const page = (r: XResponse): Page => ({ body: { data: r.data }, status: r.status });

export const ops = {
  userTweets: (c: XClient, userId: string, cursor?: string) => c.graphql("UserTweets", { userId, ...TIMELINE_DEFAULTS, ...(cursor ? { cursor } : {}) }).then(page),
  userTweetsAndReplies: (c: XClient, userId: string, cursor?: string) =>
    c.graphql("UserTweetsAndReplies", { userId, ...TIMELINE_DEFAULTS, withCommunity: true, ...(cursor ? { cursor } : {}) }).then(page),
  userByScreenName: (c: XClient, screen_name: string) => c.graphql("UserByScreenName", { screen_name, withSafetyModeUserFields: true }).then(page),
  userByRestId: (c: XClient, userId: string) => c.graphql("UserByRestId", { userId, withSafetyModeUserFields: true }).then(page),
  tweetDetail: (c: XClient, focalTweetId: string) =>
    c.graphql("TweetDetail", { focalTweetId, referrer: "me", with_rux_injections: false, rankingMode: "Relevance", includePromotedContent: true, withCommunity: true, withQuickPromoteEligibilityTweetFields: true, withBirdwatchNotes: true, withVoice: true }).then(page),
  searchTimeline: (c: XClient, rawQuery: string, product: "Top" | "Latest" | "People" = "Latest", cursor?: string) =>
    c.graphql("SearchTimeline", { rawQuery, count: 20, querySource: "typed_query", product, ...(cursor ? { cursor } : {}) }).then(page),
  listLatestTweets: (c: XClient, listId: string, cursor?: string) => c.graphql("ListLatestTweetsTimeline", { listId, count: 20, ...(cursor ? { cursor } : {}) }).then(page),
  listByRestId: (c: XClient, listId: string) => c.graphql("ListByRestId", { listId }).then(page),
  listsManagement: (c: XClient) => c.graphql("ListsManagementPageTimeline", { count: 100 }).then(page),
  listMembers: (c: XClient, listId: string, cursor?: string) => c.graphql("ListMembers", { listId, count: 20, ...(cursor ? { cursor } : {}) }).then(page),
  createList: (c: XClient, name: string, description = "", isPrivate = false) => c.graphql("CreateList", { name, description, isPrivate }).then(page),
  updateList: (c: XClient, listId: string, patch: { name?: string; description?: string; isPrivate?: boolean }) => c.graphql("UpdateList", { listId, ...patch }).then(page),
  deleteList: (c: XClient, listId: string) => c.graphql("DeleteList", { listId }).then(page),
  listAddMember: (c: XClient, listId: string, userId: string) => c.graphql("ListAddMember", { listId, userId }).then(page),
  listRemoveMember: (c: XClient, listId: string, userId: string) => c.graphql("ListRemoveMember", { listId, userId }).then(page),
  favorite: (c: XClient, tweet_id: string) => c.graphql("FavoriteTweet", { tweet_id }).then(page),
  unfavorite: (c: XClient, tweet_id: string) => c.graphql("UnfavoriteTweet", { tweet_id }).then(page),
  retweet: (c: XClient, tweet_id: string) => c.graphql("CreateRetweet", { tweet_id, dark_request: false }).then(page),
  unretweet: (c: XClient, source_tweet_id: string) => c.graphql("DeleteRetweet", { source_tweet_id, dark_request: false }).then(page),
  bookmark: (c: XClient, tweet_id: string) => c.graphql("CreateBookmark", { tweet_id }).then(page),
  unbookmark: (c: XClient, tweet_id: string) => c.graphql("DeleteBookmark", { tweet_id }).then(page),
};
