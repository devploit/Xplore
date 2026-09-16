# SuperX extension (v0.8.6): backend dependencies and data-exfiltration map

Source: `scratchpad/superx/js/content.pretty.js` (content script, 332k lines) and `scratchpad/superx/js/listener.pretty.js` (page-context script, 10k lines). Line numbers below refer to `content.pretty.js` unless prefixed with `listener:`. Read-only analysis; nothing outside `reports/` was modified.

## 0. Architecture in one paragraph

The extension is a single MV3 content script injected on `x.com` / `twitter.com` / `pro.x.com` (`manifest.json`: no background worker, no `permissions`, no `host_permissions`, no `cookies` permission; only `web_accessible_resources` for `js/listener.js` and images). `listener.js` is injected into the page context (line 212755: `s.src = chrome.runtime.getURL("js/listener.js")`) and only does three things: exposes X's React router (`window.__xRouter`, listener:9812-9838), hosts a DOM-text data channel (listener:81165), and ships GraphQL response transformers plus a Dexie `XDatabase` (listener:7935). It contains no network calls (the only URL literals are the `API_ENDPOINT` constant at listener:508 and two error-doc links). The content script talks to two SuperX hosts (`https://api.superx.tools`, `https://app.superx.so`) with a Bearer JWT, and to X's own `/i/api/graphql` endpoints with the user's `ct0` cookie. The big surprise for a local reimplementation: the analytics timeline itself (tweets for the charts, best/worst posts, follower tracker) is **downloaded from the SuperX backend** (`/pull/1.2/activity`, `/pull/1/tracker`), not computed from X data captured in the browser. The client-side X capture pipeline still exists but its sink is a no-op (section 5.1).

## 1. Request wrappers and hosts

| Symbol | Line | Value / behaviour |
|---|---|---|
| `t.API_ENDPOINT`, `t.authHost`, `t.NEXT_PUBLIC_API_ENDPOINT` | 266459-266463 | `"https://api.superx.tools"` |
| `t.SCHEDULE_ENDPOINT` | 266460 | `"https://app.superx.so"`; `SCHEDULE_API_ENDPOINT = ${SCHEDULE_ENDPOINT}/api` |
| `t.APIEndpoints.authInitiate` | 266457 | `"/auth/me"` |
| `t.authKey` | 266458, 298852 | `"__superX__ak"` (localStorage key holding the JWT + user) |
| Auth client `k.r(path, opts)` | 211049-211073 | Adds `Authorization: Bearer ${this.__token}` if a token exists; `includeToken: "strict"` rejects when no token (never used, `grep -c 'includeToken: "strict"'` = 0). Default `host: "https://api.superx.tools"`; callers override with `host: SCHEDULE_ENDPOINT`. Handles `error === "shared_access_revoked"`. |
| Low-level fetch `h.default` (module 86637) | 303667-303708 | Plain `fetch(url, {method, headers, body, signal})`; JSON-encodes `data`; parses JSON if `content-type` includes `application/json`, otherwise returns the raw `Response` (streaming endpoints rely on this). |
| X API request helpers | 195370-195410, 279430-279500 | Attach `x-csrf-token: <ct0 cookie>` and `X-Twitter-Auth-Type: OAuth2Session` and call `https://${twitterDomain}/i/api/graphql/...` directly. |
| Raw `fetch` to backend (outside `r`) | 295, 201786, 216154, 287817, 288013, 288038, 319498, 330647-330693, 183142 | Manually add `Authorization: Bearer <token>` and `user_uid: <viewing uid>` headers. |

Verbatim wrapper core (211056-211059):

```js
if (this.__token) a.headers = Object.assign(Object.assign({}, a.headers), { Authorization: `Bearer ${this.__token}` });
else if ("strict" === n) return Promise.reject("Unauthorized access");
return (0, h.default)(e, Object.assign({ host: "https://api.superx.tools" }, a))
```

Note: paths beginning with `/api/...` are sent to `api.superx.tools` unless a `host` is passed; many identical paths are called with `host: SCHEDULE_ENDPOINT` elsewhere (for example `/api/contacts/lists` at 163370 vs 208524). Both hosts appear to front the same backend; this is inferred, not verified.

## 2. Endpoint table

Method is GET unless stated. "Host" is D = default `api.superx.tools`, S = `app.superx.so` explicitly, F = raw fetch to `NEXT_PUBLIC_API_ENDPOINT` with manual headers.

### 2.1 Auth, account, subscription (all D)

| Path | Method | Line | Sent | Response use |
|---|---|---|---|---|
| `/auth/twitter` | link (browser navigation) | 1314, 170078, 301043 | nothing (starts X OAuth on SuperX server) | Redirects back with `?xpayload=` |
| `/auth/me` | GET | 211074, 266457 | Bearer only | `subscription, profile, connectedToTwitter, connectedToBsky, bskyUsername, onboardingCompleted, settings, isSharedSession, sharedPermission` (211118-211128) |
| `/api/auth/account/update` | POST | 211236 | profile fields `e` (merged into stored user) | updates local `__superX__ak` |
| `/api/auth/logout` | POST | 211246 | Bearer | clears local auth |
| `/api/auth/switch-account` | POST | 211381, 267526 | `{targetUid}` | new `token`, `user.{id,displayName,photoURL}`; reloads page |
| `/api/auth/bsky/connect` | POST | 200498, 226686 | `{service: "https://bsky.social", identifier, password}` (Bluesky app password) | `{success,error}`; sets `connectedToBsky` |
| `/api/me/linked-accounts` | GET / DELETE | 211401, 211406, 267130 | DELETE: `{accountId}` | `accounts[]` with `isMain`, `reauth_needed` |
| `/api/me/linked-account-limit` | GET | 267131 | | `{limit}` |
| `/api/shared-accounts` | GET | 291610, 329910 | | `{sharedAccounts[]}` |
| `/subscription` | GET | 211352, 298786 | | subscription object (`status, provider, product_name, stripe_price_id, cancel_at_period_end, managedBy`) |
| `/subscription/activate`, `/cancel`, `/resume`, `/pause`, `/skip-trial`, `/update-plan` | POST | 211188-211220, 162337 | `/update-plan: {new_plan}`; pause/cancel: form data `e` | subscription object |
| `/subscription/invoices` | GET | 211214 | | invoice list |
| `/trial-history` | GET | 211343 | | `{hasTrialHistory}` |
| `/checkout/create-session` | POST | 162345 | `{price_id}` | `{checkout_url}` opened in new tab (Stripe) |
| `/affiliate` | GET | 162376 | | `{affiliate}` -> `aff_ref` on store links |
| `/migrate` | POST | 170295 | `e` (legacy migration payload; caller `stream.migrate` never invoked in this bundle) | |
| `/api/quota/snapshot` | GET | 223517 | | `{delegate:{isTrial}, xAccount, session_pays:{ai_credits_daily:{limit,used}}, target_pays, isSharedSession, degraded}` (216031, 178028) |

### 2.2 Analytics data pulled from the SuperX backend (D)

| Path | Line | Query | Response |
|---|---|---|---|
| `/pull/1.2/activity` | 300746, 300857, 296224 | `{start, end, uid, meta?, _t}` (+Bearer via `includeToken`) | `{items: tweets[], meta: {last_recent_tweets,...}}` -> feeds graphs, best/worst, media vs text |
| `/pull/1/tracker` | 181481 | `{start, end, uid}` | follower-count time series (`getDataSeries(..., "followers_count")`) |
| `/pull/1.2/user` | 298774, 298789, 185089 | `{value, type:"id", properties:"created_at,uid,id,screen_name,name,friends_count,followers_count,profile_image_url_https,description,entities"}` | X user object |
| `/pull/1/user` | 300682 | `{screen_name}` | X user object (resolve profile being viewed) |
| `/pull/1.2/tweet` | 288799 | `{id}` | tweet object |
| `/search` | 280192 | `{from,to,start,min_likes,query,type,page}` | tweets+users; **fallback when X's own SearchTimeline GraphQL fails** (280178-280195) |
| `/search/1.1/i` | 280211 | `{q, limit:50, page, quality, sensitive, isLibrarySearch:"true", created_at}` | `{items}` = the "viral posts library" |
| `/extension/auto-refresh` | 300728 | POST `{targetUserId, targetUsername}` | `{success, triggered}`; asks server to re-crawl a profile |
| `/extension/refresh-data` | 302351 | POST `{targetUserId, targetUsername, periodDays}` | `{success}` or `error: rate_limit_cooldown | rate_limit_daily`; "Subscription required to refresh data" on 401 |
| `/api/analytics/summary` | 296559 | `{start, end}` (266 days) | `{items}` (activity summary) |
| `/api/me/tweets/counts[?viewAs=]` | 240069, 240074 | | counts for scheduler |

### 2.3 Scores / AI reply detector relay (D, POST, `includeToken`)

Content script relays page-context `postMessage` requests (212672-212697): `AI_REPLY_DETECT_REQUEST -> /tools/detect-ai-reply`, `TWEET_SCORES_REQUEST -> /tweets/scores`, `FETCH_USER_SCORES -> /users/scores`, forwarding `payload` verbatim. No sender of these message types exists in either bundle (grep returned nothing outside the relay), so this path is dormant in this build.

### 2.4 Scheduler, composer, uploads

| Path | Method | Host | Line | Sent |
|---|---|---|---|---|
| `/api/me/tweets` | GET | D | 288895, 197626, 324062 (`?status=Scheduled`), 297057 (`?ids=`) | |
| `/api/me/tweets` | POST | S (182657, 264808, 297357) and D (174025) | | `{id, time, status, details}` where `details` is the composed post (text, thread parts, media keys, `autoRetweet`, `autoPlug{threshold,tplId}`, `autoDelete{afterH,threshold}`, `autoDM{triggers,maxDMs}`, `superFollowersOnly`; 200440-200460, 180816-180830). `status: 0` = unschedule. |
| `/api/me/tweets/:id/dependents`, `/chain-from` | GET / DELETE | D | 173990, 174015 | |
| `/api/me/tweets/:id/tags` | PUT | D | 205126 | `{tagIds}` |
| `/api/me/tags[...]` | GET/POST/PATCH/DELETE | D | 182834-182892 | `{name,color}` |
| `/api/posts/publish-now` | POST | D | 203990, 215295 | `{draftId, details, platforms: ["twitter"|"bluesky"...], settings}` -> **server publishes to X/Bluesky using server-held connections** |
| `/api/tweets/:id` | DELETE | S | 274448 | |
| `/api/tweets/:id` | POST | D | 283932 | `{action:"hide", hidden}` |
| `/api/tweets/bulk-hide`, `/bulk-delete` | POST | D | 240642, 262703, 324289 | `{ids}` |
| `/api/tweets/bulk-enable-autort` | POST | D | 262738, 324254 | `{ids, autoRetweet}` |
| `/api/me/has-instant-published` | GET | D | 200413 | |
| `/api/me/settings` | GET/POST | S | 280522-280529 | `{settings}` composer/engage settings (keys at 185040-185061, e.g. `discoverKeywords`, `engageReplyRules`, `plugTemplates`) |
| `/api/me/settings/pinned-communities` | GET/POST | D | 174900, 174944 | `{pinnedCommunities}` |
| `/api/communities/search?query=` | GET | D | 174914 | |
| `/api/search/mention` | GET | S | 174779 | `{q, limit:"8"}` (falls back to X user search) |
| `/api/search/personalized-media` | POST | D | 183965, 184014 | `{type, limit, fresh}` |
| `/api/uploads` | POST | D | 301870 | `{filename, fileType, size}` -> `{preSignedUrl, url, objectKey}` (media goes to R2, `r2.cloudflarestorage.com`, 234642) |
| `/api/uploads/verify` | POST | D | 301927 | `{objectKey, expectedSize, uploadId}` |
| `/api/uploads/delete-object` | DELETE | D | 205777, 234364-234485 | `{objectKey}` |
| `/api/fetch-og-tags` | POST | D | 243464 | `{url}` (link preview) |
| `/api/media/proxy?url=`, `/api/tools/proxy?path=`, `/api/tools/reddit-proxy?id=`, `/api/tools/site?url=` | GET | S | 183142, 234645, 187493, 287229-287245 | remote image / page fetch via server |
| `/api/rate-limit` | GET | S | 257857 | X rate-limit snapshot from server (`setRateLimitBase(SCHEDULE_ENDPOINT)` at 174715, 197931, 225838) |
| `/public/t/:id`, `/public/:type/:id` | link | S | 215155, 287226 | shareable public post/poster links |

### 2.5 Engage (auto/AI replies)

| Path | Method | Host | Line | Sent |
|---|---|---|---|---|
| `/api/engage/discover` | POST | D | 178322, 178644 | `{keywords, discoverQuery, limit:20, excludeTopics, mode, includeReplied}` |
| `/api/engage/lists-posts` | POST | D | 178466, 178572-178639 | list/source descriptor |
| `/api/engage/x-list-preview` | POST | D | 178536, 315790 | `{list: listId}` |
| `/api/engage/mentions` | POST | D | 291833 | `{cursor, selectedAccountIds, sortMode, includeReplied}` |
| `/api/engage/fetch-by-url` | POST | D | 202112, 262270 | `{tweetId}` |
| `/api/engage/filter-replied-posts` | POST | D | 291953 | `{postIds}` |
| `/api/engage/generate-reply` | POST | S | 198154, 210378, 271069 | `{postText, postAuthorName, postAuthorHandle, conversationContext[{text,authorName,authorHandle}], thoughts, tone}` -> `{reply}` or `type:"ai_credits_exhausted"` |
| `/api/engage/reply` | POST | S | 198019, 210243, 262351 | `{tweetId, replyText, media[{...filename}]}` -> server posts the reply on X (`reauthNeeded` -> "re-authenticate your X account", 198025-198030) |
| `/api/engage/skip`, `/clear-skips` | POST | D | 178696, 291879, 292590 | `{tweetId, source}` |
| `/api/engage/block-account`, `/blocked-accounts` | POST / GET | D | 178746, 240991, 292020, 202096 | `{xUserId, handle, name, avatarUrl}` |
| `/api/engage/all-replies` | GET | D | 198540 | |

### 2.6 Contacts, Signals, Inbox/DM

| Path | Method | Host | Line | Sent |
|---|---|---|---|---|
| `/api/contacts/lists[?include=preview]` | GET/POST | D and S | 163370, 163600, 168070, 208444, 208524, 288143 | POST `{name}` |
| `/api/contacts/lists/:id/members[?page_size=]`, `/members/bulk` | GET / POST | D/S | 168137, 163627, 208410, 288110 | `{members:[{user_id, screen_name, name, profile_image_url,...}]}` (people selected in the UI, i.e. X users harvested from the page) |
| `/api/contacts/lists/:id/export` | link | S | 194892 | |
| `/api/contacts/users/:id/profile`, `/notes`, `/lists` | GET | S | 174812, 241167, 241409, 241426, 284378 | |
| `/api/contacts/signal-evidence?...` | GET | S | 241294 | |
| `/api/contacts/imports/x-list` | POST | S | 290483 | `{list_url, target_list_id, accept_cap}` -> server crawls an X list |
| `/api/contacts/imports/jobs[...]` | GET | S | 328061-328106 | job polling |
| `/api/signals/agents` | GET/POST/DELETE | D | 226314, 226353, 241362 | `{name, icp_description, precision_mode, dm_filter, destination_list_id}`; `error.code === "cap_reached"` = plan agent cap |
| `/api/signals/agents/:id/signals` | POST | D | 226341 | `{type:"keyword_watch", query}` |
| `/api/autodm/status` | GET | S | 349, 304320 | -> `{dailyBulkMax, dailyBulkRemaining, monthlyRemaining}` |
| `/api/bulk-dm/send` | POST | S | 842 | `{recipients:[{user_id, screen_name, name, profile_image_url, message?}], message?, allowSpread:true}` -> **server sends DMs on X** |

### 2.7 AI writer / "Ask" agent (all on `api.superx.tools`)

| Path | Method | Line | Sent |
|---|---|---|---|
| `/agent/chat` | POST (Vercel AI SDK `DefaultChatTransport`, streaming) | 216035 | UI messages + `{timezone, superXRules, model}`; headers `Authorization: Bearer`, `user_uid` |
| `/agent/datasets/:id` | GET (F) | 295, 287817, 288013 | dataset rows produced by agent tools |
| `/api/ask/datasets/:id/export?format=` | GET (S) | 288038 | |
| `/ask/chats`, `/ask/chats/:id` | GET / DELETE (F) | 330647-330693, 201786 | chat history stored server-side |
| `/ask/feedback` | POST (F) | 216154 | `{chat_id, message_id, rating}` |
| `/ask/skills` | GET (F) | 319498 | `{skills, categories, meta}` |
| `/api/ai-chat/angles`, `/generate`, `/iterate` | POST | 259712, 259782, 259861, 176787 | `{userPrompt|selectedAngle|instruction, composerContent, composerMedia, composerThreadParts, previousGeneration, structureType, userId, mediaContext, tweetContext, urlContext, youtubeContext}` |
| `/api/ai-chat/scrape` | POST | 260056 | `{url}` |
| `/api/ai-chat/youtube-transcript` | POST | 266846 | `{url, videoId}` |
| `/api/ai-chat-storage[...]` | GET/POST/PATCH/DELETE | 214830-214868 | whole chat object incl. `composerState`, `messages` (server-side persistence of drafts) |
| `/api/tools/inline-edit-stream` | POST (streamed body) | 169789, 176207, 180317, 298033 | `{text, fullText, editType, instruction, threadContext, userId}` (the "Rephrase with" feature, 176321) |
| `/api/tools/algorithm-predict` | POST | 177270 | `{versionA, versionB}` (two draft texts) -> `{versionA.score, versionB.score}` |
| `/deepgram/token` | GET | 260472 | -> `{key}` temporary Deepgram key for voice dictation (browser then talks to Deepgram directly; host string not in bundle, it lives in the Deepgram SDK) |

### 2.8 Misc telemetry-ish (D)

| Path | Method | Line | Sent |
|---|---|---|---|
| `/push/1/contact` | POST | 244613 | `{message, email, attachment:{name,data(base64)}}` (support form, user-initiated) |
| `/push/1/error` | POST | 244796 | `{error: t.toString()}` from the React router `ErrorBoundary` only |

## 3. Authentication with the SuperX backend

1. Login is a plain link to `${API_ENDPOINT}/auth/twitter` labelled "Login with X" (1314, 170078). The OAuth dance happens on SuperX's server, not in the extension.
2. The server redirects back to an `x.com` URL carrying `?xpayload=<base64 JSON>` (optionally `xpayload-type=uri-encoded`). `getXPayload()` (240296-240308) parses `location.search`. The `/login-success` memory-router route (329262, module 15519 at 182751-182760) calls `setAuthPayload(e.payload, "login")`, then `history.replaceState` removes `xpayload` from the URL.
3. Payload fields (211274-211280): `{ token, user, sub, isNewUser, authMethod }`. `token` is a JWT: the client decodes it with `decodeJwt` and reads `uid`, `mainUid`, `isSharedSession`, `sharedPermission` (211297-211335).
4. Storage: `localStorage["__superX__ak"] = JSON.stringify({token, user, ...})` (211279). This is x.com's origin localStorage, readable by any script on x.com. Other local keys: `__X_VISION__PROPS` (app props incl. `requestDetails`, `user`, `limit`), `engage-lists-state`, `composerDraft`, `__superx_ask_model`.
5. Attachment: `Authorization: Bearer <token>` header on every backend call (211057), plus `user_uid: <viewing uid>` on the Ask/agent raw fetches (216038, 201788). No cookies are used toward SuperX hosts (`fetch` is called without `credentials`, 303699).
6. Session validation: on load `GET /auth/me` with a 15 s timeout (211085-211092); `error === "unauthorized" | "Invalid authentication token"` triggers "Session expired" and `signOut()`.
7. Multi-account: `${SCHEDULE_ENDPOINT}/auth/twitter/v2/add-account?token=<JWT>` opens the web app with the JWT **in the query string** (267146). That is a token leak into browser history / server logs of app.superx.so.

### Does the X session (ct0 / auth_token) or X data reach SuperX servers?

- `ct0` is read from `document.cookie` via `getCookies()` (182685-182693) at exactly three call sites (195394, 279442, 279484). In all three it is placed in `x-csrf-token` on requests to `https://${twitterDomain}/i/api/...` only. `auth_token` is HttpOnly and never referenced. No code sends cookies, `x-csrf-token`, or the X bearer token to `api.superx.tools` / `app.superx.so` (grep for `ct0`, `auth_token`, `document.cookie` shows no other uses).
- `requestDetails.headers` (authorization, x-csrf-token, x-client-transaction-id captured from X traffic) is **read** from `__X_VISION__PROPS` (195279, 195301) and used only for X calls; no writer exists in either bundle (see Uncertainties).
- X **content** does reach SuperX servers, but as feature payloads, not as raw capture: contact members (user ids, handles, names, avatars) via `/api/contacts/lists/:id/members/bulk`; post text and author of tweets you reply to via `/api/engage/generate-reply`; your draft text via `/api/tools/inline-edit-stream`, `/api/ai-chat/*`, `/api/ai-chat-storage`, `/api/me/tweets`; blocked accounts; Bluesky **app password** via `/api/auth/bsky/connect`.
- The reverse direction is the notable one: the server already holds your tweets/followers history (it serves them via `/pull/*`), which means SuperX crawls X on your behalf server-side. The client never uploads captured timelines: the "inserts" sink is a no-op (section 5.1).

## 4. Plans, paywall, billing

- Tiers (plan card at 162420-162860): **PRO $49/mo** ("The essentials to post consistently": 5 connected X accounts, 500 posts/month, 750 AI credits/month, Publish X Articles, 1 Signal Agent, 1,000 Auto DMs/month, 10 AI covers, import 5,000 latest followers, cross-post to Bluesky, API/CLI/MCP 30 req/min), **ADVANCED $99/mo** (launch price, "normally $99", "-50%"; everything in Pro plus AI Post & Thread Writer, 1,500 AI credits with advanced models, Engage 750 replies/month, 3 Signal Agents, **10M+ viral posts library**), **ULTRA $199/mo** (4,000 AI credits expandable to 100,000, 10 accounts, 3,000 posts, 3,000 Engage replies, 5 agents, 5,000 Auto DMs, API 400 req/min, priority support). "3-day free trial", "14-day money back guarantee".
- Checkout: LemonSqueezy store links `https://store.superx.so/buy/<4 variant uuids>` (162868-162871) with `aff_ref` and `checkout[custom][uid]` query params (162395-162396); Stripe via `POST /checkout/create-session {price_id}` (162345) and Stripe price ids `price_1SwQwAG1ybuaPUAQJvGMgijI`, `price_1SwQx9G1ybuaPUAQvfFkIvOt` (162405). Billing portals: `https://superxtools.lemonsqueezy.com/billing` or `https://billing.stripe.com/p/login/dRm00jdmC75XczE32Ue7m00` chosen by `subscription.provider` (318033-318035). Affiliates: `https://superx.getrewardful.com/signup` (289806), `https://app.superx.so/affiliates`.
- Entitlement is **server-derived, client-enforced**: the client trusts `subscription.status` / `product_name` / `provider` from `/auth/me` and `/subscription`, and `quota/snapshot`. Checks are string matches: `product_name.toLowerCase().includes("pro"|"advanced"|"ultra")` (162400-162402, 178038, 291546); `hasActiveSubscription()` = status in `["active","trialing"]` (211374, 10 call sites); route guard requires status `active|trialing|on_trial` (212858). The analytics history gate: `ye = H.user && (-1 === $ || $ > 90) && !H.subscription` (300627) i.e. >90 days needs a subscription; the client clamps to 90 days (300629). Engage AI credit gating uses `session_pays.ai_credits_daily.{limit,used}` (216031). Server also enforces: `/extension/refresh-data` 401 -> "Subscription required", Signals `cap_reached`, Engage `ai_credits_exhausted`, DM `dailyBulkMax`.
- Because gates are client-side string checks on a server-supplied object, a local reimplementation simply has no paywall; nothing in the extension's own logic needs the plan except to hide UI.

## 5. Feature classification

Legend: **A** = fully client-side (X GraphQL from the page + IndexedDB/localStorage), **B** = needs the SuperX backend, **C** = needs a third party (AI model, Bluesky, Deepgram, CDN).

| Store feature | Class | Evidence |
|---|---|---|
| Analytics graphs (activities, tweets, replies, period selector) | **B** (data) | Timeline items come from `/pull/1.2/activity` (300746-300760, 296224); `/extension/auto-refresh` and `/extension/refresh-data` ask server to re-crawl. Charts are rendered locally (Chart.js bundled). Reimplementation: fetch `UserTweets`/`UserTweetsAndReplies` GraphQL locally (the fetcher already exists at 329524-329580 and is used by the queue at 212790-212840, but its results are discarded, see 5.1). |
| Best / worst tweets, media vs text, accumulate toggles | **B** for data, A for computation | Derived in-browser from the `items` returned by `/pull/1.2/activity` (`DataContextContainer.data`, 300884-300900). `getBestTweets` (195299-195360) also hits X's `UserTweets` GraphQL directly with a guest token from `https://api.twitter.com/1.1/guest/activate.json` (195303). |
| Follower tracker | **B** | `/pull/1/tracker` (181481). IndexedDB store `followerTrackers` exists (170372) but was dropped in schema v9 (170406) and never re-added. |
| Interaction matrix ("interactions" route) | **B** | same `/pull/1.2/activity` dataset (300881 lists `interactions` among the pro-gated routes) |
| Tweet inspiration / search | **A** with **B** fallback | X `SearchTimeline` GraphQL first (280100-280178), falls back to backend `/search` (280192) |
| Viral posts library (10M+) | **B** | `/search/1.1/i` with `isLibrarySearch:"true"` (280211) |
| Fact-check, "chat with profile" | not found | No string or endpoint matches `fact`, `Fact Check`, `chat with profile`. Closest is the Ask agent (`/agent/chat` with `superXRules`, tools returning datasets). Treat as **B/C** if it exists server-side. |
| Rephrase ("Rephrase with", inline edit) | **B/C** | `/api/tools/inline-edit-stream` (169789, 176207); model runs on SuperX's side |
| AI post writer / thread writer / angles | **B/C** | `/api/ai-chat/angles|generate|iterate|scrape|youtube-transcript` (259712-260056, 266846); `/api/tools/algorithm-predict` (177270) |
| Content strategist / Ask agent | **B/C** | `/agent/chat`, `/ask/*`, `/agent/datasets/*` (216035, 330647, 295); model picker slugs `anthropic/claude-*`, `openai/gpt-*`, `google/gemini-*` (216864-216872) |
| Engage (discover, mentions, AI reply, auto-reply) | **B/C** | `/api/engage/*` (178322-178746, 198019-198154, 291833-292020); replies are **posted by the server** (`/api/engage/reply`, `reauthNeeded`) |
| Tweet scheduler, drafts, tags, articles | **B** | `/api/me/tweets` (182657, 264808), `/api/posts/publish-now` (203990), `/api/me/tags`; scheduled publishing and auto-RT/plug/delete/auto-DM are server jobs configured in `details` (200440-200460) |
| Auto retweet & plug, auto delete | **B** | flags inside scheduled post `details` and `/api/tweets/bulk-enable-autort` (262738); executed server-side |
| Cross-post to Bluesky | **B + C** | Bluesky credentials go to `/api/auth/bsky/connect` (200498); publishing via `/api/posts/publish-now {platforms}` (203993). No `xrpc`/`com.atproto` client in the bundle, so Bluesky is reached only from the server. |
| Media uploads / posters | **B** for storage, A for rendering | Poster canvas is local (177401, 183076 draws "superx.so" watermark); persisted via `/api/uploads` presign to R2 (301870); share links `/public/t/:id` (215155) |
| Social Hub / Inbox ("Super Inbox") | **A** (UI only) | `enableSuperInbox` toggles body classes (203328-203334); DM conversations cached in IndexedDB `converstaions` (170413, 330511). No DM network endpoints in the bundle besides server-side `/api/bulk-dm/send` and `/api/autodm/status`. |
| Custom timelines, quick actions, themes, hide-sidebar etc. | **A** | pure DOM/appProps in `__X_VISION__PROPS` (`customTimelineTab` 1380-1389, `defaultAppProps` listener:508-530) |
| Contacts / lists / import followers / X-list import | **B** | `/api/contacts/*` (163600-163627, 290483), imports run as server jobs (328061-328106) |
| Signals / agents (lead finding) | **B** | `/api/signals/agents` (226314-226353) |
| Auto DM / bulk DM | **B** | `/api/bulk-dm/send` (842), `/api/autodm/status` (349) |
| Multi-account, shared accounts, team | **B** | `/api/auth/switch-account`, `/api/me/linked-accounts`, `/api/shared-accounts` |
| Affiliates | **B/C** | Rewardful links, `/affiliate` |
| Voice dictation | **B + C** | `/deepgram/token` then Deepgram (260472) |

### 5.1 The dead client-side capture pipeline (important for the rewrite)

- `dbCore.insertTweets/insertUsers/insertNotifications` (170439-170490) write X GraphQL results into Dexie `XDatabase` (`tweets`, `users` re-added in schema v110 at 170419-170426) and emit `insert` events.
- The content script forwards every `insert` to `stream({inserts})` (212663-212667) and also receives page-context inserts through the DOM channel (284266-284278).
- `stream` (170284-170292) is a no-op: it counts entries and returns `Promise.resolve()`. `migrate` (`POST /migrate`) is defined but has no caller.
- The user-tweet crawl queue (`queueUserToFetch` 330542, worker 212790-212840) fetches `UserTweetsAndReplies` pages from X but only advances cursors; the cleaned tweets `c` are never stored or sent.
- Conclusion: the extension already contains everything needed to gather timeline data locally (GraphQL fetchers with feature flags at 329524-329580 and 280100-280178, transformers in listener:56917/92377/44503, Dexie schema), but the product moved the source of truth to the server. A local clone should re-connect `insertTweets` to the analytics `DataContext` instead of `/pull/1.2/activity`.

## 6. Telemetry and error reporting

- **No** Sentry, PostHog, GA, Mixpanel, Amplitude, Hotjar, LogRocket or `sendBeacon` (case-insensitive grep over both bundles; the only hits are CSS `scrollbar`, an `amplitude` audio variable at 245553, and `Symbol.toStringTag`).
- `usePostHog()` is a stub returning no-op `capture/identify/setPersonProperties` (167829-167830).
- Only outbound error report: `POST /push/1/error {error: String(routeError)}` from the router `ErrorBoundary` (244796). Support form `POST /push/1/contact` is explicit user action (244613).
- Usage signals that reach the server implicitly: every `r()` call is authenticated, so the backend can see feature usage; `/extension/auto-refresh` fires whenever you open someone else's profile while subscribed (`targetUserId`, `targetUsername`, 300715-300735), which discloses browsing of X profiles to SuperX.
- Vercel AI SDK internal `experimental_telemetry`/OpenTelemetry spans are present in the bundle but only active if a tracer is configured; none is.

## 7. Other third parties (runtime supply chain)

| Host | Line | What | Concern |
|---|---|---|---|
| `https://cdn.jsdelivr.net/npm/@emoji-mart/data@latest/...` | 164579, 164595 | emoji-mart data and i18n JSON fetched at runtime with `@latest` | unpinned; JSON data only (not executed) |
| `https://cdn.jsdelivr.net/npm/emoji-datasource-*@15.0.1/img/...` | 165001, 165005 | emoji sprite PNGs | pinned, images |
| `https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js` | 173622 | **executable JS loaded at runtime** (Web Worker script for image compression, `libURL`) | supply-chain: remote code execution surface inside the x.com page context; pinned to 2.0.2 |
| `https://unavatar.io/twitter/${screen_name}` | 215738 | avatar fallback (leaks viewed handle to unavatar) | privacy |
| `https://ui-avatars.com/api/?name=${screen_name}&background=random` | 215740 | second avatar fallback | privacy |
| `https://i.imgur.com/xHnHdw3.png`, `BaTnM7g.png` | 1351 | onboarding screenshots | benign |
| `https://api.twitter.com/1.1/guest/activate.json` with the public web bearer `AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=...` | 195303-195309 | guest token for `UserTweets` when no session headers | X-owned, fine locally |
| `https://tinyurl.com/y2uuvskb`, `http://bit.ly/2kdckMn`, `https://bit.ly/3cXEKWf` | 275301, 277900, 237910 | Dexie / Immer error-doc links in messages | strings only |
| `r2.cloudflarestorage.com` (`superx-media` bucket) | 234642, 287236 | media storage behind presigned URLs | via server |
| Deepgram | 260472 | voice-to-text with server-issued key | third party, only when dictation used |
| `https://ai-gateway.vercel.sh/v1/ai` | 274309 | default `baseURL` inside the bundled `@ai-sdk/gateway` provider. `createGateway` is exported (250860) but **never called by app code**; no `AI_GATEWAY_API_KEY` or `apiKey` in app code. All model calls go through `api.superx.tools` (`/agent/chat`, `/api/ai-chat/*`, `/api/tools/*`). | dead code; no direct browser->Vercel calls |
| `bsky.social`, `bsky.app` | 200911-200942, 227052-227084 | form default `service` value and a link to app-passwords help | no direct calls |

## 8. Data-leaves-browser summary

Sent to SuperX (`api.superx.tools` / `app.superx.so`), always with the SuperX JWT:

1. Identity: SuperX JWT (also in a URL query for add-account), viewing uid, X user ids / screen names being viewed (`/pull/1/user`, `/pull/1.2/user`, `/extension/auto-refresh`).
2. Content you author: drafts, thread parts, media keys, schedule settings (`/api/me/tweets`, `/api/ai-chat-storage`, `/api/posts/publish-now`), text for rephrase/AI (`/api/tools/inline-edit-stream`, `/api/ai-chat/*`), two draft variants for scoring (`/api/tools/algorithm-predict`), URLs you paste (`/api/fetch-og-tags`, `/api/ai-chat/scrape`, media proxy).
3. Other people's content: text/author of posts you reply to via Engage (`/api/engage/generate-reply`), tweet ids you skip/block, X users you add to contact lists (`user_id, screen_name, name, profile_image_url`), X list URLs to import, DM recipients and message text (`/api/bulk-dm/send`).
4. Third-party secrets: Bluesky app password (`/api/auth/bsky/connect`).
5. Support: email, message, base64 attachment (`/push/1/contact`); router error strings (`/push/1/error`).

Not sent: `ct0`, `auth_token`, X bearer/CSRF headers, raw captured timelines/notifications (pipeline is a no-op), browsing beyond the profile-open trigger above.

Received from SuperX and needed for the UI to function today: tweets/followers history (`/pull/*`), engage feeds, contact lists, scheduled posts, quota/subscription flags.

## Uncertainties

1. `requestDetails` (X `authorization`, `x-csrf-token`, `x-client-transaction-id`, `userTweetsQueryId`, `cursor`) is read from `__X_VISION__PROPS` but no writer exists in `content.pretty.js` or `listener.pretty.js`. Either it is vestigial or written by code not in these two files. Verify with `grep -n "requestDetails" content.pretty.js listener.pretty.js`.
2. The `AI_REPLY_DETECT_REQUEST` / `TWEET_SCORES_REQUEST` / `FETCH_USER_SCORES` relay (212672-212697) has no sender in either bundle; the payload sent to `/tools/detect-ai-reply`, `/tweets/scores`, `/users/scores` is therefore unknown (likely tweet texts / user ids).
3. How the server obtains the user's tweets for `/pull/1.2/activity` (its own crawler vs the OAuth token from `/auth/twitter`) cannot be determined from client code. `connectedToTwitter` and `reauthNeeded` show the server holds an X connection per account.
4. Whether `api.superx.tools` and `app.superx.so` are the same backend is inferred from identical `/api/*` paths being used against both; not verified.
5. "Fact-check" and "Chat with profile" from the store description have no matching strings; they may be tools of the server-side Ask agent (`/ask/skills`) or removed.
6. `listener.js` has no fetch/XHR hooks, yet ships GraphQL transformers that call `dbCore.insert*`. How X responses reach it (if at all) was not traced; it may be only a router bridge in this build.
7. The Deepgram host and the exact `details` schema of scheduled posts were not read verbatim (they live in the Deepgram SDK and composer state respectively).
