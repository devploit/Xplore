import { describe, expect, it } from "vitest";
import { normalizeGraphql, normalizeRest, parseXDate } from "@/data/normalizer";
import * as fx from "../fixtures/builders";

const NOW = 1_800_000_000_000;

describe("normalizeGraphql", () => {
  it("extracts tweets and users from a timeline_v2 UserTweets response with item entries", () => {
    const body = fx.userTweetsResponse([
      fx.itemEntry("tweet-1", fx.tweetResult("1", "42", "me")),
      fx.itemEntry("tweet-2", fx.tweetResult("2", "42", "me", { favorite_count: 99 })),
      fx.cursorEntry("DAABCgABGw", "Bottom"),
    ]);
    const { tweets, users } = normalizeGraphql(body, NOW);
    expect(tweets.map((t) => t.id).sort()).toEqual(["1", "2"]);
    expect(tweets.find((t) => t.id === "2")?.favorite_count).toBe(99);
    expect(tweets[0]?.user_id_str).toBe("42");
    expect(tweets[0]?.view_count).toBe(1500);
    expect(tweets[0]?.created_at).toBe(Date.parse("Wed Sep 10 10:00:00 +0000 2025"));
    expect(tweets[0]?.updated_at).toBe(NOW);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: "42", screen_name: "me", name: "Name me", followers_count: 1200, friends_count: 300 });
  });

  it("handles the legacy `timeline` key and module entries (self threads)", () => {
    const body = fx.userTweetsResponse([fx.moduleEntry("profile-conversation-1", [fx.tweetResult("10", "42", "me"), fx.tweetResult("11", "42", "me", { in_reply_to_status_id_str: "10", conversation_id_str: "10" })])], { v2: false });
    const { tweets } = normalizeGraphql(body, NOW);
    expect(tweets.map((t) => t.id).sort()).toEqual(["10", "11"]);
    expect(tweets.find((t) => t.id === "11")?.in_reply_to_status_id_str).toBe("10");
  });

  it("unwraps TweetWithVisibilityResults", () => {
    const wrapped = { __typename: "TweetWithVisibilityResults", tweet: fx.tweetResult("20", "42", "me"), limitedActionResults: {} };
    const { tweets } = normalizeGraphql(fx.searchResponse([fx.itemEntry("tweet-20", wrapped)]), NOW);
    expect(tweets.map((t) => t.id)).toEqual(["20"]);
  });

  it("prefers note tweet text and records media, urls, hashtags and mentions", () => {
    const legacy = {
      full_text: "short https://t.co/abc",
      entities: {
        urls: [{ url: "https://t.co/abc", expanded_url: "https://example.org/post" }],
        hashtags: [{ text: "ai" }],
        user_mentions: [{ id_str: "7", screen_name: "friend" }],
        media: [{ type: "photo" }],
      },
      extended_entities: { media: [{ type: "photo" }, { type: "video" }] },
    };
    const extra = { note_tweet: { is_expandable: true, note_tweet_results: { result: { text: "the very long article text" } } } };
    const { tweets } = normalizeGraphql(fx.tweetDetailResponse([fx.itemEntry("tweet-30", fx.tweetResult("30", "42", "me", legacy, extra))]), NOW);
    expect(tweets[0]).toMatchObject({
      full_text: "the very long article text",
      media_types: ["photo", "video"],
      urls: ["https://example.org/post"],
      hashtags: ["ai"],
      user_mentions: [{ id_str: "7", screen_name: "friend" }],
    });
  });

  it("records the retweeted tweet id and keeps both tweets", () => {
    const original = fx.tweetResult("40", "7", "friend");
    const rt = fx.tweetResult("41", "42", "me", { full_text: "RT @friend: tweet 40", retweeted_status_result: { result: original } });
    const { tweets } = normalizeGraphql(fx.userTweetsResponse([fx.itemEntry("tweet-41", rt)]), NOW);
    expect(tweets.find((t) => t.id === "41")?.retweeted_status_id_str).toBe("40");
    expect(tweets.map((t) => t.id).sort()).toEqual(["40", "41"]);
  });

  it("reads users from UserByScreenName, including the 2025 core.screen_name layout", () => {
    const body = fx.userByScreenNameResponse("42", "me");
    delete (body.data.user.result.legacy as Record<string, unknown>).screen_name;
    const { users, tweets } = normalizeGraphql(body, NOW);
    expect(tweets).toHaveLength(0);
    expect(users[0]).toMatchObject({ id: "42", screen_name: "me", profile_image_url_https: "https://pbs.twimg.com/profile_images/42/x_normal.jpg" });
    expect(users[0]?.created_at).toBe(Date.parse("Tue Mar 01 12:00:00 +0000 2016"));
  });

  it("skips tweets without a date or author and never throws on junk", () => {
    const broken = { __typename: "Tweet", rest_id: "50", legacy: { full_text: "no date" } };
    expect(normalizeGraphql({ data: [broken, null, 3, "x", { a: { b: [] } }] }, NOW)).toEqual({ tweets: [], users: [] });
    expect(normalizeGraphql(undefined, NOW)).toEqual({ tweets: [], users: [] });
  });

  it("survives cyclic structures", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(normalizeGraphql(a, NOW)).toEqual({ tweets: [], users: [] });
  });
});

describe("parseXDate", () => {
  it("parses X's date format and rejects garbage", () => {
    expect(parseXDate("Wed Sep 10 10:00:00 +0000 2025")).toBe(Date.UTC(2025, 8, 10, 10));
    expect(parseXDate("not a date")).toBeUndefined();
    expect(parseXDate(5)).toBeUndefined();
  });
});

describe("media, viewer flags and REST globalObjects", () => {
  it("stores media thumbnails from pbs.twimg.com and the viewer's like, retweet and bookmark state", () => {
    const legacy = {
      favorited: true,
      retweeted: false,
      bookmarked: true,
      extended_entities: { media: [{ type: "photo", media_url_https: "https://pbs.twimg.com/media/abc.jpg", expanded_url: "https://x.com/me/status/1/photo/1" }, { type: "video", media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/x.jpg", expanded_url: "https://x.com/me/status/1/video/1" }, { type: "photo", media_url_https: "https://evil.example/x.jpg" }] },
    };
    const { tweets } = normalizeGraphql(fx.userTweetsResponse([fx.itemEntry("t", fx.tweetResult("1", "42", "me", legacy))]), NOW);
    expect(tweets[0]).toMatchObject({ favorited: true, retweeted: false, bookmarked: true, media_types: ["photo", "video", "photo"] });
    expect(tweets[0]?.media).toEqual([
      { type: "photo", thumb: "https://pbs.twimg.com/media/abc.jpg", url: "https://x.com/me/status/1/photo/1" },
      { type: "video", thumb: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/x.jpg", url: "https://x.com/me/status/1/video/1" },
    ]);
  });

  it("parses REST notifications globalObjects into tweets and users", () => {
    const body = {
      globalObjects: {
        users: { "7": { id_str: "7", screen_name: "friend", name: "Friend", followers_count: 10, friends_count: 2, statuses_count: 3, ext_is_blue_verified: true } },
        tweets: { "500": { id_str: "500", user_id_str: "7", created_at: "Wed Sep 10 10:00:00 +0000 2025", full_text: "@me hello", in_reply_to_user_id_str: "42", in_reply_to_status_id_str: "1", favorite_count: 3, retweet_count: 0, reply_count: 1, quote_count: 0, bookmark_count: 0, entities: {}, ext_views: { count: "88" } } },
        notifications: { n1: { id: "n1" } },
      },
      timeline: { instructions: [] },
    };
    const { tweets, users } = normalizeRest(body, NOW);
    expect(users[0]).toMatchObject({ id: "7", screen_name: "friend", is_blue_verified: true });
    expect(tweets[0]).toMatchObject({ id: "500", user_id_str: "7", in_reply_to_user_id_str: "42", view_count: 88, favorite_count: 3 });
    expect(normalizeRest({ nope: 1 }, NOW)).toEqual({ tweets: [], users: [] });
  });
});
