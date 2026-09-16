# x-lytics: fully local X (Twitter) analytics sidebar

Date: 2026-09-16. Status: approved design, pending implementation plan.

## 1. Goal

Build a Chrome extension that reproduces the locally reproducible functionality of the SuperX (Twitter Analytics) extension, version 0.8.6, with one hard constraint: the extension never sends a request to any host other than `x.com`, `twitter.com` and their subdomains. No vendor backend, no AI gateway, no CDN, no telemetry. All data lives in the browser.

The reverse-engineering study that grounds this design lives in `docs/research/01-bootstrap-ui.md` through `05-analytics-logic.md`. Line references in those documents point at the prettified SuperX bundle and are the source of truth for every SuperX behavior mentioned here.

### 1.1 Key finding that shapes the design

SuperX is a thin viewer over its own servers. Its analytics dataset, follower history and mentions are downloaded from `api.superx.tools`; the client-side capture pipeline exists but is dead code (the sink is a no-op and the backfill worker discards the tweets it fetches). A local clone therefore has to build the data acquisition layer that SuperX does not have, while the analytics algorithms, the UI structure and the X GraphQL client can be reproduced from what the bundle contains.

## 2. Scope

### 2.1 In scope (v1)

| Area | Behavior |
|---|---|
| Sidebar shell | Appears as soon as an `x.com` or `twitter.com` page finishes loading. Fixed 460 px column on the right, collapsible to a floating toggle button. Optional hiding of X's right column and DM drawer. Auto-resize and close-to-main-column layouts as in SuperX. |
| Theme | Auto-detects X's dark, dim or light theme from `document.body.style.backgroundColor` (`rgb(0, 0, 0)` dark, `rgb(21, 32, 43)` dim, anything else light), with a manual override in settings. Re-detects when the body style changes. |
| Identity | Current user id from the readable `twid` cookie (`u%3D<id>`). Screen name and profile fields from the first captured or fetched `User` object with that id. No login of any kind. |
| Home | Highlights: top 20 tweets of the selected period by `favorite_count`. Recents: latest 12 own posts that are not replies. |
| Activities | Period selector: Today, 7, 14, 30, 60, 90, 180 days, All time. Frequency heatmap (18 weeks by 7 days, max, min, avg over the period). Engagement block: impressions, tweets, likes, retweets, replies, bookmarks, each as a time-series line chart with optional cumulative mode and period-half change, plus each metric's share of the total and a real engagement rate. Hour by weekday impressions heatmap. Media category block (video, photo, emoji, URL, text-only). Followers chart with true deltas. Optional earnings estimate `views / 117370 * 1.5`. |
| Tweets | Sortable table over own tweets: date, text, media count, views, likes, retweets plus quotes, replies, bookmarks. Tabs: Tweets, Replies, Retweets. Text search. Best and worst views (top and bottom 20 by likes, with an impressions floor of 100 for the worst list so that unseen posts are not ranked). |
| Mentions | Replies and quote tweets addressed to the user. Filters: minimum likes, retweets, impressions and author followers; verified only; hide already replied. Sort by newest or by likes then impressions. |
| Timelines | Custom feeds of three kinds: an X List (`ListLatestTweetsTimeline`), a user (`UserTweets`), or a keyword search (`SearchTimeline`, Top or Latest). Manual refresh and cursor-based infinite scroll. List CRUD through X's list GraphQL operations. |
| Quick actions | Like, unlike, retweet, unretweet, bookmark, unbookmark on any tweet rendered inside the sidebar. Copy text. Open on X through in-page SPA navigation. |
| Posters | Export any chart or tweet card to PNG at 2x pixel ratio with the 16 SuperX background styles (one theme-following, 8 solid, 4 linear gradients, 3 radial mesh gradients, two of them with a grain overlay). Download or copy to clipboard. |
| Settings | Theme, layout toggles, page toggles, X rate-limit status, retention window for other people's tweets (default 90 days), data export to JSON, delete all data. |

### 2.2 Out of scope (v1)

Composer and scheduler, auto-retweet, auto-plug, auto-delete, auto-DM, every AI feature, Contacts, Engage, Signals, the viral post library, Social Hub, Bluesky cross-posting, multi-account, HEIC conversion, media upload. These either require a server that runs when the browser is closed, a third-party model, or SuperX's proprietary datasets.

Also excluded on purpose: a background service worker and any `permissions` or `host_permissions`. The follower tracker therefore only records a snapshot when an X tab is open (the decision taken during design).

## 3. Architecture

### 3.1 Manifest

Manifest V3, `minimum_chrome_version` 111 (needed for `world: "MAIN"` in declarative content scripts). No `permissions`, no `host_permissions`, no `background`, no `web_accessible_resources`. Two content scripts, both matching `https://x.com/*`, `https://twitter.com/*`, `https://pro.x.com/*`, `https://pro.twitter.com/*`:

| Script | World | run_at | Responsibility |
|---|---|---|---|
| `interceptor.js` | MAIN | document_start | Observe X's own GraphQL traffic and forward it. |
| `sidebar.js` | ISOLATED | document_end | Database, active X client, analytics, UI. |

The extension CSP (`content_security_policy.extension_pages`) is `script-src 'self'; object-src 'none'`. Content scripts are bound by the page CSP for injected resources, so the guarantee that nothing leaves the browser is enforced by code review, by the absence of any non-X URL literal in the source, and by an automated test on the built bundle (section 7).

### 3.2 Interceptor (MAIN world)

Wraps `window.fetch` and `XMLHttpRequest.prototype.open` and `send` before X's own bundle runs. For every response whose URL matches `^/i/api/graphql/([^/]+)/([A-Za-z0-9_]+)` it:

1. Parses `queryId` and `operationName` from the URL and the `features` and `fieldToggles` query parameters (GET) or JSON body (POST).
2. Clones the response, parses the JSON, and posts `{ source: "x-lytics", v: 1, kind: "graphql", op, queryId, features, fieldToggles, status, body }` with `window.postMessage(msg, location.origin)`.
3. Never reads cookies, never issues requests, never mutates the response seen by X.

Payloads larger than 8 MB are dropped with a `kind: "dropped"` message so the sidebar can log it. Errors inside the wrapper are swallowed so X keeps working even if the wrapper fails.

REST endpoints under `/i/api/1.1/*` and `/i/api/2/*` are not intercepted in v1; the GraphQL surface covers every data source the sidebar needs.

### 3.3 Sidebar (ISOLATED world)

Mounts a host element `div#x-lytics-root` appended to `document.body` with an open shadow root. All UI, styles and fonts render inside the shadow root. The host element carries `position: fixed; right: 0; top: 0; z-index` above X's layers. Layout classes on `document.body` (`xl-hide-sidebar`, `xl-hide-dm`, `xl-close-to-main`) hide X's `[data-testid=sidebarColumn]` and `[data-testid=DMDrawer]` through a small stylesheet injected into `document.head`; this is the only CSS that leaves the shadow root.

Message handling: a single `window` `message` listener accepts only events where `event.source === window`, `event.origin === location.origin`, `data.source === "x-lytics"` and `data.v === 1`, then validates the shape with a hand-written guard before passing the payload to the ingestion pipeline. Anything else is ignored silently.

### 3.4 Data layer

Dexie over IndexedDB, database name `xlytics`, version 1. Tables and indexes:

| Table | Primary key | Indexes | Content |
|---|---|---|---|
| `tweets` | `id` (rest_id string) | `user_id_str`, `created_at`, `conversation_id_str`, `in_reply_to_user_id_str`, `quoted_status_id_str`, `[user_id_str+created_at]` | Normalized tweet (section 3.5). |
| `users` | `id` (rest_id string) | `screen_name` | Normalized user. |
| `followerSnapshots` | `[user_id+day]` | `user_id`, `day` | `followers_count`, `following_count`, `statuses_count`, `taken_at`. One row per user per local calendar day. |
| `queryIds` | `op` | `seen_at` | `queryId`, `features`, `fieldToggles`, `seen_at`, `source` (`seed` or `observed`). |
| `rateLimits` | `endpoint` | | `limit`, `remaining`, `reset` (epoch seconds), `updated_at`. |
| `backfill` | `key` | | Cursor, last run, pages fetched, oldest `created_at` reached, per job. |
| `timelines` | `id` | `created_at` | Custom timeline definitions `{ id, type, name, listId, userId, query, product }`. |
| `settings` | `key` | | Every user preference. Nothing is stored in `localStorage`, which X shares. |

`tweets.id` is the tweet's `rest_id`; there is no auto-increment key. Own tweets (`user_id_str` equals the current user) are never pruned. Tweets by other users older than the retention window are pruned once per session, except tweets referenced by an own reply or quote, which are kept so that conversation context survives.

### 3.5 Normalizer

Input: any GraphQL response body. Output: arrays of tweets and users. The normalizer does not know the instruction layout of each timeline. It walks the JSON depth-first and collects:

- Every object with `__typename === "Tweet"` or `"TweetWithVisibilityResults"` (unwrapping `.tweet`) that has `rest_id` and `legacy`.
- Every object with `__typename === "User"` that has `rest_id` and `legacy`.

Tweet normalization copies `legacy` fields, sets `id = rest_id`, `created_at` to epoch ms, `view_count = Number(views.count) || 0`, merges `note_tweet.note_tweet_results.result.text` into `full_text` when present, and records `user_id_str` from `core.user_results.result.rest_id` when `legacy.user_id_str` is missing. It also records `quoted_status_id_str` and the flat list of media types. User normalization copies `legacy`, sets `id = rest_id`, and reads `screen_name` and `name` from `core` when `legacy` lacks them (X moved those fields in 2025).

Existing rows are merged with `bulkPut` so newer counters overwrite older ones. A tweet is only kept if it has a numeric `created_at` and a `user_id_str`.

### 3.6 Query id registry

Seeded at build time with the 25 operations extracted from SuperX in `docs/research/03-x-api-client.md` (query ids, `variables` templates, `features`, `fieldToggles`). At runtime every intercepted request updates the row for its operation with `source: "observed"`. The active client always reads the registry, so an observed id wins over the seed. If an active call returns HTTP 404 or a GraphQL error naming the query, the client marks the row stale and retries once after the next observation of that operation; it never scrapes X's JavaScript to discover ids.

### 3.7 Active X client

Same-origin `fetch` on `location.origin` with X's public web bearer, `x-csrf-token` from the `ct0` cookie, `x-twitter-auth-type: OAuth2Session`, `x-twitter-active-user: yes`, `x-twitter-client-language: en`. GET operations encode `variables`, `features` and `fieldToggles` as URL-encoded JSON; mutations POST `{ queryId, variables }`. Every response updates `rateLimits` from the `x-rate-limit-*` headers.

Throttle rules, taken from SuperX and hardened:

- Stop a paging job when `remaining < 30` and the reset is more than one minute away; resume after reset.
- 1 s between pages, 10 s after every 6 pages.
- On HTTP 429 or 503: exponential backoff starting at 30 s, capped at 10 minutes, at most 5 attempts per job.
- On HTTP 401 or 403: abort the job and show a non-blocking notice in settings; never retry automatically.
- Pagination stops when the bottom cursor equals the previous one, when a page yields zero new tweets, or when the job's age limit is reached. Cursor entries are identified by `cursorType === "Bottom"`, not by position.

Operations used in v1: `UserTweets`, `UserTweetsAndReplies`, `UserByScreenName`, `UserByRestId`, `SearchTimeline`, `TweetDetail`, `ListLatestTweetsTimeline`, `ListByRestId`, `ListsManagementPageTimeline`, `ListMembers`, `CreateList`, `UpdateList`, `DeleteList`, `ListAddMember`, `ListRemoveMember`, `FavoriteTweet`, `UnfavoriteTweet`, `CreateRetweet`, `DeleteRetweet`, `CreateBookmark`, `DeleteBookmark`. `UserTweetsAndReplies` and `UserByRestId` are not in the SuperX seed; their ids are learned by observation and, until observed, the jobs that need them are skipped.

### 3.8 Acquisition jobs

All jobs run in the sidebar while an X tab is open, coordinated through the `backfill` table so that two tabs do not run the same job at once (a job row holds a lease with a 2 minute expiry).

| Job | Trigger | Behavior |
|---|---|---|
| Passive ingest | Every interceptor message | Normalize and store. Zero requests. |
| Own backfill | On load, at most once per 24 h | Page `UserTweets` then `UserTweetsAndReplies` backwards until reaching a tweet already stored with a page that yields no new tweets, or until `created_at` is older than 365 days, or 60 pages. |
| Recent refresh | On load, then every 60 min | Fetch the first 2 pages of `UserTweets` and `UserTweetsAndReplies` to refresh counters of recent posts. |
| Follower snapshot | On load, at most once per local day | `UserByRestId` for the current user; write the day's row. Also written passively whenever a `User` object for the current user is intercepted and no row exists for today. |
| Mentions | On opening Mentions, at most once per 10 min | `SearchTimeline` with `@<screen_name> -from:<screen_name>`, product Latest, 2 pages. Quote tweets are also collected from any intercepted tweet whose `quoted_status_id_str` belongs to the user. |
| Prune | On load, once per session | Delete other users' tweets older than the retention window that are not referenced by an own reply or quote. |

### 3.9 Analytics

Pure functions over arrays, in `src/analytics`, no DOM and no Dexie so they are unit-testable:

- Tweet type split: `full_text` starting with `RT @` is a retweet; `in_reply_to_status_id_str` set or `full_text` starting with `@` is a reply; otherwise a tweet. Thread continuations (`conversation_id_str` differs from `id`) are excluded from the Tweets tab, as in SuperX.
- Buckets: hourly for Today, daily otherwise, computed in the browser's local timezone. Bucket labels are the local date, not the UTC ISO string SuperX uses.
- Series: count per bucket, or sum of `view_count`, `favorite_count`, `retweet_count`, `reply_count`, `bookmark_count`. Retweets are excluded from engagement sums, as in SuperX.
- Cumulative mode: running sum. Change: sum of the second half minus sum of the first half of the period; for periods of 2 buckets or fewer, last minus previous.
- Share: `round(100 * metric_total / sum_of_all_metric_totals)`. Engagement rate: `(likes + retweets + replies + quotes + bookmarks) / impressions`, shown per period and per tweet; impressions of zero give no rate rather than a division by zero.
- Media categories: exclusive by priority video, photo, animated_gif, URL, emoji, text-only. The emoji test is `\p{Extended_Pictographic}` so digits and `#` do not count.
- Followers: first snapshot per bucket, forward-filled; deltas may be negative; the chart shows absolute count and delta.
- Frequency heatmap: 18 weeks by 7 days of activity counts including retweets; max, min and average over the selected period.
- Hour by weekday heatmap: sum of `view_count` and count of tweets per `[weekday][hour]`, with toggles to include replies and tweets.
- Earnings estimate: `view_count / 117370 * 1.5` over the period.
- Best: top 20 by `favorite_count`. Worst: bottom 20 by `favorite_count` among tweets with `view_count >= 100`.

### 3.10 UI

Preact with `@preact/signals` for state, a small in-memory router with routes `/`, `/activities`, `/tweets`, `/mentions`, `/timelines`, `/settings`. Tailwind compiled into the shadow root stylesheet; `dark` class on the shadow host root drives dark and dim variants. Chart.js 4 with `chartjs-adapter-date-fns` for time scales, rendered inside the shadow root. `html-to-image` for posters. `react-hot-toast` is replaced by a tiny in-house toast signal.

Tweet text is rendered as text nodes with entity ranges turned into `<a>` elements for URLs, mentions and hashtags; no `innerHTML`.

In-page navigation reuses the router-capture contract SuperX uses: the interceptor traps `Object.prototype.history` assignment to capture X's router instance as `window.__xlRouter` and answers `{ source: "x-lytics", kind: "navigate", path }` messages from the sidebar with `router.navigate(path)`. If the router is not captured, the sidebar falls back to `history.pushState` plus a synthetic `popstate`.

### 3.11 Security properties

1. Network: every literal URL in `src/` points at `x.com`, `twitter.com`, `twimg.com` (avatars and media) or is relative. A build-time test greps the emitted bundles for `https?://` and fails on any other host.
2. No `eval`, `new Function`, remote scripts, or CDN assets. Fonts are system fonts.
3. Cookies: only `ct0` (CSRF) and `twid` (identity) are read. `auth_token` is HttpOnly and never referenced.
4. Messages between worlds are validated by source, origin, version and shape.
5. Data export writes a JSON file through a Blob URL; import is not in v1.
6. No telemetry, no error reporting, no update pings beyond Chrome's own store update mechanism (the extension is loaded unpacked, so there is none).

## 4. Project structure

```
x-lytics/
  manifest.json
  package.json
  vite.config.ts            two IIFE entries, no extension plugin
  tailwind.config.ts
  tsconfig.json
  src/
    interceptor/
      index.ts              fetch and XHR wrappers, URL parsing, postMessage
      router-capture.ts     Object.prototype.history trap and navigate handler
    shared/
      messages.ts           message types and type guards
      x-urls.ts             allowed hosts, GraphQL URL regex
    data/
      db.ts                 Dexie schema
      normalizer.ts         GraphQL JSON to tweets and users
      queryIds.ts           seed and registry
      rateLimit.ts          header parsing and throttle decisions
      jobs/                 backfill, refresh, followers, mentions, prune, lease
    x-api/
      client.ts             fetch wrapper with headers and rate-limit bookkeeping
      operations/           one typed function per GraphQL operation
    analytics/
      types.ts, split.ts, buckets.ts, series.ts, media.ts, followers.ts, ranking.ts, heatmaps.ts
    ui/
      main.tsx              shadow host mount, theme observer, layout classes
      router.ts, store.ts
      pages/                Home, Activities, Tweets, Mentions, Timelines, Settings
      components/           charts, tables, tweet card, poster modal, toast
      styles.css
  tests/
    fixtures/               anonymized real GraphQL responses per operation
    unit/                   normalizer, analytics, queryIds, rateLimit, messages
    build/                  no-external-hosts test over dist/
  docs/
    research/               the five reverse-engineering reports
    superpowers/specs/      this document
```

## 5. Dependencies

Runtime: `preact`, `@preact/signals`, `dexie`, `chart.js`, `chartjs-adapter-date-fns`, `date-fns`, `html-to-image`. Build and test: `vite`, `typescript`, `tailwindcss`, `postcss`, `autoprefixer`, `vitest`, `fake-indexeddb`, `@preact/preset-vite`. Nothing is loaded at runtime from the network.

## 6. Error handling

- Interceptor failures are swallowed so X is never broken by the extension; a counter of dropped or malformed payloads is visible in settings.
- Normalizer skips malformed entities individually and never throws on a whole response.
- Active client errors are typed (`RateLimited`, `Unauthorized`, `StaleQueryId`, `Network`, `GraphQL`) and surface as a status line in settings and a toast for user-initiated actions only. Background jobs never toast.
- Dexie open failures (private mode, quota) put the sidebar in read-only mode with a clear empty state instead of crashing.
- Empty states for every page explain what data is missing and what the user can do (for example, open your profile once so the first tweets are captured).

## 7. Verification and acceptance criteria

Automated:

1. `vitest` unit suites pass for normalizer (against fixtures of `UserTweets`, `UserTweetsAndReplies`, `TweetDetail`, `SearchTimeline`, `HomeTimeline`, `ListLatestTweetsTimeline`, `UserByScreenName`, including 2025 `core.screen_name` layouts), analytics formulas, query id registry precedence, rate-limit decisions, and message guards.
2. `tsc --noEmit` and the Vite build succeed.
3. The build test fails if any host other than `x.com`, `twitter.com`, `twimg.com` appears in `dist/`.

Manual, with the unpacked extension loaded in Chrome 153:

4. Opening `x.com` shows the toggle within 2 s and the sidebar renders Home without a spinner that waits on the network.
5. Visiting the own profile populates Tweets passively; the backfill job then extends the history without any request leaving x.com (verified in DevTools Network with the third-party filter).
6. After one day, Activities totals for impressions, likes, replies and retweets over the last 7 days match X's own analytics page within 5 percent.
7. Rotating a query id (by editing the seed to an invalid value) is self-healed after X performs the same operation once.
8. Like, retweet and bookmark from the sidebar are reflected on X after a reload.
9. Poster export produces a 2x PNG in all 16 styles in both dark and light themes.
10. Delete all data empties the `xlytics` database and the sidebar returns to its first-run empty states.

## 8. Deliberate differences from SuperX

Fixed: UTC bucket labels on local buckets, the emoji regex that counts digits and `#`, follower deltas clamped at zero, cursor detection by position, absence of HTTP status handling, and settings stored in the `localStorage` X shares. Added: worst tweets, engagement rate, text-only media category, negative follower deltas, data export and delete. Removed: everything that needs a server.

## 9. Risks

- X may start enforcing `x-client-transaction-id` on read endpoints for logged-in sessions. SuperX does not compute it either. If that happens, the active jobs fail with 404 and the extension degrades to passive-only, which still works; computing that header is a possible follow-up, not part of v1.
- Passive capture depends on the interceptor running before X's bundle. `document_start` in the MAIN world guarantees this in Chrome 111 and later.
- IndexedDB quota on very active accounts: the retention window and the exclusion of media binaries keep the database in the tens of megabytes.
