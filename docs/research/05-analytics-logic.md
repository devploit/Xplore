# 05. SuperX content script: analytics and feature logic

Source analysed: `scratchpad/superx/js/content.pretty.js` (332,211 lines, prettified webpack bundle). All line numbers below refer to that file. Read-only analysis for a clean-room local reimplementation.

## 0. Architecture facts that change the picture

Before the per-feature findings, three facts determined by reading the code:

1. **The analytics tweet dataset is fetched from the SuperX server, not from IndexedDB.** The layout component (module `300557`) loads the working set with `c.default.r("/pull/1.2/activity", { includeToken: true, queries: { start, end, uid } })` (line 300748 and again at 300856). `c.default.r` is the API client in module `36410` (line 210934 ff.) and it is a plain `fetch` against `host: "https://api.superx.tools"` (line 211059 `Object.assign({ host: "https://api.superx.tools" }, a)`; HTTP helper module `86637`). The follower series is fetched the same way (`/pull/1/tracker`, line 181477). The `useDataContext().data` consumed by every chart is `ee.tweets` from that server response (line 300886).
2. **The local Dexie `XDatabase` is a cache/side-store, not the analytics source.** Schema is declared at lines 170357-170430. Version 9 sets `users`, `tweets`, `followerTrackers`, `notifications` to `null` (dropped), versions 10/11 add `queues`, `tweetQueues`, `converstaions`, and version 110 (current) re-adds only `tweets` and `users`:
   ```js
   this.version(110).stores({
     queues: "userId,screen_name,created,hit",
     tweetQueues: "id,created,type",
     converstaions: "conversation_id,create_time,...",
     tweets: "++id,created_at,user_id_str,quote_count,retweet_count,reply_count",
     users: "++id,x_user,uid,name,created_at,following,followers_count",
   })
   ```
   `followerTrackers` and `notifications` **no longer exist** in the installed schema. `insertNotifications` (line 170439) still parses `heart_icon` / `retweet_icon` aggregate notifications into `favorite_user_ids` / `retweet_user_ids` and emits an in-memory `"insert"` event, but nothing writes them to a table and no consumer of that event reads `notifications` (only emitter at 170463).
3. **Nothing in the content script uploads the captured tweets to the server.** The `stream()` helper (module `7932`, line 170273) is a no-op (`Promise.resolve()`); `migrate()` (`POST /migrate`) is defined but never called. The server obtains data on its own (it is asked to re-scrape via `POST /extension/auto-refresh` at line 300725 and `POST /extension/refresh-data` at line 302351). The only client-to-server pushes are `/push/1/contact` (support form) and `/push/1/error`.

Consequence for the reimplementation: the *algorithms* below are all client-side and reproducible from a local tweets array shaped like X's GraphQL `legacy` tweet (`created_at` as epoch ms, `view_count`, `favorite_count`, `retweet_count`, `quote_count`, `reply_count`, `bookmark_count`, `full_text`, `in_reply_to_status_id_str`, `conversation_id_str`, `entities.media[].type`, `entities.urls`). Only the data acquisition differs.

## 1. Overview graphs ("Activities" tab, route `/activities`, module `25553`, lines 196829-197330)

### Date range selector
`analyticsDateOptions` (module `71744`, line 283901):
```js
{ label: "Today", value: 0 }, { label: "Last 7 days", value: 7 }, { label: "Last 14 days", value: 14 },
{ label: "Last 30 days", value: 30 }, { label: "Last 60 days", value: 59, isPro }, { label: "Last 90 days", value: 90, isPro },
{ label: "Last 180 days", value: 180, isPro }, { label: "All time", value: -1, isPro }
```
Default period is 30 (line 300605, `I.period : 30`). `-1` ("All time") is mapped to 128 days for the request window (`Ee = -1 === $ ? 128 : $`, line 300627) unless the user has `created_at`, in which case `start = user.created_at` (line 300745). Non-subscribers are capped at 90 days (`xe = ye && Ee > 90 ? 90 : Ee`).

`fromDate` = local midnight N days ago (function `V`, line 301097):
```js
function V(e) { const t = new Date(); return (t.setDate(t.getDate() - e), t.setHours(0, 0, 0), t); }
```
Timezone: **browser local time** via native `Date` (no dayjs.tz) for all overview bucketing. dayjs + timezone plugin is only used in the scheduler and the "Activity time / impression" hour heatmap when a timezone prop is passed (module `86415`, line 302494 `m.default(e).tz(t).hour()`).

### Bucketing
Interval: `c = 0 === z ? "hour" : "day"` (line 196908), i.e. hourly buckets for "Today", daily otherwise. Bucket edges come from module `54840` (line ~232xxx `t.default`): it floors start to `00:00:00` and end to `23:59:59` (or minute for hour), then walks `startDate -> endDate` producing `{startDate, endDate}` pairs.

Aggregation `getCount` (module `47037`, line 232158):
```js
t.getCount = function (tweets, buckets, interval, field) {
  return buckets.map((b) => {
    let label = b.endDate.toJSON().substring(0, "hour" === interval ? 16 : 10);
    const end = b.endDate.getTime(), start = b.startDate.getTime();
    let l = tweets.filter((e) => e.created_at >= start && e.created_at < end),
        c = field ? l.reduce((e, t) => (t[field] || 0) + e, 0) : l.length;
    return { label, value: c, startTime: start, endTime: end, tweets: l };
  });
};
```
Note the label is the **UTC** ISO string of the local bucket end, a known off-by-timezone quirk to avoid replicating.

### Tweet type separation (used everywhere)
`seperateTweetTypes` (module `53227`, line 262164):
```js
e.full_text.startsWith("RT @") ? retweets
: (e.full_text.startsWith("@") || e.in_reply_to_status_id_str) ? replies
: tweets
```
The Tweets table page uses a stricter "Tweets" filter that also drops thread continuations: `!(in_reply_to_status_id_str || full_text.startsWith("@") || full_text.startsWith("RT @") || (conversation_id_str && id !== conversation_id_str))` (line ~296400).

### Series computed (lines 196905-196960)
With `r = tweets`, `a = replies`, `o = retweets`, `i = [...r, ...a]` (originals + replies, **retweets excluded from engagement sums**):
- `ntweets = getCount(r)`; `ntweets_replies = getCount(a)`; `ntweets_retweet = getCount(o)` (counts)
- `nviews = getCount(i, ..., "view_count")` -> "Impressions"
- `nlikes = ... "favorite_count"`, `nretweets = ... "retweet_count"`, `nreplies = ... "reply_count"`, `nbookmarks = ... "bookmark_count"`
- Activity frequency `activitG`: `getCount(F /*all tweets incl. RTs*/, dayBuckets(last 140 days), "day")`, mapped to `{value, time}`; `min/max/avg` are over the last `period+1` days: `w = values.splice(len - z - 1); max = Math.max(...w); min = Math.min(...w); avg = sum/len`.

### Charts rendered
1. **"Frequency" heatmap** (module `36642`, GitHub-contribution style): `weeks: 18`, 7 rows, cell = number of activities that day; header shows `Max / Min / Avg`; colour intensity via `calMaxValue`. Tooltip `"{value} activities on {date}"`.
2. **"Engagement" comparison block** (module `63170`, line 269700) with `beforeData = Impressions` (orange `#F97316`) and datasets `Tweets #F44336, Likes #f91880, Retweets #22c55e, Replies #0ea5e9, Bookmarks #d946ef`. Each small chart displays a **share percentage**: `Math.round(100 * total_i / sum_of_all_totals)` (line 269790; `w = t.maxValue || sum of all dataset totals`). **There is no engagement-rate (engagements/impressions) metric anywhere in the bundle**; greps for `engagementRate`, `engagement_rate`, division by `view_count` return nothing.
3. **Single series chart** (module `48314`, line 234778): Chart.js `type: "line"`, `fill: true`, `tension 0.1`, x scale `type: "time"`. Big number = `r.total || sum(values)`. Cumulative mode (`isGraphAccumulate`, default **on**, `defaultAppProps.isGraphAccumulate: true` line 39579+): `d = b ? C.map((f = 0, e => f += e)) : C` (running sum). "Grow change" (`isGraphIncludeChangeValue`): with `B = len > 14 ? 7 : len > 2 ? 1 : 0`, either `singular`: `last.value - data[len-1-B].value`, or default: `sum(second half) - sum(first half)` (line ~234808, "Midpoint changes").
4. **"Tweets" category block** (module `11388`, line 176327): per-bucket counts of `Videos / Photos / Emojis / URLs` (see section 3), percentages relative to `maxValue = tweets.length`. Its `BeforeComponent` is the **"Activity time / impression"** hour x weekday heatmap (module `86415`): for every original tweet `{time: created_at, value: view_count}` summed into `[dayOfWeek][hour]`, tooltip `"{value} impressions ({count} activities) on {time}"`; options `Include replies` / `Include tweets`.
5. **"Profile" followers chart** (module `13916`, see section 4).
6. **Estimate earning** toggle: `getEstimateEarning({view_count}) = (view_count / 117370) * 1.5` USD (module `14556`, line 181635), applied to the sum of impressions.
7. Clicking a day opens the **period popup** (module `45354` + card `20682`, line 185840): compares current bucket vs previous bucket: `Impression = sum(view_count of non-RT tweets)`, `Followers = tracker value`, `Likes = sum(favorite_count of non-RT)`, `Tweets/Replies/Retweets = counts by seperateTweetTypes`, each with `changed = current - previous`.

Options menu (line 197118): `Estimate earning`, `Cumulate graph`, `Grow change`.

## 2. Best tweets / worst tweets

There is **no "worst tweets" view** (the only "Worst" string is "Worst-case window:" in an unrelated scheduler copy, line 233160).

- **Home > "Highlights" tab** (module `52833`, line ~274xxx): `Array.from(data).sort((a,b) => b.favorite_count - a.favorite_count).splice(0, 20)` -> top 20 by likes within the selected period, no impression floor, replies and RTs **not excluded**. For "All time" (`-1`) it falls back to X GraphQL `UserTweets` via `getBestTweets` (line 195299) paginated with cursor, using a guest token (`/1.1/guest/activate.json`).
- **Home > "Recents"** (module `69947`): `filter(!in_reply_to_status_id_str).sort(desc created_at).splice(0, 12)`.
- **Tweets table** (module `72665`): sortable columns `created_at, full_text, media_count, view_count, favorite_count, retweet_count (sorted by retweet_count + quote_count), reply_count, bookmark_count`; tabs `Tweets / Replies / Retweets`; text search; "previous period" arrows fetch `/pull/1.2/activity` for the window `[fromDate + SID*period*2, fromDate + SID*period]` (line 296219-296228, note the swapped bounds are handled server side).
- **Profile hover tooltip** (module at 215354): "Sort by" `Likes, Views, Retweets, Replies, Bookmarks, Time`.
- Feeds "Inspiration" sort: `{ "Best posts": "top", "Most recents": "latest" }` (line 331192), passed to X `SearchTimeline` `product` (`Top`/`Latest`).

## 3. Media vs text performance (module `11388`, lines 176334-176395)

Categories are **non-exclusive** predicates over original tweets (`data` = `tweets` after `seperateTweetTypes`, i.e. no replies/RTs):
```js
Videos: entities.media.find(m => m.type === "video")
Photos: entities.media.find(m => m.type === "photo")
Emojis: /\p{Emoji}/u.test(full_text)
URLs:   entities.urls.length > 0
```
There is **no** "text-only", "hashtag" or "animated_gif" bucket, and what is compared is only the **count per bucket and its share of all tweets** (`maxValue = n.length`), not engagement per category. (`/\p{Emoji}/u` also matches digits and `#`, a known false-positive to fix in the rewrite.)

## 4. Follower growth tracker (module `13916`, lines 181463-181540)

Data source: `GET https://api.superx.tools/pull/1/tracker?start=<g.getDate()>&end=<Date.now()>&uid=<uid>` (line 181477). Bug: `start: g.getDate()` sends the **day-of-month** (1..31), not a timestamp. Response items have `{ time, followers_count }`.

Series alignment `getDataSeries` (module `47037`, line 232170): for each bucket, take the **first** tracker sample with `time` inside the bucket; if none, **carry forward the previous bucket's value** (`a[o-1].value`), else 0. Then (line 181491):
```js
if (w.length) { const e = w.length > 1 ? w[w.length - 2].value : 0; w[w.length - 1].value = e > 0 ? e : r.followers_count; }
const y = w.map((e, t) => ({ ...e, value: 0 === t ? 0 : Math.max(0, e.value - w[t - 1].value) }));
```
i.e. the last bucket is overwritten with the previous bucket's value (or the profile's live `followers_count` when no history), the chart plots **daily deltas clamped at >= 0** (losses are hidden), rendered cumulatively (`isGraphAccumulate: true`) with the big number = latest absolute count. Gaps: forward fill. No weekly/monthly roll-up exists; the only granularity is the overview interval (hour for Today, day otherwise). Cap notices mention "We import your N most recent followers, and new followers are added automatically" (line ~232060), i.e. follower lists are server-imported.

## 5. Interaction matrix ("Conversations" tab in profile tooltip, module `65608`, lines 274700-275120)

Not a notifications-based matrix. It is "**replies from you to @X**" (and optionally the reverse via `fromUser/toUser`):
1. Builds the X search query `from:<me> to:<them>` (`fmtSearchQuery`), and, after a one-time consent (`popupConsentGiven`), opens `https://twitter.com/search?q=...` in a **1x1 hidden popup window** (line 274790) so the page-context interceptor captures the `SearchTimeline` response into Dexie; polls `appProps.lastSearchResults` every 500 ms, closes after 10 s.
2. After 3 s it queries **local Dexie**: `tweets.where("user_id_str").equals(me).and(t => t.in_reply_to_screen_name === them).reverse().sortBy("created_at")`; fallback scans all tweets for `full_text.includes("@them")` (lines 274860-274905); joins users via `users.where("id_str").anyOf(...)`.
3. Client filters from `userViewSettings`: `replies_includeUserReplies`, `replies_includeNonDirectReplies` (else only `in_reply_to_screen_name === them`), `replies_includeLikedReplies` (else drop `favorited`), `replies_includeAnsweredReplies` (else drop replies that have a child reply in the set).

Likes/retweets between two accounts are **not** computed anywhere (the `favorite_user_ids`/`retweet_user_ids` notification parser is dead code, see section 0).

## 6. Inbox / Mentions ("Mentions" route `/mentions`, module `68436`; feed at lines 291400-291900)

Server-side: `POST https://api.superx.tools/api/engage/mentions` with `{ cursor, selectedAccountIds, sortMode, includeReplied: true }` (line 291843); returns `posts[] { id, author{followers_count,is_blue_verified}, public_metrics{like_count,retweet_count,impression_count}, mention_type, replied }`, `hasMore`, `nextCursor`. Client filters (line 291716-291735): `minLikes, minRetweets, minImpressions, minFollowers, verifiedOnly, mention_type ("all" or specific), hideReplied`; `sortMode "top"` sorts by `like_count desc, then impression_count desc`; filters persisted in `localStorage`. The subtitle: "See replies and mentions across all your connected accounts in one feed." There is also a legacy local `transformMentions` (line 265151) that captures X's `/2/notifications/mentions` payload (`globalObjects.tweets/users/notifications`) into Dexie. Quote-tweets are not treated separately (no `quoted_status` logic in mentions).

## 7. Custom timelines (route `/timeline`, module `864`, lines 1367-1620)

Three types, `CustomTimelineType { List = 0, Search = 1, User = 2 }` (line ~207460). Stored in `localStorage` appProps `timelines[]` as `{ listId, type, name, description, created_at, isPrivate, userId, query }`.
- **List**: X GraphQL `ListLatestTweetsTimeline` (line 233523) with cursor; lists created/edited through `CreateList`, `ListAddMember`, `UpdateList`, `ListByRestId` (module `47958`); a default list `defaultListName` is auto-created (`createDefaultList`).
- **User**: X GraphQL `UserTweets` (module `72886` -> `97026`), paginated by cursor.
- **Search**: **server** endpoint `GET https://api.superx.tools/search/1.1/i?q=&limit=50&page=&quality=true&sensitive=false&isLibrarySearch=true&created_at=<now-24h>` (`searchLibraryTweets`, line ~167xxx), i.e. keyword timelines are only the last 24 h from SuperX's library, sorted desc by `created_at`.
Refresh: **manual only** (menu "Refresh" -> `handleRefresh`/`hardRefresh`, infinite scroll appends via cursor); no timers. Results are cached per `listId` in module-level maps.

## 8. Shareable posters (screenshot modal, module at lines 328900-329190; "Generate poster" at 177395)

- Library: **html-to-image** (module `10777`, exports `toPng, toBlob, toJpeg, toSvg, toCanvas, toPixelData, getFontEmbedCSS`), called as `toPng(container, { pixelRatio: 2 })` / `toBlob(...)` (lines 328966, 328990).
- Export paths: **Download** PNG named `superx-<screen_name>-<slug>.png` (`downloadBase64Image`), **Copy** to clipboard (`copyBlobToClipboard`), **Post** as media (`new File([blob], "output.png", {type: "image/png"})` dropped into X's composer `#drop-zone` via `postFile`). Every chart has a "Share chart" button that re-renders the same component with `media: "print"` (`setScreenshotComponent`).
- Style list `L` (line 329155-329185), **16 entries**: `var(--superx-bg)` (no-theme), solid `#fe6920, #fbb81e, #7edbb6, #1acf86, #91d2fa, #1c95e0, #e9254e, #9721FF`, linear gradients `62deg #FBAB7E->#F7CE68`, `0deg #08AEEA->#2AF598`, `141deg #21ffef->#8f1ef3`, `141deg #ff6a21->#8f1ef3`, and three multi-`radial-gradient` "mesh" backgrounds (two with `grain: true` overlay). Each has `mode: dark|light|no-theme` controlling text colour (`Z = { light: "black", dark: "white", "no-theme": "inherit" }`). Selected index persisted as appProps `screeshotTheme`. Footer shows avatar, `@handle ·`, period label and `dayjs().format("MMM DD, YYYY")`, optional logo.

## 9. Quick actions and theme handling

- Theme detection (`getAppTheme`, module `83882`, line 299786, duplicated at 215034): reads `document.body.style.backgroundColor`: `"rgb(21, 32, 43)" -> "dim"`, `"rgb(0, 0, 0)" -> "dark"`, else `"light"`; class applied is `"dim dark"` for dim. Settings allow forcing `system | dark | dim | light` (line 203310); `appColors = { dark: black, dim: #15202b, light: white }`.
- Per-tweet actions found in list rows (module `99688`, line 331195 ff. and `88572`): copy full text (`title: "Click to copy"`), open on X, "Share" (screenshot), "Copy to Composer", "Quote reply", "Reply to this post", "Share chart". No feature literally named "Quick actions" exists in the bundle.

## 10. Scheduler, auto-retweet, auto-delete, auto-plug, auto-DM

All rules are **stored and executed server-side**:
- Saving a post: `putTweet` (module `15369`, line 182657) does `POST https://app.superx.so/api/me/tweets` with `{ time, details[], autoRetweet, autoPlug, autoDelete, autoDM, superFollowersOnly, ... }`. "Publish now" is `POST /api/posts/publish-now` (line 203990). Counters from `/api/me/tweets/counts`. Bulk tools: `/api/tweets/bulk-delete`, `/api/tweets/bulk-hide`, `/api/tweets/bulk-enable-autort`.
- Client execution model: `chrome.alarms` occurrences = 0; `chrome.runtime` = 5 (messaging only); the 15 `setInterval` calls are UI polling (DOM data stream, popup search polling, countdowns). Nothing in the content script fires retweets/deletes on a timer. Confirmed: no background worker needed because the server does it.
- Parameters, `FACTORY_POST_DEFAULTS` (line ~180815):
  ```js
  autoRetweetAfterH: 8, autoRetweetCleanAfterH: 4, autoPlugThreshold: 20,
  autoDeleteAfterH: 4, autoDeleteThreshold: 1e3, autoDMMaxDMs: 100
  ```
  - **Auto-retweet**: `{ retweets: [{ afterH }...], cleanAfterH }` (`getDefaultAutoRetweet`, line 180768); each `afterH` clamped 1..12 (line ~226xxx); tooltip "Timing is randomised by ±15 min to look more natural"; `cleanAfterH` = hours after which the RT is undone.
  - **Auto-delete**: `{ afterH (default 4, dropdown), threshold (views, default 1000) }`; label "Delete after Nhrs (when views < T)" (line 236757).
  - **Auto-plug**: `{ tplId, threshold }` -> 'Using "<template>" (when likes >= T)' (line 236747); templates in appProps `plugTemplates`.
  - **Auto-DM**: `{ enabled, triggers: { reply: true, retweet: false }, maxDMs: 100, batchMode }` (line 263483, 236768); status via `/api/autodm/status`, send via `/api/bulk-dm/send`.
- Timezone: `selectedTimezone` appProp, default `getDefaultTimezone()` = browser tz if in `MAJOR_TIMEZONES` else `"UTC"` (module `60590`, line ~266470); conversions with `dayjs.tz(...).utc().toISOString()`. Predefined posting slots via Redux thunk `fetchPredefinedSlots({ timezone, schedule })` (line 176448).
- **Suggested best times** (module at 296520-296720): fetches `GET /api/analytics/summary?start=<now-266d>&end=<now>` (server), then locally buckets `created_at` by hour in the chosen timezone (`dayjs(created_at).tz(tz).hour()`), counts posts and sums `view_count` per hour, keeps hours sorted by post count, picks up to `min(n,7)` hours at least 3 h apart, allocates `n` weekly slots proportionally to counts (`round(n * count/total)`, then trims/pads to exactly `n`), spreads them over weekdays round-robin, and sorts by hour. Fallback when no history: hours `[9,18,8,17,12,19,7,13,16,20]`.

## 11. Analytics computed server-side (flag list)

| Endpoint (host `https://api.superx.tools` unless noted) | Used for |
|---|---|
| `GET /pull/1.2/activity?start&end&uid[&meta]` | the tweet dataset for Activities/Home/Tweets (all charts derive from it locally) |
| `GET /pull/1/tracker?start&end&uid` | follower history series |
| `GET /pull/1.2/user`, `/pull/1/user?screen_name`, `/pull/1.2/tweet` | user/tweet lookups |
| `POST /extension/auto-refresh`, `POST /extension/refresh-data {targetUserId, targetUsername, periodDays}` | ask server to re-scrape; on success dispatches `superx-refresh-data` |
| `GET /api/analytics/summary?start&end` | 266-day posting history for best-time generator |
| `POST /api/engage/mentions`, `/api/engage/discover`, `/api/engage/lists-posts`, `/api/engage/all-replies`, `/api/engage/filter-replied-posts` | Mentions / Feeds / My Replies |
| `GET /search/1.1/i` | keyword custom timelines (24 h library search) |
| `POST /api/tools/algorithm-predict {versionA, versionB}` | "Algorithm simulator" scores (the "Total Engagement" chart at 176931 is a **fake animated curve** built from sin/cos + random, not real data) |
| `app.superx.so/api/me/tweets*`, `/api/posts/publish-now`, `/api/tweets/bulk-*`, `/api/autodm/*`, `/api/bulk-dm/send` | scheduler and automations |
| `/api/contacts/*`, `/api/signals/agents`, `/api/quota/snapshot`, `/api/ai-chat*`, `/api/chat`, `/api/completion` | contacts/leads, quotas, AI |

Purely local (reproducible offline): bucketing, type separation, all overview series, share percentages, cumulative/midpoint-change, Highlights top-20, table sorting, media/emoji/url categorisation, hour heatmaps, poster rendering, theme detection, follower delta math (given a tracker series), best-time slot allocation (given a history).

## 12. Embedded WASM (HEIF decoder)

The base64 blob at line 307320 (`var Module=...`) is the **heic2any 0.4.5** bundle (`VERSION: "0.4.5"`, line 307305) which embeds **libheif** compiled to asm.js/WASM and runs it in a Blob-URL `Worker` (`window.__heic2any__worker`, line 307322). It is used only by the composer media pipeline (module around line 270015-270095): `isHeicFile()` checks `image/heic|heif` or `.heic/.heif`; `m(file)` lazy-loads module `88816` and calls `heic2any({ blob, toType: "image/jpeg", quality: 0.9 })`, renaming to `.jpg`; afterwards images are compressed with browser-image-compression (`{ maxSizeMB: 4.4, maxWidthOrHeight: 4096, useWebWorker: true }`). It is purely for converting iPhone HEIC photos before upload; it has no analytics role. Limits nearby: 5 MB / 15 MB / 512 MB constants for image/GIF/video.

## Uncertainties

- `/pull/1.2/activity` response item shape was inferred from field usage (`created_at` numeric ms, `view_count`, `bookmark_count`, `entities`, `in_reply_to_screen_name`); the exact server schema and how far back the server backfills were not visible.
- Whether the server-side `/api/analytics/summary` items include replies/RTs is unknown; the client uses them unfiltered.
- The label bug (`toJSON()` UTC label vs local bucket) and the tracker `start: g.getDate()` bug are observed as written; whether the server compensates is unknown.
- Module `88816` (heic2any wrapper) was identified by the `VERSION`/worker strings, not by a package banner.
- `getBestTweets` fallback uses a hard-coded public bearer token and a static `x-client-transaction-id`; I did not verify it still works against current X.
- I did not trace the page-context interceptor that feeds Dexie (`transformSearchTimelineData`, `transformUserTweetsAndReplies` at 265xxx) beyond confirming they call `dbCore.insertTweets/insertUsers`.
- "16 styles" matches the 16 entries in array `L`; if marketing counts logo on/off variants differently, the number may differ.
