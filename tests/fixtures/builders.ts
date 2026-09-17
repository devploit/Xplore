/** Builders for X GraphQL shapes, kept close to the real payloads so tests stay realistic. */

export function userResult(id: string, screenName: string, extra: Record<string, unknown> = {}) {
  return {
    __typename: "User",
    id: `VXNlcjo${id}`,
    rest_id: id,
    avatar: { image_url: `https://pbs.twimg.com/profile_images/${id}/x_normal.jpg` },
    core: { created_at: "Tue Mar 01 12:00:00 +0000 2016", name: `Name ${screenName}`, screen_name: screenName },
    is_blue_verified: false,
    legacy: {
      description: "bio",
      followers_count: 1200,
      friends_count: 300,
      statuses_count: 5400,
      favourites_count: 10,
      media_count: 20,
      listed_count: 3,
      profile_image_url_https: `https://pbs.twimg.com/profile_images/${id}/x_normal.jpg`,
    },
    verification: { verified: false },
    ...extra,
  };
}

export function tweetResult(id: string, userId: string, screenName: string, legacy: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    __typename: "Tweet",
    rest_id: id,
    core: { user_results: { result: userResult(userId, screenName) } },
    views: { count: "1500", state: "EnabledWithCount" },
    legacy: {
      bookmark_count: 2,
      created_at: "Wed Sep 10 10:00:00 +0000 2025",
      conversation_id_str: id,
      entities: { hashtags: [], symbols: [], urls: [], user_mentions: [] },
      favorite_count: 30,
      full_text: `tweet ${id}`,
      is_quote_status: false,
      lang: "en",
      quote_count: 1,
      reply_count: 4,
      retweet_count: 5,
      user_id_str: userId,
      id_str: id,
      ...legacy,
    },
    ...extra,
  };
}

export function itemEntry(entryId: string, result: unknown) {
  return { entryId, sortIndex: "1", content: { entryType: "TimelineTimelineItem", __typename: "TimelineTimelineItem", itemContent: { itemType: "TimelineTweet", __typename: "TimelineTweet", tweet_results: { result }, tweetDisplayType: "Tweet" } } };
}

export function moduleEntry(entryId: string, results: unknown[]) {
  return {
    entryId,
    sortIndex: "1",
    content: {
      entryType: "TimelineTimelineModule",
      __typename: "TimelineTimelineModule",
      items: results.map((result, i) => ({ entryId: `${entryId}-tweet-${i}`, item: { itemContent: { itemType: "TimelineTweet", __typename: "TimelineTweet", tweet_results: { result }, tweetDisplayType: "SelfThread" } } })),
    },
  };
}

export function cursorEntry(value: string, cursorType: "Top" | "Bottom") {
  return { entryId: `cursor-${cursorType.toLowerCase()}-1`, sortIndex: "0", content: { entryType: "TimelineTimelineCursor", __typename: "TimelineTimelineCursor", value, cursorType } };
}

export function userTweetsResponse(entries: unknown[], opts: { v2?: boolean } = {}) {
  const timeline = { timeline: { instructions: [{ type: "TimelineClearCache" }, { type: "TimelineAddEntries", entries }], metadata: { scribeConfig: { page: "profile" } } } };
  return { data: { user: { result: { __typename: "User", timeline_v2: opts.v2 === false ? undefined : timeline, timeline: opts.v2 === false ? timeline : undefined } } } };
}

export function searchResponse(entries: unknown[]) {
  return { data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [{ type: "TimelineAddEntries", entries }] } } } } };
}

export function tweetDetailResponse(entries: unknown[]) {
  return { data: { threaded_conversation_with_injections_v2: { instructions: [{ type: "TimelineAddEntries", entries }] } } };
}

export function userByScreenNameResponse(id: string, screenName: string) {
  return { data: { user: { result: userResult(id, screenName) } } };
}
