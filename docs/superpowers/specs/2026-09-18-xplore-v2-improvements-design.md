# Xplore v2 improvements: design

Scope agreed on 2026-09-18. Eleven improvements picked from the review of v1 plus a README section on how the extension works without X's public API. Everything stays local: the only network destination remains x.com through the logged-in session.

## 0. Data foundation: per-post metric snapshots

New Dexie table `tweetMetrics` with primary key `[tweet_id+taken_at]` and index `tweet_id`. Row: `tweet_id, taken_at, view_count, favorite_count, retweet_count, reply_count, quote_count, bookmark_count`.

Written by `Ingestor.store` for the current user's own tweets only, when the tweet is younger than 7 days and the counters differ from the latest stored snapshot (or none exists). The hourly refresh job already re-reads the newest pages, so recent posts get roughly hourly points without any new request. `runPrune` deletes snapshots older than 90 days. Database version 2; version 1 data is kept untouched.

## 1. Post detail

Clicking the header row of a `TweetCard` opens an overlay inside the panel (`PostDetail`) with: full text and media, the six counters, engagement rate against the median rate of the user's own posts in the selected period, a line chart of impressions from `tweetMetrics` over the first 48 hours (falls back to "not enough snapshots yet" when fewer than two points), and the captured replies and quotes to that post. Selection lives in a store signal `selectedTweetId`; Escape or the back button closes it.

Analytics: `metricCurve(snapshots, metric, tweetCreatedAt, hours = 48)` returns `Point[]` labelled by hour offset; `medianEngagementRate(tweets)`.

## 2. Period comparison

`periodData` also computes the previous period of equal length (`prevBuckets`, `prevTweets`). `LineChart` accepts `compare?: Point[]`, drawn as a dashed muted line with no fill. `StatCard` forwards it. Activity gets a fourth toggle, "Compare", persisted as `settings.showCompare` (default off). "All time" and "Today" have no meaningful previous period: the toggle is hidden for them.

## 5. Threads and composer

Threads: `groupThreads(ownTweets)` groups the user's posts by `conversation_id_str` where the root is their own tweet and at least one continuation exists. Posts gets a "Threads" tab listing each thread as a card with part count, summed impressions and engagements, and the root text; clicking opens the root's detail.

Composer: **dropped on 2026-09-18 by decision of the owner**, because posting or scheduling through X's internal `CreateTweet` call is the one feature that could read as automation and put the account at risk. The pencil button in the panel footer opens X's own composer instead. Xplore never writes on the user's behalf beyond the single-click like, retweet and bookmark actions that existed in v1.

## 6. CSV export

Settings gets "Export CSV" next to "Export JSON": one row per own post with `id, created_at (ISO), kind, text, impressions, likes, retweets, quotes, replies, bookmarks, url`. RFC 4180 quoting.

## 7. Reply from Mentions

`QuickActions` gains a reply button that opens the mention on X, where the reply box sits under the post. No request is made by Xplore. The existing `replied` flag keeps updating through passive capture once the reply is sent from X.

## 8. Onboarding

A `Welcome` card replaces the empty state on Home and Activity while the user has no captured posts or the first backfill has not completed. Three steps with live status: session detected (user id and handle), posts captured so far, backfill progress (pages walked from the `backfill:UserTweets` row) with a bar. The store exposes `backfillState` from a live query on the `backfill` table.

## 9. Floating button and badge

Note (2026-09-18): the Profile tab was renamed "Sniper" in the UI and README; the route id stays `profile`.

The collapsed-panel button shows the Xplore logo (PNG inlined at build time) instead of the generic stroke icon. It and the Mentions nav icon show a badge with the count of mentions newer than `settings.mentionsSeenAt`; opening Mentions sets that timestamp.

## 10. Light theme

Light tokens get slightly stronger borders and a soft card shadow token, the segmented control's selected state gets a visible border, table hover and heatmap empty cells use a light-specific tint, and the panel shadow softens. No dark or dim changes beyond using the new tokens.

## 13. Skeletons and animated numbers

`storeReady` signal turns true after the first own-tweets live query emits. Home, Activity and Posts render `Skeleton` cards until then. `AnimatedNumber` tweens the big number in `StatCard` over 350 ms when its value changes.

## 14. Chart tooltips and drill-down

`LineChart` tooltips show the full local date (or hour) as title, the formatted value, and "N posts published" when the points carry `count`. `series()` gains an optional `count` per point. Clicking a point calls `onSelect(index)`; `StatCard` sets `selectedBucket` in the store and an overlay lists the user's posts in that bucket.

## 15. Accessibility

Heatmap cells become `role="img"` with an `aria-label` carrying the value and slot, containers become `role="group"`, and a numeric legend (min, max) sits under each heatmap. Posts table headers use `<button>` elements for sorting with `scope="col"`; rows stay reachable through their existing links.

## 16. Growth features (added 2026-09-18)

- **Reply radar** replaces "worth replying to" in Feeds: posts from other people captured from the home timeline, filtered by age (1, 3 or 24 hours), at most 5 replies, and authors with more followers than the user; ranked by impressions per minute, falling back to engagements per hour. A daily reply counter against `settings.replyGoal` (default 10) sits in the card header; filters persist in `settings.radar`.
- **Follower attribution**: new table `followerPoints` (`[user_id+taken_at]`) written whenever a captured response carries the user's own profile with a changed follower count. `followerAttribution` splits each change between consecutive points among original posts published in the previous 24 hours, weighted by impressions. Shown under the Followers chart in Activity; unattributed changes are reported separately. Points older than a year are pruned.
- **Reply targets**: `replyTargets` groups the user's replies by the account replied to and ranks by average impressions. Card in Activity insights with a link to each account.
- **Evergreen**: third Home tab listing original posts older than 60 days with likes or bookmarks, ranked by likes plus twice the bookmarks. Ignores the period selector on purpose.
- **Weekly report**: button in the Activity toolbar opens the existing poster modal with followers gained, impressions, engagement, best post and streak for the last seven days.

All five read the local database only. Database version 4.

## README

New final section "How it works without the X API": passive capture of the responses X already loads, replay of the same GraphQL calls with the user's own session, local storage in IndexedDB, learned query ids, and the limits that follow (needs an open X tab, subject to X's rate limits, no data the user could not see on X).

## Testing

Unit tests for: DB v2 opens with v1 data, snapshot writes and dedupe, `metricCurve`, `groupThreads`, previous-period buckets, CSV builder. `npm run verify` must stay green.

## Out of scope

Follower diffing, goals and notifications, resizable panel, reordering Activity sections, UI component tests.
