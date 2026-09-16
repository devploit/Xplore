# 02 - Data capture layer (listener.js and the content-script fetchers)

Sources (prettified webpack bundles):

- `L` = `/private/tmp/claude-503/-Users-dpua-Projects-x-lytics/1c213968-42fb-4edc-90c9-f7f35f2318b8/scratchpad/superx/js/listener.pretty.js` (9,979 lines)
- `C` = `/private/tmp/claude-503/-Users-dpua-Projects-x-lytics/1c213968-42fb-4edc-90c9-f7f35f2318b8/scratchpad/superx/js/content.pretty.js` (332,211 lines)

`L:123` means listener.pretty.js line 123; `C:123` means content.pretty.js line 123.

## 0. Headline: the premise is wrong, listener.js is not the capture layer

listener.js contains **no network interception of any kind**. `grep -c -E "fetch|XMLHttpRequest|PerformanceObserver" listener.pretty.js` returns `0`. There is no `window.fetch` wrapper, no `XMLHttpRequest.prototype.open/send` patch, no `Response.prototype.json` patch, no `PerformanceObserver`.

The listener bundle is composed of these webpack modules (`L:3`-`L:9979`):

| Module id | Lines | Role |
|---|---|---|
| 7935 | L:3-300 | `dbCore`: Dexie subclass `XDatabase`, `cleanTweet`/`cleanUser`, insert methods, appProps in localStorage |
| 8696 | L:302-322 | `Events`, `AppConfig = {frameId:"ext-frame"}`, `RequestType` enum |
| 15473 | L:323-347 | `getCookies()` (reads `document.cookie`), `jpConcat()` (multi-JSONPath query) |
| 20804 | L:348-371 | `defaultSchedule` (posting schedule defaults, irrelevant here) |
| 30228 | L:372-502 | `eventemitter3` library |
| 39579 | L:503-534 | constants: `API_ENDPOINT = "https://api.superx.tools"`, `defaultAppProps`, `twitterDomain = document.location.host` |
| 44503 | L:535-600 | `transformUsersByRestIds` |
| 45615 | L:601-4897 | `jsonpath` library (browserified) |
| 56917 | L:4898-5029 | transforms: Search, UserTweetsAndReplies, Mentions, TweetDetail, UserTweets, `saveLimitHeaders`, `getLimitHeader` |
| 62026 | L:5030-5178 | formatting helpers (dates, numbers, file download) |
| 65830 | L:5179-9260 | Dexie library |
| 74353 | L:9261-9700 | dayjs |
| 81165 | L:9701-9788 | `DOMDataStream` (hidden-div message channel) and `waitUntil` |
| 83097 | L:9789-9838 | **entry point** |
| 92377 | L:9839-9948 | `transformExploreTweets` |

The entry module (`L:9789-9838`) does exactly four things:

1. Imports the transform modules purely for side effects: `(n(56917), n(8696), n(15473), n(44503), n(92377), i(n(7935)))` at `L:9800`. None of those modules has side effects other than defining exports. **No code in listener.js ever calls** `transform*`, `insertTweets`, `insertUsers`, `insertNotifications`, `saveLimitHeaders` or `getCookies` (verified: the only occurrences of those names are their definitions and the intra-transform calls at `L:594`, `L:4923`, `L:4942`, `L:4955-4957`, `L:4988-4989`). They are shared source files that were bundled into listener.js by the build and are dead code there.
2. Finds its own `<script data-id=...>` tag and opens a `DOMDataStream` on that id (`L:9801-9807`):
   ```js
   let a = Array.from(document.querySelectorAll("script[data-id]")).find((e) => e.src.endsWith("js/listener.js"))?.dataset.id;
   const u = new o.default({ id: a });
   s.dbCore.addListener("insert", (e) => { u.write({ inserts: e }); });
   ```
   Because nothing in the listener bundle ever calls an insert method, this "insert" listener never fires. The channel exists but is idle.
3. Hijacks the page's React Router history object (`L:9811-9821`):
   ```js
   Object.defineProperty(Object.prototype, "history", {
     get: function () { return this.___originalHistory || window.__xRouter; },
     set: function (e) { (this.___originalHistory = e), "replace" in e && (window.__xRouter = e); },
   });
   ```
   Any object in the page that assigns a `.history` property whose value has a `replace` method (the react-router `history` instance inside X's bundle) gets captured as `window.__xRouter`. This is the only reason listener.js must run in the page's main world.
4. Listens for `window` `message` events with `{caller:"__x__", type:"push"|"replace", value}` from the same origin and calls `window.__xRouter.push/replace(value)`, falling back to `window.location.href = value` (`L:9822-9837`).

So in this build, listener.js is an **SPA navigation bridge**, not a data capture layer. The actual X data acquisition lives in the content script and is **active fetching**, not passive interception (section 3). The content script instantiates its own Dexie `XDatabase` (same origin IndexedDB as the page) and writes to it directly (section 6).

## 1. What listener.js offers a page-world consumer (for completeness)

`dbCore` (`L:57-247`) is exported and constructed at `L:298` (`const p = new c(); t.dbCore = p;`), which means opening the Dexie DB in the page world happens on first table access only (Dexie lazy-opens). The class API:

- `addListener(event, fn, ctx)` returns an unsubscribe closure (`L:135-141`).
- `insertNotifications(arr)` (`L:142-170`): maps each raw notification through `l()` (`L:220-236`), stamps `uid` = current user id, groups by tweet id merging `favorite_user_ids`/`retweet_user_ids` (dedupe), stamps `created: Date.now()` for new or `updated: Date.now()` for merged, then only `this.listeners.emit("insert", { notifications })`. **It never writes to Dexie** (the `notifications` table no longer exists after v9, see section 6).
- `insertTweets(arr)` (`L:171-177`): `e.map(this.formatTweet).filter(d)` then `emit("insert", {tweets})` and `this.tweets.bulkPut(t)`. `d` (`L:290-292`) is a first-occurrence-by-`id` dedupe.
- `insertUsers(arr)` (`L:178-192`): emits `"users"` `{type:"insert", data: rawUsers}` first, then `map(f).filter(d).map(e => ({...e, uid: e.id}))`, then if `appProps.user` is unset and `appProps.screen_name` matches a user in the batch, `updateAppProps({user})`; then `emit("insert", {users})` and `this.users.bulkPut(t)`.
- `setScreenName`, `updateAppProps`, `getAppProps`, `getAppPropsValue` (`L:193-218`): appProps are stored as JSON in `localStorage["__X_VISION__PROPS"]`, merged over `defaultAppProps` (`L:509-530`).
- `formatTweet = (e) => this.cleanTweet(e?.tweet || e)` (`L:62`) unwraps `TweetWithVisibilityResults`.
- Statics: `XDatabase.cleanUser = f`, `XDatabase.cleanTweet = h` (`L:293-296`).

## 2. Dexie schema (identical in both bundles: `L:66-131` and `C:170363-170428`)

Database name: `"XDatabase"` (`L:58`). Versions declared, in order:

```js
this.version(4).stores({
  users:            "++id,x_user,uid,name,created_at,following,followers_count",
  tweets:           "++id,created_at,user_id_str,quote_count,retweet_count,reply_count",
  followerTrackers: "++id,date,user_id",
  notifications:    "id,created,updated,*favorite_user_ids,*retweet_user_ids",
}).upgrade(t => t.table("users").toCollection().modify(t => {
  t.uid = t.id; t.x_user = screen_name; t.id = `${t.id}-${screen_name}`;
}))                                                            // L:66-82
this.version(5).stores({
  users:            "++id,x_user,uid,name,created_at,following,followers_count",
  tweets:           "++id,created_at,user_id_str,quote_count,retweet_count,reply_count",
  followerTrackers: "++id,date,user_id",
  notifications:    "id,x_user,created,updated,*favorite_user_ids,*retweet_user_ids",
}).upgrade(t => t.table("notifications").toCollection().modify(t => { t.x_user = screen_name; }))  // L:83-99
this.version(7).stores({ ...same 4 tables as v5..., queues: "userId,screen_name,created, hit" })   // L:100-106 (note the stray space in " hit")
this.version(9).stores({
  queues: "userId,screen_name,created,hit",
  users: null, tweets: null, followerTrackers: null, notifications: null,   // tables DELETED
})                                                             // L:107-113
this.version(10).stores({
  queues: "userId,screen_name,created,hit",
  converstaions: "conversation_id,create_time,sort_timestamp,created_by_user_id,type,muted,trusted,notifications_disabled",
})                                                             // L:114-118 (sic: "converstaions")
this.version(11).stores({ queues, tweetQueues: "id,created,type", converstaions })   // L:119-124
this.version(110).stores({
  queues:        "userId,screen_name,created,hit",
  tweetQueues:   "id,created,type",
  converstaions: "conversation_id,create_time,sort_timestamp,created_by_user_id,type,muted,trusted,notifications_disabled",
  tweets:        "++id,created_at,user_id_str,quote_count,retweet_count,reply_count",
  users:         "++id,x_user,uid,name,created_at,following,followers_count",
})                                                             // L:125-131
```

`screen_name` in the upgrade functions is `const { screen_name: e = "none" } = this.getAppProps()` (`L:65`), i.e. the current X user's handle from `__X_VISION__PROPS`.

**Effective current schema (v110)**: 5 tables.

| Table | Primary key | Indexes | Written by |
|---|---|---|---|
| `tweets` | `++id` (auto-increment declared, but records always carry their own string `id` so Dexie uses the supplied key) | `created_at`, `user_id_str`, `quote_count`, `retweet_count`, `reply_count` | `insertTweets` -> `bulkPut` |
| `users` | `++id` | `x_user`, `uid`, `name`, `created_at`, `following`, `followers_count` | `insertUsers` -> `bulkPut` |
| `queues` | `userId` | `screen_name`, `created`, `hit` | `queueUserToFetch` (`C:330540-330551`) |
| `tweetQueues` | `id` | `created`, `type` | drafts queue, drained by `C:297480-297510` into the composer |
| `converstaions` | `conversation_id` | `create_time`, `sort_timestamp`, `created_by_user_id`, `type`, `muted`, `trusted`, `notifications_disabled` | `updateConversation` (`C:330510-330512`); DM inbox cache |

Observations:

- `followerTrackers` and `notifications` **no longer exist** (dropped at v9, not re-added at v110). The v4 index string `*favorite_user_ids,*retweet_user_ids` (multi-entry indexes) is the only trace of the "who liked/retweeted" feature.
- Versions 6 and 8 are skipped; fine for Dexie.
- Because `tweets.id` is the tweet's `rest_id` string and `users.id` is the user's `rest_id` string (see `cleanUser`), the `++` auto-increment is effectively unused. The v4 upgrade that rewrote `users.id` to `${id}-${screen_name}` is moot after the v9 drop.
- Dexie also opens its internal `__dbnames` db (`L:7959`, `C:277818`); not application data.

## 3. How X data is actually obtained: active GraphQL fetching from the content script

### 3.1 The request helper (`C:279364-279560`, module 66083)

`apiRequest(path, opts)` (`C:279396-279463`):

```js
const g = formatURL({ path: e, queries: s, includeProtocal: !1 });   // path-relative URL on x.com
if (u /* includeCrsf, default true */) {
  const e = getCookies();
  e && (n = { ...n, "x-csrf-token": e.ct0, "X-Twitter-Auth-Type": "OAuth2Session" });
}
return fetch(g, { headers: n, method: d, body: v, ...p }).then((e) => (
  (k = getLimitHeader(e.headers)),
  "json" === f ? e.json().then((e) => ({ data: h ? h(e) : e, limit: k })) : { limit: k, data: e, headers: e.headers }
));
```

- `commonHeaders` (`C:279550-279556`): `authorization: "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"` (the public web-client bearer), `x-twitter-client-language: en`, `x-twitter-active-user: yes`, `accept-language: en`.
- Cookies: `getCookies()` (`L:330-340` / `C:182683`) parses `document.cookie` into an object (JSON-parsing values when possible). Only `ct0` is consumed (`C:279445`, `C:279487`, `C:195396`). The content script runs in the x.com origin so `fetch` sends `auth_token` etc. automatically; there is no explicit `auth_token` read.
- `queries` objects are serialised with `encodeURIComponent(JSON.stringify(v))` per key (`C:303675-303684`), giving the usual `?variables=...&features=...&fieldToggles=...` shape.
- `getLimitHeader(headers)` (`L:5014-5028` / `C:265220-265234`) reads `X-Rate-Limit-Limit` -> `total`, `X-Rate-Limit-Remaining` -> `remain`, `X-Rate-Limit-Reset` -> `reset`.
- `apiXHRRequest` (`C:279464-279547`) is the same over `XMLHttpRequest` with optional CORS preflight and `withCredentials = true`; used for non-JSON/binary paths.
- A separate `generateQuery` (`C:195380-195425`) builds `https://${twitterDomain}${basePath}?variables&features&fieldToggles` and calls `fetch` with `requestDetails.headers` overlaid by `x-csrf-token: cookies.ct0 || requestDetails.headers["x-csrf-token"]`, capturing the three rate-limit headers into `limit`.
- `getBestTweets` (`C:195299-195366`) additionally obtains a **guest token** via `POST https://api.twitter.com/1.1/guest/activate.json` with the bearer, stores it as `appProps.xGuessToken`, and sends `x-guest-token` plus a hard-coded fallback `x-client-transaction-id` (`C:195334-195337`).

### 3.2 GraphQL operations called (all hard-coded query IDs unless noted)

| Operation | Query id | Where | Purpose / transform |
|---|---|---|---|
| `UserTweets` | `p9sOCF1tLh4KfPWtt4TNGQ` | `C:218944` (module 40377), `C:329533` (module 97026, used by the backfill queue), `C:195314` (`getBestTweets`) | own/other user's timeline; `transformUserTweets` (`C:218994-219024`) or `transformUserTweetsAndReplies` (`C:329580`) or `transformUserTweetsData` (`C:195294`, `C:195362`) |
| `UserTweets` | `appProps.requestDetails.userTweetsQueryId` (dynamic) | `C:195293` (`getUserTweets`) | same, but query id taken from appProps (see Uncertainties) |
| `TweetDetail` | `ghg6dnwG8DCin2Fr4ik6QQ` | `C:195615` (module 24189) | thread/replies; `transfromTweetDetail` |
| `UsersByRestIds` | `hiTzPd4vKNScu8qzxdjM4g` | `C:183266` (module 15828) | hydrate users by id; `transformUsersByRestIds` |
| `UserByScreenName` | `xWw45l6nX7DP2FKRyePXSw` | `C:298583` (module 82209) | resolve current/visited handle; `transformUserByScreenName` = `$.data.user.result` -> `insertUsers` (`C:298596-298599`) |
| `SearchTimeline` | `fDwnkykAJtODs46h_XZfVg` | `C:280137` | search; `transformSearchTimelineData`; on GraphQL error falls back to SuperX server `/search` (`C:280179-280195`) |
| `ExplorePage` | `9yX4NI33DnsXBZ-UJ7ZwtA` | `C:232200` | explore/trending; `transformExploreTweets` |
| `ListsManagementPageTimeline`, `ListByRestId`, `ListMembers`, `ListLatestTweetsTimeline`, `ListEditRecommendedUsers`, `CreateList`, `UpdateList`, `DeleteList`, `ListAddMember`, `ListRemoveMember` | `zA6TKM6kv5YKudrFKyMalQ`, `ZMQOSpxDo0cP5Cdt8MgEVA`, `-5OaAZ4pICdvoQhPJXsCvg`, `5ge3ZlLe_8IDfG1Bx-S9lA`, `cFO-S3tSC54Nm3DJDSoSMA`, `P51ZB9632Fy0Cv3LdqMNwg`, `bYkQRsxcmEm_YSpiMusY2g`, `UnN9Th1BDbeLjpgjGSpL3Q`, `FpvDMFk4k8HXtkYjQGg_bw`, `q1fNhjkWDJWoHTtsToP0CQ` | `C:233270-233577` | "XList" management; parsers at `C:233303-233353` also call `insertUsers`/`insertTweets` |
| `CreateBookmark`/`DeleteBookmark` | `aoDbu3RHznuiSkQ9aNM67Q` / `Wlmlj2-xzyS1GN3a6cj-mQ` | `C:196568-196573` | mutations (UI actions) |
| `CreateRetweet`/`DeleteRetweet` | `ojPdsZsimiJrUGLR1sjUtA` / `iQtK4dl5hBmXewYZuEOKVw` | `C:210728-210733` | mutations |
| `FavoriteTweet`/`UnfavoriteTweet` | `lI07N6Otwv1PhnEgXILM7A` / `ZYKSe-w7KEslx3JhSIk5LA` | `C:304188-304193` | mutations |
| REST `/i/api/1.1/search/typeahead.json` | n/a | `C:168713` | user autocomplete |

**Not fetched anywhere**: `HomeTimeline`, `Followers`, `Following`, `Likes`, `Notifications`, `UserTweetsAndReplies` (the operation; the transform of that name is applied to a `UserTweets` response at `C:329580`), the REST `/2/notifications/mentions.json`. The `RequestType` enum (`L:311-321`) listing `Followers`, `Following`, `Mentions`, `CreateTweets` is only used as a key into `appProps.requestLog` (`C:212824`, `C:212846`), never to build a request.

### 3.3 Parse paths (JSONPath, via the bundled `jsonpath` lib and `jpConcat`)

All transforms call `dbCore.insertTweets(rawTweets)` and `dbCore.insertUsers(rawUsers)` with the **raw** GraphQL `result` objects and return `{tweets, users, cursor}` (raw) to the caller, which then applies `XDatabase.cleanTweet/cleanUser` for UI use.

`transformUserTweetsData` (`L:4993-5012`, `C:265200`), v2 timeline:
- tweets: `$.data.user.result.timeline_v2.timeline.instructions[*].entries[*].content.itemContent.tweet_results.result`
- users: same path + `.core.user_results.result`
- cursor: `query("$.data.user.result.timeline_v2.timeline.instructions[*].entries[*]").pop().content.value` (the last entry is assumed to be the bottom cursor)

`transformUserTweetsAndReplies` (`L:4925-4943`): identical but through `entries[*].content.items[*].item.itemContent.tweet_results.result` (module/conversation items only; top-level `itemContent` tweets are NOT collected here).

`transformUserTweets` (content-only, `C:218994-219024`), current non-v2 shape `$.data.user.result.timeline.timeline.instructions[*]` x `{entry, entries[*]}` x `{content.itemContent.tweet_results.result, content.items[*].item.itemContent.tweet_results.result}` and each of those + `.legacy.retweeted_status_result.result` (so retweeted originals are also stored). Tweets deduped by `rest_id`; users from `<each path>.core.user_results.result` deduped by `rest_id`; cursor `= ...entries[*]` `.pop().content.value`.

`transfromTweetDetail` (`L:4967-4992`) iterates four roots and concatenates:
- `$.data.threaded_conversation_with_injections_v2.instructions[*].entries[*].content.itemContent.tweet_results.result`
- `...v2...entries[*].content.items[*].item.itemContent.tweet_results.result`
- `$.data.threaded_conversation_with_injections.instructions[*].entries[*].content.itemContent.tweet_results.result`
- `...entries[*].content.items[*].item.itemContent.tweet_results.result`
- users: each path + `.core.user_results.result`; cursor: last `entries[*]` `.content.value`. (Bug: `n`/`r` start `undefined`, so the arrays contain a trailing `undefined` filtered by `.filter(Boolean)`.)

`transformSearchTimelineData` (`L:4906-4924`):
- tweets: `jpConcat(res, "$.data.search_by_raw_query.search_timeline.timeline.instructions[*].entries[*].content.itemContent.tweet_results.result", "...entries[*].content.items[*].item.itemContent.tweet_results.result").map(e => e.tweet || e)`
- users: `t.map(e => e.core.user_results.result)`; if empty (people search) `...entries[*].content.itemContent.user_results.result`
- cursor: `jpConcat(res, "...instructions[*].entry.content.value", "...instructions[*].entries[*].content.value").pop()`

`transformMentions` (`L:4944-4966`), **legacy REST shape, no live caller**:
- tweets `$.globalObjects.tweets[*]`, users `$.globalObjects.users[*]`, notifications `$.globalObjects.notifications[*]`, cursor `$.timeline.instructions[*].addEntries.entries[*]` `.pop().content.operation.cursor.value`.

`transformUsersByRestIds` (`L:591-596`): `$.data.users[*].result` -> `cleanUser`, `insertUsers`; returns `{users, queryId}` where `queryId` is sliced out of `fullpath` (`/i/api/graphql/<id>/...` -> `substring(15, ...)`), but the caller passes `fullpath: "/"` (`C:183268`) so `queryId` is garbage; unused.

`transformExploreTweets` (`L:9907-9944`): root `$.data.explore_page.body.initialTimeline.timeline.timeline.instructions[*].entries[*]`; topics = entries with `content.items`, `name = content.header.text`, items = `$.content.items[*].item.itemContent.tweet_results.result` split into `{tweet: cleanTweet(rest), user: cleanUser(core.user_results.result)}`; trends = `...entries[*].content.itemContent` filtered by `.name`.

List parsers (`C:233303-233353`): `$.data.list.recommended_users.timeline...user_results.result`, `$.data.list.tweets_timeline.timeline...tweet_results.result` (+ `.core.user_results.result`), `$.data.list.members_timeline.timeline...user_results.result`, `$.data.viewer.list_management_timeline.timeline...content.items[*].item.itemContent.list`, `$.data.list.user_results.result`.

## 4. "Cleaned" records

### 4.1 `cleanTweet` = `h` (`L:237-273`)

Input: a GraphQL `Tweet` result (`__typename`, `rest_id`, `core`, `legacy`, `views`, `note_tweet`, `article`, `edit_control`, ...). Steps:

1. `{legacy, article, note_tweet, ...rest} = e; h = legacy || rest` (so the output is the **`legacy` object mutated in place**, or the raw object when there is no `legacy`).
2. `if (rest.views?.count) h.view_count = parseInt(rest.views.count)`.
3. Note tweets: `h.full_text = note_tweet.note_tweet_results.result.text`; `h.entities[k] = (h.entities[k]||[]).concat(entity_set[k])` for each key of `entity_set` (urls, hashtags, user_mentions, symbols...).
4. `delete h.core` (only matters when `legacy` is absent).
5. Articles: `h.full_text = \`${title}\n${preview_text}\``; if `cover_media`, pushes `{sizes:{large:{w,h}}, media_url_https}` into `h.entities.media` (note: `h.entities = {media: []}` **replaces** existing entities when `entities.media` was missing).
6. If `view_count` is still not a number and `h.retweeted_status_result.result.views.count` exists: `h.view_count = parseInt(...)`; `delete h.retweeted_status_result`.
7. `return f(h)` (runs `cleanUser` on the tweet object; see below for the id normalisation).

Resulting fields (everything from X's `legacy` tweet object survives; nothing else is whitelisted): `id` (= `id_str` via `f`), `full_text`, `created_at` (**converted to epoch ms number** by `f`), `user_id_str`, `conversation_id_str`, `favorite_count`, `retweet_count`, `reply_count`, `quote_count`, `bookmark_count`, `view_count` (added), `entities`, `extended_entities`, `in_reply_to_screen_name`, `in_reply_to_status_id_str`, `in_reply_to_user_id_str`, `is_quote_status`, `quoted_status_id_str`, `quoted_status_permalink`, `lang`, `source`, `favorited`, `retweeted`, `bookmarked`, `possibly_sensitive`, `display_text_range`, `retweeted_status_result` (unless deleted in step 6), etc. Removed: `id_str`, `rest_id`, `__typename`, `core`, `avatar`, top-level `views`/`note_tweet`/`article`/`edit_control`/`quoted_status_result`/`unmention_data` (anything outside `legacy` is discarded when `legacy` exists). Consumers rely on `full_text.startsWith("RT @")` to detect retweets (`C:185847`).

### 4.2 `cleanUser` = `f` (`L:274-289`)

```js
const { legacy, core, avatar, ...o } = e;
o.id = o.rest_id || o.id_str || o.id?.toString();
delete o.__typename; delete o.id_str; delete o.rest_id;
const a = core?.created_at || legacy?.created_at || o.created_at;
a && (o.created_at = new Date(a).getTime());
return { ...o, ...legacy, ...(core && { screen_name: core.screen_name, name: core.name }), ...(avatar && { profile_image_url_https: avatar.image_url }) };
```

So a stored user = raw top-level fields (`id`, `is_blue_verified`, `profile_image_shape`, `has_graduated_access`, `verification`, `location`, `privacy`, `professional`, `tipjar_settings`, `relationship_perspectives`, `dm_permissions`, `media_permissions`, `parody_commentary_fan_label`, ...) merged with **all `legacy` fields** (`screen_name`, `name`, `description`, `followers_count`, `friends_count`, `statuses_count`, `favourites_count`, `listed_count`, `media_count`, `profile_image_url_https`, `profile_banner_url`, `verified`, `entities`, `pinned_tweet_ids_str`, `following`, `followed_by`, `can_dm`, ...) with `screen_name`/`name` from the new `core` block and the avatar URL from the new `avatar` block, plus `created_at` as epoch ms and `uid = id` added by `insertUsers`. Caveat: when `legacy.created_at` exists it overwrites the numeric `created_at` with the original string because the spread of `legacy` happens after the assignment (only `core.created_at` shapes avoid this).

## 5. Follower tracker

There is **no client-side follower snapshotting** in either bundle. The `followerTrackers` table (`++id,date,user_id`) was dropped at schema v9 (`L:107-113`) and nothing reads or writes it. The "Followers" chart is fetched from the SuperX backend: `GET https://api.superx.tools/pull/1/tracker?start=<fromDate>&end=<now>&uid=<userId>` (`C:181481`), then `getDataSeries(data, dates, interval, "followers_count")` and the last point is overwritten with the live `user.followers_count` (`C:181490-181493`). Follower-count deltas shown in the profile card come from `/pull/1.2/user` (`C:185089`, `C:298774`, `C:298789`) with `snapshot_followers_count` as a sortable field (`C:168674`, `C:196553`). The backend collects the snapshots itself (server-side scraping triggered by `/extension/auto-refresh` and `/extension/refresh-data`, see section 8). Dedupe-per-day, if any, is server-side and not visible here.

## 6. Notifications table

Fed only by `insertNotifications`, which is only called from `transformMentions` (`L:4957`, `C:265164`), which has no caller in either bundle. The parser `l()` (`L:220-236`) expected the legacy REST `globalObjects.notifications[*]` shape: `template.aggregateUserActionsV1.targetObjects[0].tweet.id` as the tweet id and `template.aggregateUserActionsV1.fromUsers[*].user.id` as the actor ids, mapped by `icon.id`: `"heart_icon"` -> `favorite_user_ids`, `"retweet_icon"` -> `retweet_user_ids`, anything else dropped. The table itself was deleted at v9 and `insertNotifications` never touches Dexie any more (only emits). Conclusion: dead feature; "who liked/retweeted" is not tracked locally in this build.

## 7. Event emitter and bridges

### 7.1 `dbCore.listeners` (eventemitter3)

Events emitted:

| Event | Payload | Emitted at |
|---|---|---|
| `"insert"` | `{ tweets: cleanedTweet[] }` | `insertTweets` (`L:174`) |
| `"insert"` | `{ users: cleanedUser[] }` | `insertUsers` (`L:190`) |
| `"insert"` | `{ notifications: [...] }` | `insertNotifications` (`L:168`) |
| `"users"` | `{ type: "insert", data: rawUser[] }` | `insertUsers` (`L:180`) |

Content-script subscribers to `"insert"`: `C:212668` (forwards to `stream()`, a no-op now, see below) and the Layout component `Le` at `C:300789` which merges freshly inserted tweets of the current user into the in-memory activity list (`C:300639-300650`).

### 7.2 `DOMDataStream` (page world -> content script), module 81165 (`L:9701-9788`, `C:296365`)

- Content script creates the host: `new DOMDataStream({ id: nanoid(), installDOMHost: true })` (`C:284263`) -> a hidden `<div id="<nanoid>" style="display:none">` appended to `document.body`.
- Content script injects `<script src=chrome.runtime.getURL("js/listener.js") data-id="<nanoid>" data-placeholder-url="...ai-bot-placeholder.png">` into `<head>` (`C:212743-212747`). `data-placeholder-url` is never read by listener.js.
- Listener locates the div via `document.querySelector('[id="<id>"]')` (`L:9760`) and `write(obj)` appends `JSON.stringify(obj)` joined with `"\r\n\r\n"` to `div.textContent`, with a `data-locked` attribute as a mutex and `waitUntil(isUnlocked)` polling at `interval` (default 1000 ms) (`L:9735-9752`).
- Content script `onData(fn)` polls every 1000 ms: if `textContent` non-empty and not locked, lock, take the text, clear it, unlock, `split("\r\n\r\n").filter(Boolean).map(JSON.parse)` and call listeners with the array (`L:9713-9727`).
- Message shape written by listener: `{ inserts: { tweets?: [...], users?: [...], notifications?: [...] } }` (`L:9807`).
- Content consumers: `C:284265-284276` merges all `inserts` of a batch and calls `stream({inserts})`; `C:300632-300638` (`Me`) concatenates `inserts.tweets` and filters those with `user_id_str === currentUserId`.

Because listener.js never inserts anything, this channel carries no traffic in this build. Direction is strictly page -> content script.

### 7.3 Router bridge (content/iframe -> page), the only live function of listener.js

`window.postMessage({ caller: "__x__", type: "push" | "replace", value: "<path>" }, "*")`:
- from the content script itself: `C:318537`
- from the sidebar iframe to its parent page: `C:274496`, `C:274869`, `C:298387` (`window.parent.postMessage(...)`, values like `t.replace("https://x.com", "")`)

listener.js (`L:9822-9837`) checks `origin === location.origin` and `data.caller === "__x__"` and calls `window.__xRouter.push(value)` / `.replace(value)`; fallback `location.href = value`. Since the iframe is an extension page, its origin would be `chrome-extension://...` and fail the origin check unless the iframe is same-origin; see Uncertainties.

### 7.4 Other same-window messages handled by the content script (`C:212671-212740`)

Request `{type: "AI_REPLY_DETECT_REQUEST" | "TWEET_SCORES_REQUEST" | "FETCH_USER_SCORES", requestId, payload}` -> proxied to SuperX `POST /tools/detect-ai-reply`, `/tweets/scores`, `/users/scores` with the bearer token -> reply `{type: "..._RESPONSE", requestId, success, data | error, errorDetails}`. Guarded by `e.source !== window`. This is the data path for the AI-reply badges rendered in the page.

### 7.5 DOM CustomEvents

`superx-refresh-data` (`C:300736`, `C:302367`, listened at `C:300819`) and `superx-set-period` (`C:302349`) coordinate UI refreshes after the backend re-scrapes.

### 7.6 How the content script queries the DB

It runs **its own Dexie instance** (`class h extends dbCore` at `C:330497`, exported as `XDatabase` and default singleton `C:330589-330591`). Content scripts share the origin's IndexedDB, so both worlds could open `XDatabase`, but only the content script does in practice. Reads seen: `tweets.where("user_id_str").equals(id).and(t => t.in_reply_to_screen_name === handle).reverse().sortBy("created_at")` and `tweets.toArray()`/`users.toArray()`/`users.where("id").anyOf(ids)` (`C:274876-274930`, the "your replies to this user" panel; note it also tries `where("id_str")`, an index that does not exist, and catches the error). No postMessage proxying of DB queries exists.

## 8. Network calls and cookies from listener.js

- **None.** `API_ENDPOINT = "https://api.superx.tools"` (`L:508`) is only a constant in the shared constants module; nothing in listener.js references it after definition. `getCookies` is defined (`L:330-340`) but has no caller in the listener bundle.
- In the content script, `document.cookie` is read only through `getCookies()` for `ct0` (CSRF) at `C:195394`, `C:279442`, `C:279484`.
- The SuperX API client (`C:210934+`, module 36410) sends `Authorization: Bearer <JWT>` from `localStorage["__superX__ak"]` (`C:266458`, `C:211286-211294`) to `https://api.superx.tools`. Data-relevant endpoints: `/pull/1.2/activity?start&end&uid` (the user's own tweets and `meta.last_recent_tweets`, `C:300743-300749`), `/pull/1/tracker`, `/pull/1.2/user`, `/pull/1/user?screen_name`, `/pull/1.2/tweet`, `/search`, `/search/1.1/i`, `/extension/auto-refresh` (`POST {targetUserId, targetUsername}`, `C:300728-300735`, debounced 500 ms, fires when the visited profile differs from the logged-in user and the viewer has a subscription), `/extension/refresh-data` (`POST {targetUserId, targetUsername, periodDays}`, `C:302351-302355`, returns `rate_limit_cooldown`/`rate_limit_daily` errors), `/migrate` (`POST`, `C:170296`), `/api/analytics/summary`, `/api/me/tweets*`.
- `stream()` (`C:170284-170294`) which used to be the upload hook for captured inserts is now a stub: it computes whether any insert array is non-empty and returns `Promise.resolve()` without sending. So in this build, **captured X data is not uploaded from the client via `stream`**; the backend obtains data on its own.

## 9. Active fetching / backfill and rate limiting

### 9.1 User queue (`queues` table) and the worker (module 37044, `C:212774-212852`)

- Enqueue: `queueUserToFetch({userId, screen_name}, {startFetching, priority})` (`C:330540-330551`): if a row exists, `hit += 1`; else `add({...e, hit: 1, created: Date.now(), priority})`; optionally `startFetchUserQueue()` (guarded by `this.started`).
- Trigger: Layout, after `/pull/1.2/activity` returns without `meta.last_recent_tweets`, marks the user (`stream({inserts:{users:[{...me, last_recent_tweets: Date.now()}]}})`, no-op) and enqueues the logged-in user with `priority: true` (`C:300760-300769`).
- Worker `d()` (`C:212793-212803`): if not running, `getCurrentUserQueue()` (`appProps.requestQueue` or the `queues` row with highest `hit`, which is then removed from the table and pinned into `appProps.requestQueue`, `C:330525-330534`), then `h(queue)`; finally `queueRefresh()`.
- `h(queue)` (`C:212806-212851`), one page per call:
  - if `queue.count > 5`: reset `count = 0` and **sleep 10 s** (`setTimeout(..., 1e4)`) before continuing (burst limiter: at most 6 consecutive pages per 10 s window).
  - reads `appProps.requestLog[RequestType.UserTweetsAndReplies].limit` and `getFetchLimit(limit, {minRemain: 30})` (`C:330568-330573`): `expired` = minutes until `X-Rate-Limit-Reset`, `limitReached = remain < 30 && expired > 1`; if reached, **sleep `expired * 10 s`** (`1e4 * n`) and retry (note: that is 10 s per minute remaining, not the full window).
  - fetches `UserTweets` via module 97026 (`C:329533`, variables `{userId, count: 20, includePromotedContent, withCommunity, withVoice, withV2Timeline, cursor}`), transform `transformUserTweetsAndReplies` (which, as noted, only collects `content.items[*]` module tweets; top-level entries are inserted by the transform's own `insertTweets` only if the path matches, so plain-timeline pages may store nothing, see Uncertainties).
  - stop conditions: `l.errors` -> return silently (queue stays pinned in appProps); zero cleaned tweets **or** newest tweet older than `f = Date.now() - 120 * SID` (120 days, `SID = 864e5` at `C:271213`) -> clear `requestQueue`, `u = false`, call `d()` to pick the next user.
  - otherwise persist `{...queue, cursor: l.data.cursor, count: count + 1}` and `requestLog[UserTweetsAndReplies].limit = l.limit`, and schedule the next page after **1 s**.
- `queueRefresh()` (`C:195545-195565`): for `appProps.currentUser`, unless a `lastRefresh` marker (module 19592) is newer than 3 days (`3 * SID`), fetches up to **5 pages** of `UserTweets` back-to-back (no delay) and updates `lastRefresh`. This is the periodic self-refresh of the logged-in user's recent tweets.

### 9.2 Other active fetches

- `getBestTweets` (`C:195299-195366`): paged `UserTweets` for the "best tweets" panel with guest token, returns `{tweets, users, cursor, limit}` or `{error, limit}`; the caller (`C:262110-262135`) streams inserts (no-op) and pages via cursor.
- `TweetDetail`, `SearchTimeline`, `ExplorePage`, `UserByScreenName`, `UsersByRestIds`, list endpoints: on demand from UI actions; every transform inserts into Dexie as a side effect, so browsing with the sidebar open steadily fills `tweets`/`users`.
- No proactive Followers/Following backfill exists client-side.

## 10. Reimplementation notes (clean-room)

- To reproduce SuperX's local data set you need: a Dexie (or raw IDB) DB `XDatabase` v110 with the five tables above; `cleanTweet`/`cleanUser` as described (store `legacy` fields + `view_count`, id = `rest_id`, `created_at` = epoch ms); active `UserTweets` paging with `ct0` CSRF from cookies, the public bearer, and `X-Rate-Limit-*` bookkeeping; optional `TweetDetail`/`SearchTimeline` parsers along the JSONPaths in section 3.3.
- A fully local build can drop everything in section 8 (no api.superx.tools) and needs no main-world script unless you want SPA navigation via the captured router, in which case the `Object.prototype.history` trick and the `__x__` message protocol are the exact contract.
- If you want passive capture (which SuperX does not do), you would add `fetch`/XHR patching in a main-world script and ship the JSON to the content script; the `DOMDataStream` protocol (`{inserts:{tweets,users}}` joined by `"\r\n\r\n"` in a hidden div, 1 s polling) is a working, if crude, channel already consumed on the content side.

## Uncertainties

1. **`appProps.requestDetails`** (`headers`, `userTweetsQueryId`, `cursor`) is read at `C:195279`, `C:195301`, `C:300625` but no writer exists in either bundle. It is presumably written by the background service worker (webRequest header capture) or the popup, which were not in scope. If it is never written, `getUserTweets` builds `/i/api/graphql/undefined/UserTweets`.
2. **Origin check in the router bridge**: `L:9825` requires `origin === location.origin`. Messages from `window.parent.postMessage` inside an extension iframe would carry a `chrome-extension://` origin and be rejected; the content-script path (`C:318537`, same window) passes. Whether the iframe is same-origin (e.g. `srcdoc` or blob) was not verified.
3. **`transformUserTweetsAndReplies` on `UserTweets` responses**: it only walks `timeline_v2...entries[*].content.items[*]...`. Current X responses use `timeline` (not `timeline_v2`) for `UserTweets` when `withV2Timeline` is absent, and put standalone tweets under `content.itemContent`. The backfill queue may therefore store far fewer tweets than intended, or none. Only runtime observation can confirm.
4. **Whether the listener's `dbCore` ever opens the DB in the page world**: Dexie opens lazily on first table access; since no insert runs in listener.js, it likely never opens. Not verified at runtime.
5. **Whether X data is uploaded to api.superx.tools** by any path other than the stubbed `stream()`: `/migrate` posts an unknown payload once (`C:170296`), and the AI-scoring proxies send tweet text/ids. A full audit of the payloads of all 80+ `.r()` endpoints was out of scope here.
6. **Server-side follower snapshot cadence** (dedupe per day, source) is not observable from client code.
7. The background script and manifest were not part of this task; any `webRequest`/`declarativeNetRequest` interception there would change conclusion 0 for the extension as a whole (but not for listener.js).
