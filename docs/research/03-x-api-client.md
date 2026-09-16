# 03. SuperX content script: direct X internal API client

Source analysed: `scratchpad/superx/js/content.pretty.js` (prettified webpack bundle of `js/content.js`, extension v0.8.6, MV3). Line numbers below refer to that file. Also checked: `manifest.json`, `js/listener.pretty.js`.

Convention: minified `!0` / `!1` are rendered as `true` / `false`. Objects are otherwise verbatim (key order preserved).

## 1. Architecture summary

- The extension is a single content script (`js/content.js`) injected on `https://x.com/*`, `https://twitter.com/*`, `https://pro.x.com/*`, `https://pro.twitter.com/*` at `document_end`. There is no background/service worker, no `webRequest`, no `cookies` permission, and no `host_permissions` in the manifest. Everything that touches X runs in the page's cookie jar with same-origin `fetch`.
- `js/listener.js` (web-accessible, injected via `<script src=chrome.runtime.getURL("js/listener.js")>`, content.pretty.js:212744-212747) is a page-world script for the "AI reply detector" and scoring overlays. It does NOT hook `window.fetch`/`XMLHttpRequest` and does not touch GraphQL (grep for `fetch(`, `XMLHttpRequest`, `graphql`, `csrf` in listener.pretty.js: 0 hits; the "transaction" hits are Dexie/IndexedDB). It talks to the content script with `window.postMessage` types `AI_REPLY_DETECT_REQUEST`, `TWEET_SCORES_REQUEST`, `FETCH_USER_SCORES` (212673-212700), which the content script proxies to SuperX's backend.
- Two X-API request wrappers exist:
  - Module `66083` (279364-279549): `default` (fetch-based) and `apiXHRRequest` (XHR-based). This is the client used by every GraphQL call site.
  - Module `24224`-neighbour at 195277-195470: `getUserTweets` / `generateQuery` / `getBestTweets`, an older/alternate path with its own header logic (guest-token capable).
- SuperX backend clients: module `36410` (210934+) `k.r(path, opts)` defaults to `host: "https://api.superx.tools"` and adds `Authorization: Bearer <SuperX JWT>` from `localStorage["__superX__ak"]` (211287, 266458). Many calls override `host: SCHEDULE_ENDPOINT` = `https://app.superx.so` (266460). The low-level helper is module `86637` (303667-303713): plain `fetch`, JSON body, no `credentials` option (so cookies for app.superx.so are sent per default `same-origin` policy, i.e. not sent cross-site; auth is via bearer header).

## 2. Header construction (X API)

### 2.1 Primary wrapper, module 66083 `default(path, opts)` (279407-279456)

```js
// defaults
headers      = t.commonHeaders          // see below
extraHeaders = undefined
includeCrsf  = true
method       = "get"
responseType = "json"
```

`commonHeaders` (279538-279544):

```js
{
  authorization: "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
  "x-twitter-client-language": "en",
  "x-twitter-active-user": "yes",
  "accept-language": "en",
}
```

Note the bearer is the standard public web-client bearer, but with the `=` URL-encoded as `%3D` (X accepts both). The `getBestTweets` path also has the raw `=` variant (195307).

Then (279433-279446):

- If a body exists: `content-type` = `application/x-www-form-urlencoded` if `FormData`, else `application/json`; body is `JSON.stringify(body)`.
- If `includeCrsf` (default true): reads `document.cookie` via `getCookies()` (module 15473, 182684-182691: splits `document.cookie` on `;`, decodes, tries `JSON.parse` on each value) and sets:
  - `x-csrf-token: <ct0 cookie>`
  - `X-Twitter-Auth-Type: OAuth2Session`
- URL is built by `formatURL({path, queries, includeProtocal:false})` (86637:303669-303683): relative path, so it goes to the current origin (`x.com`), each query value that is an object becomes `encodeURIComponent(JSON.stringify(v))`. So `variables`, `features`, `fieldToggles` are sent as URL-encoded JSON in the query string for GET.
- `fetch(url, { headers, method, body, ...restOpts })`. No explicit `credentials` option: the default for same-origin requests includes cookies, so `auth_token` (HttpOnly) and `ct0` are attached by the browser. The extension never reads `auth_token` or `twid` (0 grep hits for both).
- Response: `getLimitHeader(res.headers)` captures rate limit headers (see section 5); if `responseType === "json"` returns `{ data: transform ? transform(json) : json, limit }`, else `{ limit, data: response, headers }`.
- Errors: HTTP status is not checked. A non-2xx JSON body is passed through; callers inspect `.errors` (GraphQL) or `.error`.

Only cookie read: `ct0`. Cookies `auth_token`, `twid`, `kdt`, `gt` are never accessed.

### 2.2 `apiXHRRequest` (279458-279533)

Same header logic (bearer-only default `c` at 279546-279549, then `x-csrf-token`/`X-Twitter-Auth-Type` from `ct0`), but via `XMLHttpRequest` with `withCredentials = true`, optional `timeout`, optional manual CORS preflight (`OPTIONS` with `Origin` and `Access-Control-Request-Method`). Only exported once (279458); no call sites were found by grep, so it appears unused/legacy.

### 2.3 `generateQuery` / `getUserTweets` / `getBestTweets` (195277-195470)

- `getUserTweets` reads `requestDetails` from app props (`localStorage["__X_VISION__PROPS"]`, 330563-330567). `requestDetails` is expected to contain `{ headers: {...X's own request headers...}, userTweetsQueryId, cursor }`. Nothing in the content script or listener ever writes `requestDetails` (only 5 read sites: 195279, 195281, 195301, 195382, 300625). This is a vestige of an earlier design where captured X request headers/queryIds were stored; today it is effectively always `undefined`, so `getUserTweets` would build `/i/api/graphql/undefined/UserTweets`. It has no callers (`getUserTweets` appears once, the definition). Dead code.
- `generateQuery` (195370-195420): copies `requestDetails.headers` minus `x-csrf-token`, then sets `x-csrf-token: cookies.ct0 || captured`. Full URL `https://${twitterDomain}${basePath}` where `twitterDomain = document.location.host` (215821).
- `getBestTweets` (195299-195362), called from the "best tweets" panel (262114): 
  1. If no guest token cached, `POST https://api.twitter.com/1.1/guest/activate.json` with `Authorization: Bearer <public bearer, raw '='>` (195303-195312), stores `guest_token` (module-level `m`, and `updateAppProps({ xGuessToken })`).
  2. `GET https://<host>/i/api/graphql/p9sOCF1tLh4KfPWtt4TNGQ/UserTweets` with headers:
     ```js
     {
       "content-type": "application/json",
       authorization: requestDetails.headers.authorization || "Bearer AAAA...%3D1Zv7...",
       "x-twitter-client-language": "en",
       "x-twitter-active-user": "yes",
       "x-csrf-token": requestDetails.headers["x-csrf-token"],     // undefined in practice
       "x-guest-token": <guest token>,
       "x-client-transaction-id": requestDetails.headers["x-client-transaction-id"]
         || "15AvHJ/3fvW8WchPnE2dAlHK67woDumOtqAsJAuw4RowGoI4b6skdPFo4VIBjlmQmdYl3NVuqb9YPuPOg9Usctdb1GqI1A",
     }
     ```
     This is the only place `x-client-transaction-id` appears (195334-195336). It is NOT computed; it is a single hardcoded constant fallback. Sending `x-guest-token` alongside session cookies on `x.com` is a mixed-auth request; success is doubtful (see Uncertainties). Cross-origin `api.twitter.com/1.1/guest/activate.json` from an `x.com` content script relies on X's CORS, which historically allows it for the guest-activate endpoint.

### 2.4 Headers NOT set anywhere

- `x-twitter-auth-type` lowercase variant: the wrapper uses `X-Twitter-Auth-Type` (case-insensitive over HTTP, same header). 
- `x-client-transaction-id`: not computed; not sent on any authenticated call from module 66083. X currently tolerates its absence for most read endpoints from a logged-in session but this is the main fragility for anti-bot enforcement.
- `x-xp-forwarded-for` / XPFF: not present.
- `x-client-uuid`, `x-twitter-client-version`: not present.

## 3. GraphQL operations (queryId, method, variables, features, pagination)

Shared feature sets (defined once here, referenced below):

**FEATURES_A** (used verbatim by UserTweets@40377, TweetDetail, SearchTimeline):

```json
{
  "rweb_video_screen_enabled": false,
  "profile_label_improvements_pcf_label_in_post_enabled": true,
  "rweb_tipjar_consumption_enabled": true,
  "verified_phone_label_enabled": false,
  "creator_subscriptions_tweet_preview_api_enabled": true,
  "responsive_web_graphql_timeline_navigation_enabled": true,
  "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
  "premium_content_api_read_enabled": false,
  "communities_web_enable_tweet_community_results_fetch": true,
  "c9s_tweet_anatomy_moderator_badge_enabled": true,
  "responsive_web_grok_analyze_button_fetch_trends_enabled": false,
  "responsive_web_grok_analyze_post_followups_enabled": true,
  "responsive_web_jetfuel_frame": false,
  "responsive_web_grok_share_attachment_enabled": true,
  "articles_preview_enabled": true,
  "responsive_web_edit_tweet_api_enabled": true,
  "graphql_is_translatable_rweb_tweet_is_translatable_enabled": true,
  "view_counts_everywhere_api_enabled": true,
  "longform_notetweets_consumption_enabled": true,
  "responsive_web_twitter_article_tweet_consumption_enabled": true,
  "tweet_awards_web_tipping_enabled": false,
  "responsive_web_grok_show_grok_translated_post": false,
  "responsive_web_grok_analysis_button_from_backend": true,
  "creator_subscriptions_quote_tweet_preview_enabled": false,
  "freedom_of_speech_not_reach_fetch_enabled": true,
  "standardized_nudges_misinfo": true,
  "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
  "longform_notetweets_rich_text_read_enabled": true,
  "longform_notetweets_inline_media_enabled": true,
  "responsive_web_grok_image_annotation_enabled": true,
  "responsive_web_enhance_cards_enabled": false
}
```

**FEATURES_A2** = FEATURES_A plus `"responsive_web_graphql_exclude_directive_enabled": true` (inserted after `rweb_tipjar_consumption_enabled`) and `"rweb_video_timestamps_enabled": true` (inserted after `tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled`). Used by UserTweets@97026 (329533) and by `getBestTweets` (`v`, 195425-195468) and `getUserTweets` (`g`, 195469-195502).

**FEATURES_MIN** (list mutations, ListByRestId, UsersByRestIds):

```json
{
  "rweb_tipjar_consumption_enabled": true,
  "responsive_web_graphql_exclude_directive_enabled": true,
  "verified_phone_label_enabled": false,
  "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
  "responsive_web_graphql_timeline_navigation_enabled": true
}
```

**FEATURES_LIST_TL** (ListsManagementPageTimeline, ListMembers, ListLatestTweetsTimeline, ListEditRecommendedUsers):

```json
{
  "rweb_tipjar_consumption_enabled": true,
  "responsive_web_graphql_exclude_directive_enabled": true,
  "verified_phone_label_enabled": false,
  "creator_subscriptions_tweet_preview_api_enabled": true,
  "responsive_web_graphql_timeline_navigation_enabled": true,
  "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
  "communities_web_enable_tweet_community_results_fetch": true,
  "c9s_tweet_anatomy_moderator_badge_enabled": true,
  "articles_preview_enabled": true,
  "tweetypie_unmention_optimization_enabled": true,
  "responsive_web_edit_tweet_api_enabled": true,
  "graphql_is_translatable_rweb_tweet_is_translatable_enabled": true,
  "view_counts_everywhere_api_enabled": true,
  "longform_notetweets_consumption_enabled": true,
  "responsive_web_twitter_article_tweet_consumption_enabled": true,
  "tweet_awards_web_tipping_enabled": false,
  "creator_subscriptions_quote_tweet_preview_enabled": false,
  "freedom_of_speech_not_reach_fetch_enabled": true,
  "standardized_nudges_misinfo": true,
  "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
  "rweb_video_timestamps_enabled": true,
  "longform_notetweets_rich_text_read_enabled": true,
  "longform_notetweets_inline_media_enabled": true,
  "responsive_web_enhance_cards_enabled": false
}
```

All GET requests below go to `/i/api/graphql/<queryId>/<OpName>?variables=<urlenc JSON>&features=<urlenc JSON>[&fieldToggles=<urlenc JSON>]`. All POST requests send `content-type: application/json` with the JSON body shown.

### 3.1 UserTweets, queryId `p9sOCF1tLh4KfPWtt4TNGQ` (three call sites)

(a) Module 40377, line 218944. GET. Used by the background "request queue" refresh (module 37044, 212790-212845) and `queueRefresh` (195546-195560).

```json
variables: {
  "userId": "<userId>",
  "cursor": "<cursor|undefined>",
  "count": 20,
  "includePromotedContent": true,
  "withQuickPromoteEligibilityTweetFields": true,
  "withVoice": true
}
features: FEATURES_A
fieldToggles: { "withArticlePlainText": false }
```

Pagination (218993-219020): tweets from `$.data.user.result.timeline.timeline.instructions[*]` (`entry`/`entries[*]`, `content.itemContent.tweet_results.result` and `content.items[*].item.itemContent.tweet_results.result`, plus `.legacy.retweeted_status_result.result`); cursor = `.content.value` of the LAST entry (`.pop()`), i.e. it assumes the bottom cursor is the last entry. Note this transform reads `timeline.timeline` (not `timeline_v2`).

(b) Module 97026, line 329533. GET. Used by the request-queue worker `h()` (212829-212830).

```json
variables: {
  "userId": "<userId>",
  "count": 20,
  "includePromotedContent": true,
  "withCommunity": true,
  "withVoice": true,
  "withV2Timeline": true,
  "cursor": "<cursor|undefined>"
}
features: FEATURES_A2
```

Transform `transformUserTweetsAndReplies` (265121-265138): reads `$.data.user.result.timeline_v2.timeline.instructions[*].entries[*].content.items[*].item.itemContent.tweet_results.result` (conversation modules only) and cursor = last entry `.content.value`.

(c) `getBestTweets` (195299-195362), GET with guest token. `variables = { count: 20 } + { count:20, includePromotedContent:true, withQuickPromoteEligibilityTweetFields:true, withVoice:true, withV2Timeline:true } + caller {userId, cursor}`, `features: FEATURES_A2`, `fieldToggles: {withArticlePlainText:false}`. Transform `transformUserTweetsData` (265170-265186): `timeline_v2 ... entries[*].content.itemContent.tweet_results.result`, cursor = last entry `.content.value`.

### 3.2 UserByScreenName, queryId `xWw45l6nX7DP2FKRyePXSw` (298583, module 82209). GET.

```json
variables: { "withSafetyModeUserFields": true, "screen_name": "<handle>" }
fieldToggles: { "withAuxiliaryUserLabels": true }
features: {
  "hidden_profile_subscriptions_enabled": true,
  "profile_label_improvements_pcf_label_in_post_enabled": true,
  "rweb_tipjar_consumption_enabled": true,
  "verified_phone_label_enabled": false,
  "subscriptions_verification_info_is_identity_verified_enabled": true,
  "subscriptions_verification_info_verified_since_enabled": true,
  "highlights_tweets_tab_ui_enabled": true,
  "responsive_web_twitter_article_notes_tab_enabled": true,
  "subscriptions_feature_can_gift_premium": true,
  "creator_subscriptions_tweet_preview_api_enabled": true,
  "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
  "responsive_web_graphql_timeline_navigation_enabled": true
}
```

Result: `$.data.user.result`. No pagination.

### 3.3 UsersByRestIds, queryId `hiTzPd4vKNScu8qzxdjM4g` (183266, module 15828). GET.

`variables` = caller-supplied object (expected `{ userIds: [...] }`), `features: FEATURES_MIN`. Result `$.data.users[*].result`. Throws joined `errors[].message` on GraphQL errors. The transform (224306-224310) also extracts the queryId back out of a `fullpath` string (`substring(15, ...)` i.e. after `/i/api/graphql/`), which is another remnant of the old "capture X's own request URL" design; the caller passes `fullpath: "/"` so it yields garbage and is unused.

### 3.4 TweetDetail, queryId `ghg6dnwG8DCin2Fr4ik6QQ` (195615, module 24189). GET.

```json
variables: {
  "referrer": "me",
  "with_rux_injections": false,
  "rankingMode": "Relevance",
  "includePromotedContent": true,
  "withCommunity": true,
  "withQuickPromoteEligibilityTweetFields": true,
  "withBirdwatchNotes": true,
  "withVoice": true,
  "focalTweetId": "<tweetId>"
}
features: FEATURES_A
fieldToggles: {
  "withArticleRichContentState": true,
  "withArticlePlainText": false,
  "withGrokAnalyze": false,
  "withDisallowedReplyControls": false
}
```

Transform `transfromTweetDetail` (265173-265199): tries both `threaded_conversation_with_injections_v2` and `threaded_conversation_with_injections`; cursor = last entry `.content.value`. The caller does not paginate.

### 3.5 SearchTimeline, queryId `fDwnkykAJtODs46h_XZfVg` (280137, module ~67065). GET.

Query string built at 280115-280130: `[query, from:X, to:Y, min_faves:N, since:YYYY-MM-DD, until:YYYY-MM-DD, (from:a OR from:b), -filter:links, -filter:replies]` joined by spaces.

```json
variables: {
  "rawQuery": "<built query>",
  "cursor": "<cursor|undefined>",
  "count": 20,
  "querySource": "typed_query",
  ...callerVariables,
  "product": "Top" | "Latest" | "People" | "Media" | "Lists"
}
features: FEATURES_A
```

`searchType` map (280248-280256): `user→People, tweet→Top, top→Top, new→Latest, latest→Latest, media→Media, list→Lists`.

Transform `transformSearchTimelineData` (265113-265120): tweets from `search_by_raw_query.search_timeline.timeline.instructions[*].entries[*]` (item and module forms; unwraps `e.tweet || e` for TweetWithVisibilityResults); users from `.core.user_results.result`, or `content.itemContent.user_results.result` for People search; cursor = last `.content.value` (also checks `instructions[*].entry.content.value` for replace-entry instructions).

Fallback (280178-280194): if GraphQL returns `errors` or no data, it calls the SuperX backend `GET https://api.superx.tools/search?from&to&min_likes&query&type&page&start` instead.

### 3.6 ExplorePage, queryId `9yX4NI33DnsXBZ-UJ7ZwtA` (232200, module 47138). GET.

```json
variables: { "cursor": "<cursor|''>" }
features: {
  "rweb_tipjar_consumption_enabled": true,
  "responsive_web_graphql_exclude_directive_enabled": true,
  "verified_phone_label_enabled": false,
  "responsive_web_graphql_timeline_navigation_enabled": true,
  "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
  "creator_subscriptions_tweet_preview_api_enabled": true,
  "communities_web_enable_tweet_community_results_fetch": true,
  "c9s_tweet_anatomy_moderator_badge_enabled": true,
  "articles_preview_enabled": true,
  "responsive_web_edit_tweet_api_enabled": true,
  "graphql_is_translatable_rweb_tweet_is_translatable_enabled": true,
  "view_counts_everywhere_api_enabled": true,
  "longform_notetweets_consumption_enabled": true,
  "responsive_web_twitter_article_tweet_consumption_enabled": true,
  "tweet_awards_web_tipping_enabled": false,
  "creator_subscriptions_quote_tweet_preview_enabled": false,
  "freedom_of_speech_not_reach_fetch_enabled": true,
  "standardized_nudges_misinfo": true,
  "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
  "rweb_video_timestamps_enabled": true,
  "longform_notetweets_rich_text_read_enabled": true,
  "longform_notetweets_inline_media_enabled": true,
  "responsive_web_enhance_cards_enabled": false
}
```

Transform `transformExploreTweets` at 319752 (not read in depth).

### 3.7 Lists (module at 233255-233600; object `y` exported as the list API)

| Op | queryId | Method | variables | features | Result path / cursor |
|---|---|---|---|---|---|
| CreateList | `P51ZB9632Fy0Cv3LdqMNwg` (233270) | POST body `{variables, features, queryId}` | `{ "isPrivate": false, "name": "<name>", "description": "SuperX created list" }` (defaults; name default `"XList"`) | FEATURES_MIN | `$.data.list` |
| ListAddMember | `FpvDMFk4k8HXtkYjQGg_bw` (233287) | POST | `{ "listId": "<id>", "userId": "<id>" }` | FEATURES_MIN | `data` |
| ListByRestId | `ZMQOSpxDo0cP5Cdt8MgEVA` (233404) | GET | `{ "listId": "<id>" }` | FEATURES_MIN | `$.data.list`, owner `$.data.list.user_results.result` |
| UpdateList | `bYkQRsxcmEm_YSpiMusY2g` (233419) | POST | `{ "listId": "<id>", ...patch }` (name/description/isPrivate) | FEATURES_MIN | `$.data.list` |
| ListsManagementPageTimeline | `zA6TKM6kv5YKudrFKyMalQ` (233437) | GET | `{ "count": 100 }` (default) | FEATURES_LIST_TL | lists: `$.data.viewer.list_management_timeline.timeline.instructions[*].entries[*].content.items[*].item.itemContent.list`; cursor: last `entries[*].content.value` (caller does not paginate) |
| ListMembers | `-5OaAZ4pICdvoQhPJXsCvg` (233471) | GET | `{ "listId": "<id>", "count": 20 }` | FEATURES_LIST_TL | `$.data.list.members_timeline.timeline.instructions[*].entries[*].content.itemContent.user_results.result`; NO cursor handling (only first 20) |
| ListRemoveMember | `q1fNhjkWDJWoHTtsToP0CQ` (233506) | POST | `{ "listId": "<id>", "userId": "<id>" }` | FEATURES_MIN | `data` |
| ListLatestTweetsTimeline | `5ge3ZlLe_8IDfG1Bx-S9lA` (233523) | GET | `{ "listId": "<id>", "count": 20, "cursor": "<cursor|undefined>" }` | FEATURES_LIST_TL | tweets `$.data.list.tweets_timeline.timeline.instructions[*].entries[*]...tweet_results.result` (item + module); cursor = last entry `.content.value` |
| DeleteList | `UnN9Th1BDbeLjpgjGSpL3Q` (233557) | POST body `{variables:{listId}, queryId}` (no features) | `{ "listId": "<id>" }` | none | `data` |
| ListEditRecommendedUsers | `cFO-S3tSC54Nm3DJDSoSMA` (233577) | GET | `{ "listId": "<id>", "count": 20, "cursor": "<cursor|undefined>" }` | FEATURES_LIST_TL | `$.data.list.recommended_users.timeline.instructions[*].entries[*].content.itemContent.user_results.result`; cursor = last `.content.value` |

`createDefaultList` (233395-233403) creates list `"XList"` then serially `ListAddMember` for every id in `appProps.timelineUserIds` with no delay.

### 3.8 Engagement mutations (POST, body `{ queryId, variables: { tweet_id } }`, no `features`)

| Op | queryId | Line |
|---|---|---|
| FavoriteTweet | `lI07N6Otwv1PhnEgXILM7A` | 304188 |
| UnfavoriteTweet | `ZYKSe-w7KEslx3JhSIk5LA` | 304193 |
| CreateRetweet | `ojPdsZsimiJrUGLR1sjUtA` | 210728 |
| DeleteRetweet | `iQtK4dl5hBmXewYZuEOKVw` | 210733 |
| CreateBookmark | `aoDbu3RHznuiSkQ9aNM67Q` | 196568 |
| DeleteBookmark | `Wlmlj2-xzyS1GN3a6cj-mQ` | 196573 |

Exact body, e.g. `{"queryId":"lI07N6Otwv1PhnEgXILM7A","variables":{"tweet_id":"<id>"}}` with the module-66083 headers (bearer, ct0 csrf, `X-Twitter-Auth-Type: OAuth2Session`, `content-type: application/json`).

### 3.9 REST (v1.1)

- `GET /i/api/1.1/search/typeahead.json?include_ext_is_blue_verified=1&include_ext_verified_type=1&include_ext_profile_image_shape=1&q=<q>&src=search_box&result_type=users` (168713, module 6780), supports `AbortSignal`.
- `POST https://api.twitter.com/1.1/guest/activate.json` (195303), guest token for `getBestTweets`.
- `transformMentions` (265139-265167) parses the legacy `globalObjects`/`timeline.instructions[*].addEntries` shape (`/2/notifications/mentions.json`), but no call site for that endpoint exists in this bundle (0 hits for `mentions.json`). Legacy.

### 3.10 Operations NOT present in the bundle (0 grep hits)

CreateTweet, CreateNoteTweet, DeleteTweet, Followers, Following, HomeTimeline, NotificationsTimeline, UserMedia, Likes, Bookmarks timeline, friendships/create|destroy, DM endpoints (`dm/`, `direct_messages`), `media/upload`, `upload.twitter.com`. The `RequestType` enum (173677-173687) lists `UserTweetsAndReplies, Mentions, UsersByRestIds, Followers, Following, UsersByScreenName, CreateTweets, Search, ExplorePage` but only `UserTweetsAndReplies` is used as a key (212820, 212839). Followers/Following/CreateTweets are enum residue.

## 4. queryIds: hardcoded vs discovered

**Hardcoded.** Every queryId is a string literal in the bundle (section 3). There is no scraping of X's `main.*.js`/`client-web` bundles (0 hits for `main.js`, `client-web`), no fetch/XHR interception in either script, no `webRequest` permission, and no remote config of queryIds from SuperX's backend visible in the content script. Two vestiges show it once did capture X's own requests: `requestDetails.userTweetsQueryId` (195293) and the `fullpath.substring(15, ...)` queryId extraction (224310), both effectively dead now.

Consequence: when X rotates a queryId, the corresponding SuperX feature breaks until a new extension version ships (the bundle carries `appVersion: 2024052301` as the props default; the current X queryIds embedded here are consistent with mid-2025 web client builds). The SearchTimeline path is the only one with a fallback (SuperX backend `/search`).

For a clean-room reimplementation: either keep a small updatable table of `{opName: queryId}` in storage refreshed from a source you control, or discover them at runtime by fetching `https://abs.twimg.com/responsive-web/client-web/main.<hash>.js` (hash discoverable from `x.com` HTML) and regex-scanning `queryId:"...",operationName:"..."`. SuperX does neither.

## 5. Rate-limit and error handling

### 5.1 X rate-limit headers

`getLimitHeader(headers)` (265201-265213): reads `X-Rate-Limit-Limit`→`total`, `X-Rate-Limit-Remaining`→`remain`, `X-Rate-Limit-Reset`→`reset` (epoch seconds, string). Returned alongside every response as `limit`. Same triplet extraction is duplicated in `generateQuery` and `getBestTweets` (195341-195345, 195400-195404). `saveLimitHeaders` stores it into `appProps.limit` (265168-265170).

`XDatabase.getFetchLimit(limit, {minRemain=10})` (330569-330574): `expired` = minutes until reset = `(reset*1000 - now)/60000`; `limitReached = remain < minRemain && expired > 1`. Used by:
- Settings UI (203023) to show a "limit reached" state.
- Request-queue worker (212819-212828) with `minRemain: 30`: if reached, `setTimeout(retry, 10000 * expiredMinutes)`.

The UI also short-circuits when `limit.remain < 5` (300626: `we = (re && re.remain < 5) || ae > 1`).

### 5.2 Throttling / queueing

Module 37044 (212790-212845), the timeline backfill queue for `UserTweets`:
- Single in-flight flag `u`; pulls `getCurrentUserQueue()` from IndexedDB.
- After each page: `setTimeout(next, 1000)` (1 s between pages).
- Every 6 pages (`count > 5`): reset count and wait 10 s.
- Stops when a page is empty or the newest tweet in the page is older than `now - 120 * SID` (120 days), or on GraphQL `errors` (silent `return`, no retry).
- `queueRefresh` (195546-195561): at most 5 pages, only if `lastRefresh` older than 3 days (`3 * SID`).
- `createDefaultList` adds members serially, no delay.
- No generic token bucket, no jitter, no concurrency limiter for the on-demand calls (search, list ops, like/RT).

### 5.3 HTTP errors and 429

- Module 66083 never inspects `response.status`. A 429 from X with a JSON body just flows to the caller as `data`; callers check `data.errors` (GraphQL) and typically surface `errors[0].message` or fall back to the SuperX backend (search). There is no explicit 429 branch for X calls, and no exponential backoff for X. The `retry-after`/exponential backoff code at 251892-251931 belongs to a bundled third-party client (Deepgram/AI SDK), and the 429 handlers at 174918 and 260477 target SuperX backend endpoints (`/api/communities/search`, `/deepgram/token`).
- `isUnreadableFetchError(e)` (287693) is simply `e instanceof TypeError`. All the "The request was blocked from x.com ..." toasts (974, 163654, 181288, 208430, 208458, 226370, 264852, 288497, 297395) are shown when a `fetch` to the SuperX backend (`app.superx.so`/`api.superx.tools`) throws a TypeError (network/CORS failure, e.g. a 4xx without CORS headers). The message text is misleading: it is not a detection of X blocking anything; it is the extension's cross-origin call to SuperX failing from the `x.com` origin.

### 5.4 SuperX-side rate limit (posting quota)

`fetchRateLimit()` (52284: 257850-257858) = `fetch("https://app.superx.so/api/rate-limit", {headers})`, base set via `setRateLimitBase(SCHEDULE_ENDPOINT)` (174715, 197931, 225838). Polled every 60 s and after compose events (233050-233090). Response `{ currentUsage, limit, warning, percentageUsed }`; the composer warns at >= 95% with the text "X/Twitter allows only 100 tweets per 24 hours per account" (203956-203975). This quota is tracked server-side by SuperX, not read from X.

## 6. Write actions: client-side X API vs SuperX backend

| Action | Path | Where |
|---|---|---|
| Like / Unlike | Client-side X GraphQL `FavoriteTweet` / `UnfavoriteTweet` | 304188-304195 |
| Retweet / Unretweet (manual) | Client-side X GraphQL `CreateRetweet` / `DeleteRetweet` | 210728-210735 |
| Bookmark / Unbookmark | Client-side X GraphQL `CreateBookmark` / `DeleteBookmark` | 196568-196575 |
| Create / Update / Delete list, add / remove member | Client-side X GraphQL (section 3.7) | 233270-233560 |
| Read timelines (UserTweets, TweetDetail, Search, Explore, List TL, ListMembers, UserByScreenName, UsersByRestIds, typeahead) | Client-side X GraphQL / REST | section 3 |
| Search fallback | SuperX backend `GET api.superx.tools/search` when GraphQL fails | 280178-280194 |
| Post tweet now | SuperX backend `POST https://app.superx.so/api/me/tweets` with `status: 0` (TweetStatus.Draft=0, Scheduled=1, Sent=2, Error=3, Idea=22, Finalized=23 at 210914-210919), `time: now` | 182657 (`putTweet`), 204048-204100 (`__handleSubmit`), 174024, 215223 |
| Schedule tweet / thread | SuperX backend `POST app.superx.so/api/me/tweets` with `{ id: nanoid(), time: ISO, status: 1, details: [{id, text, media, quoteTweet...}], autoRetweet, autoPlug, autoDelete, autoDM, superFollowersOnly, enablePostingBsky, shareWithFollowers }` | 264810-264815, 297360, 203830-203845 |
| Reschedule / unschedule / unlink chained quote | SuperX backend `/api/me/tweets` (status 0 to unschedule), `DELETE /api/me/tweets/:id/chain-from` | 174015-174028, 297049 |
| Delete tweet on X | Not done client-side (no `DeleteTweet`). Auto-delete is a server job | see below |
| Auto Retweet & Plug | Server-side. The composer only stores `autoRetweet: { retweets: [{afterH}], cleanAfterH }` and `autoPlug: { threshold, ... }` inside the scheduled post payload (173905-173917, 180768-180830 defaults `autoRetweetAfterH: 8`, `autoRetweetCleanAfterH: 4`, `autoDeleteAfterH: 4`, `autoDeleteThreshold: 1000`, `autoDMMaxDMs: 100`). No client timers, no `CreateRetweet` scheduling in the content script (the only `setTimeout`s around RT are UI). Executed by SuperX backend using the OAuth grant obtained via `app.superx.so/auth/twitter/v2/add-account` (267146) | 200440-200620 |
| Auto Delete posts | Server-side, same payload (`autoDelete: { afterH, threshold }`) | 200452-200456 |
| Auto DM | Server-side (`autoDM: { enabled, maxDMs, ... }`), status/quota from `GET app.superx.so/api/autodm/status` | 349, 304320 |
| Reply from Engage panel | SuperX backend `POST api.superx.tools/api/engage/reply {tweetId, replyText, media: []}` | 262351-262355, 198035-198055 |
| Follow / Unfollow | Not implemented via API. Only a DOM selector for X's follow button (214978) | |
| Bluesky cross-post | Server-side (see section 8) | |
| AI reply detection / tweet scores / user scores | SuperX backend `POST /tools/detect-ai-reply`, `/tweets/scores`, `/users/scores` (bearer required) | 212685-212695 |
| Contacts / lists export / communities | SuperX backend `app.superx.so/api/contacts/*`, `/api/communities/search` | 174812, 194892, 208524 |

Takeaway for the reimplementation: SuperX only uses the in-browser X session for reads plus a handful of idempotent engagement toggles and list management. All content creation (post, schedule, reply, delete, auto-RT, plug, DM, Bluesky) goes through SuperX's servers with a separately granted X OAuth 2.0 token.

## 7. Media upload

No `upload.twitter.com` / `1.1/media/upload.json` usage (0 hits). Media for posts is uploaded to SuperX storage (module at 301855-302020, `uploadMedia`):

1. `POST api.superx.tools/api/uploads` `{ filename, fileType, size }` (20 s timeout) -> `{ preSignedUrl, url, objectKey, filename, fileType, isVideo, size }`.
2. `XMLHttpRequest PUT <preSignedUrl>` with `Content-Type: <fileType>`, progress events, 45 s stall timeout.
3. `POST api.superx.tools/api/uploads/verify` `{ objectKey, expectedSize, uploadId }` -> `{ verified: true }`.
4. The post `details[].media[]` then carries `{ url, objectKey, filename, fileType, isVideo, size }` (264795-264803); the backend uploads to X at publish time.
5. Deletion: `POST /api/uploads/delete-object` (205777, 234364-234485). Image proxy for canvas exports: `GET app.superx.so/api/media/proxy?url=` (183142).

## 8. Bluesky

- Connect flow (200490-200510 and duplicate at 226680-226700): a form with hidden `service` defaulting to `https://bsky.social`, `identifier` (placeholder `john.bsky.social`), `password` (linked to `https://bsky.app/settings/app-passwords`, i.e. an app password). Submitted as `POST api.superx.tools/api/auth/bsky/connect { service, identifier, password }`. On `{success:true}` the client sets `connectedToBsky: true` and `enablePostingBsky/enablePostingBluesky: true`.
- The extension never calls `com.atproto.server.createSession` or any `bsky.social` XRPC (0 hits for `atproto`/`createSession`). Credentials are sent once to SuperX's server, which stores the session/app password and cross-posts server-side. Per post, only the boolean `enablePostingBsky` travels in the `/api/me/tweets` payload (203839, 204851), and `M({ x: $, bluesky: G })` (201226) submits per-network text variants.

## 9. Auth to SuperX backend (context for the table)

- Token: JWT in `localStorage["__superX__ak"]` (`{ token, user, ... }`), added as `Authorization: Bearer` by `36410.r()` (211911-211915). `includeToken: "strict"` rejects when absent.
- Session bootstrap `GET api.superx.tools/auth/me` (`APIEndpoints.authInitiate`, 266457); account linking through `app.superx.so/auth/twitter/v2/add-account?token=` (267146); `POST /api/auth/switch-account` swaps the JWT (211380-211398) and clears `__X_VISION__PROPS`.
- `getViewingUid()` decodes the JWT `uid` (211331-211337). Some requests add a `user_uid` header (233050-233052).

## 10. Reimplementation notes (what to copy, what to change)

- Copy: header set from section 2.1 (bearer, `x-csrf-token` = `ct0`, `X-Twitter-Auth-Type: OAuth2Session`, `x-twitter-active-user: yes`, `x-twitter-client-language: en`), same-origin fetch with cookies, GET with URL-encoded JSON `variables`/`features`/`fieldToggles`, POST JSON `{queryId, variables[, features]}` for mutations, and the FEATURES objects above (they are what the current X web client sends, so they minimize `features` validation errors).
- Add: `x-client-transaction-id` generation (SuperX does not do it, and X increasingly 404s/403s GraphQL calls that lack it), a runtime queryId discovery/refresh mechanism, honest 429 handling using `X-Rate-Limit-Reset`, and bottom-cursor detection by `cursorType === "Bottom"` instead of "last entry" (SuperX's `.pop()` heuristic can return the Top cursor when X reorders entries).
- Drop: the guest-token path (mixed auth, hardcoded transaction id) and the `requestDetails` machinery (dead).

## Uncertainties

1. `requestDetails` (headers, `userTweetsQueryId`, `x-client-transaction-id`) is read but never written in `content.pretty.js` or `listener.pretty.js`. I did not disassemble `content.js` (minified) beyond confirming the same 2 hits, so I cannot fully exclude that a prior version's data persists in users' `localStorage["__X_VISION__PROPS"]`; in a fresh install it is `undefined`.
2. Whether `getBestTweets` (guest token + session cookies + static `x-client-transaction-id`) actually succeeds against current X was not tested; X may reject `x-guest-token` on an authenticated `x.com` origin, in which case the panel falls back to locally cached tweets (262117-262122).
3. Whether X currently enforces `x-client-transaction-id` for the GraphQL reads used here (UserTweets, SearchTimeline, TweetDetail, lists) was not verified live; SuperX's calls would break under enforcement.
4. `transformExploreTweets` (319752) and the ExplorePage response paths were not read; only variables/features are documented.
5. The bundle contains no `Followers`/`Following` GraphQL calls, but the `RequestType` enum and "Followers" UI labels exist; follower analytics likely come from SuperX's backend (`/api/contacts/*`) or from the SuperX OAuth-side crawler, not confirmed here.
6. The exact server behaviour of auto-retweet/auto-plug/auto-delete/auto-DM (timing, which token) is inferred from the payload shape and the absence of client timers; it is not observable in this bundle.
7. `TweetStatus` numeric mapping (`Draft=0` used as "post now"/"unschedule") is inferred from `__handleSubmit` (`status || Scheduled`, `time: now` when none) and the cascade-unschedule path (174024); the server's interpretation of `status: 0` with a past/now `time` (immediate publish vs draft) was not verified.
