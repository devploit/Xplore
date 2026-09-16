# SuperX 0.8.6: Bootstrap and UI Architecture

Sources: `superx/js/content.pretty.js` (content script, 332k lines), `superx/js/listener.pretty.js` (page-context script, 10k lines), `superx/manifest.json`. Line references are `content.pretty.js:N` unless prefixed with `listener.pretty.js:`. Module numbers are webpack module ids (`NNNNN: function (e, t, r)`), which survive minification and are the most stable way to refer to code.

## 0. Manifest summary

- MV3, no background service worker, no `permissions`, no `host_permissions`. Everything runs from a single content script (`manifest.json`).
- `content_scripts[0]`: `js/content.js`, matches `https://twitter.com/*`, `https://x.com/*`, `https://pro.x.com/*`, `https://pro.twitter.com/*`, `run_at: document_end`.
- `web_accessible_resources`: `js/listener.js` plus images (`ai-bot-placeholder.png`, `engage-cta.webp`, `x-account-switcher-check.webp`, `feature-*.webp`), matches `*://*/*`.
- No `chrome.storage`, no `chrome.runtime.sendMessage/onMessage` anywhere in the bundle (grep returned nothing). The only `chrome.*` API used is `chrome.runtime.getURL` (content.pretty.js:170143, 212744-212746, 267214).

## 1. Entry point and boot sequence

### 1.1 Webpack entry

The webpack runtime at the bottom of the bundle invokes `a(37036)` (content.pretty.js:332210). Module **37036** (content.pretty.js:212621-212748) is the real entry. It does, in order:

1. `installCustomElementsRegistryShim()` (module 57339): polyfills `window.customElements` if missing (content.pretty.js:212659, definition at the `57339:` module). Harmless on Chrome.
2. `r(51444)`: **mounts the React app** (see section 3).
3. Imports 72480 (page-to-content DOM data stream reader), 98827 (`XDatabase` singleton), 7932 (`stream`), 36410 (SuperX API client).
4. Registers `XDatabase.addListener("insert", ...)` which forwards inserts to `stream()` (content.pretty.js:212667-212672). `stream()` is a no-op that resolves immediately (content.pretty.js:170281-170295), i.e. the old "push scraped data to server" path is disabled in this build.
5. Registers a `window.addEventListener("message")` handler for `AI_REPLY_DETECT_REQUEST` / `TWEET_SCORES_REQUEST` / `FETCH_USER_SCORES` (content.pretty.js:212673-212742), see section 2.
6. Injects `js/listener.js` into the page (content.pretty.js:212743-212747), see section 2.

### 1.2 X detection

There is no explicit "am I on X" check; the manifest match patterns do that. The only guard at boot is `if (!window.location.pathname.startsWith("/i/oauth2"))` (content.pretty.js:244860). `twitterDomain = document.location.host` (content.pretty.js:215819) is used to build X internal API URLs, so it works identically on `x.com` and `twitter.com`.

### 1.3 When the sidebar appears

The sidebar host `div#__x_vision__` is appended to `document.body` **synchronously at document_end**, before any login detection (content.pretty.js:244880-244890). Visibility is then decided by React state:

- `AppContextContainer` initial `visible = !shouldPathHidden(pathname) && appProps.visible` (content.pretty.js:185067-185068). `appProps.visible` defaults to `true` (content.pretty.js:215804) and is persisted when the user closes/opens the panel (`setVisible` -> `updateAppProps({visible})`, content.pretty.js:185105-185107).
- `App` (module 82633, content.pretty.js:298618-298696) renders either the full sidebar (module 96913) or a 40x40 fixed orange flame **toggle button** at `top-3 right-5` when hidden (content.pretty.js:298657-298666).
- On every route change `App` re-evaluates: `shouldPathVisible()` always returns `false` (content.pretty.js:240376-240378, dead switch); `shouldPathHidden()` hides the panel on `oauth/`, `messages`, `account`, `settings`, `i/premium_sign_up`, `i/oauth2`, `i/flow`, `i/report`, `i/safety`, `i/list`, `i/chat`, `compose`, `i/foundmedia`, `search-advanced`, `i/grok`, on `/video/N` or `/photo/N` viewers, and on `/header_photo` and `/analytics` (content.pretty.js:240379-240387). Otherwise it restores `visible` from appProps (content.pretty.js:298647-298655).
- On viewport `< 1107px` (`appSize === "sm"`) the panel force-hides on resize (content.pretty.js:185098-185104, breakpoints at 185159-185162: sm `<1107`, md `<1295`, lg `<1405`, else xl).

The sidebar itself renders a spinner until the SuperX auth client reports `loaded` (`if (void 0 === n) return spinner`, content.pretty.js:329245-329249 and 212858-212862). SuperX auth init races `/auth/me` against a 15 s timeout (content.pretty.js:211085-211090), so worst case the panel unblocks after 15 s with `user: null`.

### 1.4 Logged-in user detection (screen_name, user id)

There is **no** `twid` cookie parsing and no DOM scraping of the account switcher. `document.cookie` is read only for `ct0` (CSRF) when calling X GraphQL directly (content.pretty.js:182685-182693 `getCookies`, used at 195396 and in module 66083 at 279445/279487). The user identity comes from four sources, in this order of precedence:

1. **SuperX account** (primary): `localStorage["__superX__ak"]` holds `{token, user, ...}` (authKey defined content.pretty.js:266459 and 298609). On boot module 36410 reads it, sets `this.user`/`this.__token`, then calls `GET https://api.superx.tools/auth/me` which returns `profile` (with `screen_name`), `subscription`, `settings`, etc. (content.pretty.js:211078-211165). `AuthContext` (module 20609, content.pretty.js:185525-185700) and `AppContextContainer` copy `profile` into `appProps.user` and `appProps.screen_name` (content.pretty.js:185069-185093). If the profile lacks `screen_name` but has `uid`, it calls SuperX `GET /pull/1.2/user?type=id&value=<uid>` (content.pretty.js:185083-185090).
2. **URL**: `getUsernameFromURL()` takes the first path segment unless it is one of `messages,i,home,explore,settings,search,notifications,compose,twitter` (content.pretty.js:240360-240374). The layout (module 84932) resolves the profile being viewed via SuperX `/pull/1/user?screen_name=` and falls back to X GraphQL `UserByScreenName` (module 82209, content.pretty.js:298574-298617, queryId `xWw45l6nX7DP2FKRyePXSw`) (content.pretty.js:300640-300665).
3. **X's own localForage store**: when no URL username and no cached user, it lists keys of the default localforage instance (IndexedDB `localforage/keyvaluepairs`, shared with X's web app because the content script runs in the page origin) and picks the first key starting with `user:`; the second colon-separated segment is the X user id, which is then resolved via `UsersByRestIds` (content.pretty.js:300658-300665). `XDatabase.getRecentSearches/setRecentSearches` likewise read/write X's own key `user:<uid>:rweb.recentSearches` (content.pretty.js:330603-330616).
4. **Passive**: `XDatabase.insertUsers()` sets `appProps.user` when a user with `screen_name === appProps.screen_name` passes through the insert pipeline (content.pretty.js:170476-170489).

`XDatabase.setScreenName()` exists (content.pretty.js:170491, 330554) but has no callers.

### 1.5 Login flow (SuperX account)

- Login button/anchor points to `https://api.superx.tools/auth/twitter` (content.pretty.js:1314, 301004). OAuth completes by redirecting back to x.com with `?xpayload=<base64 JSON>` (optionally `xpayload-type=uri-encoded`) (`getXPayload`, content.pretty.js:240300-240313).
- The payload object has `{path, payload, error}`. `path` seeds the memory router (`initialEntries: [f]`, content.pretty.js:329251-329268); `/login-success` (module 15519) calls `setAuthPayload(payload, "login")`, refetches `/auth/me`, and strips `xpayload` from the URL with `history.replaceState` (content.pretty.js:182749-182765).
- Route `/login` (module 621) is the marketing/login page.

### 1.6 Route-change detection on X's SPA

`onRouteChange` (module 3514, content.pretty.js:166521-166580) uses `window.navigation` `currententrychange` when available, else polls `location.pathname` every 500 ms; emits `{path, previousPath}` and ignores `i/lists` paths. `document.body.dataset.page` is set to the first path segment (with `i/` stripped) on every change (content.pretty.js:244876-244879), and is consumed by CSS (`.__hcp:not([data-page=settings])`, see 3.4).

## 2. listener.js injection and the page <-> content message channel

### 2.1 Injection

```js
const s = document.createElement("script");
s.src = chrome.runtime.getURL("js/listener.js");
s.dataset.id = o.default.id;                       // random nanoid
s.dataset.placeholderUrl = chrome.runtime.getURL("ai-bot-placeholder.png");
(document.head || document.documentElement).appendChild(s);
```
(content.pretty.js:212743-212747). `o.default.id` is the nanoid created in module 72480 (content.pretty.js:284261-284263). The listener locates itself via `document.querySelectorAll("script[data-id]")` filtered by `src.endsWith("js/listener.js")` and reads `dataset.id` (listener.pretty.js:9800-9807).

### 2.2 Channel A: hidden-div "DOM data stream" (page -> content)

Class in module 81165, present in both bundles (content.pretty.js:296365-296445, listener.pretty.js:9701-9788). Content side constructs it with `installDOMHost: true`, which appends `<div id="<nanoid>" style="display:none">` to `document.body` (content.pretty.js:296420-296423). Page side (`installDOMHost` undefined) finds the same div by id. Writer appends JSON records separated by `"\r\n\r\n"` to `textContent`; reader polls every 1000 ms, uses `data-locked="true"` as a mutex, drains and `JSON.parse`s each record (content.pretty.js:296370-296417). Only one payload shape is written: `{inserts: {tweets|users|notifications: [...]}}` (listener.pretty.js:9808-9810), consumed by 72480 which merges and forwards to the no-op `stream()` (content.pretty.js:284264-284278).

**Important**: in this build the listener never actually produces inserts. Its transform functions (`transformUserTweetsAndReplies`, `transformMentions`, `transformSearchTimelineData`, `transfromTweetDetail`, `transformUserTweetsData`, `transformUsersByRestIds`, `transformExploreTweets`) are defined (listener.pretty.js:4898-5030, 535-600, 9839-9979) but grep finds no call sites, and there is no `fetch`/`XMLHttpRequest` monkey-patch anywhere in listener.js. The network interception design is vestigial; live data comes from the content script calling X GraphQL directly (section 1.4) and from api.superx.tools.

### 2.3 Channel B: `window.postMessage` with `caller: "__x__"` (content -> page)

The page-side listener (listener.pretty.js:9822-9838):

```js
window.addEventListener("message", ({ data: e, origin: t }) => {
  if (t === location.origin && "object" == typeof e && "__x__" === e.caller)
    switch (e.type) {
      case "push":    window.__xRouter ? window.__xRouter.push(e.value)    : (window.location.href = e.value); break;
      case "replace": window.__xRouter ? window.__xRouter.replace(e.value) : (window.location.href = e.value);
    }
});
```

`window.__xRouter` is captured by a trap on `Object.prototype.history` (listener.pretty.js:9811-9821): any object that gets a `history` property assigned with a `replace` method (React Router's internal history used by X's SPA) is saved to `window.__xRouter`. This gives the extension in-SPA navigation of X without reloads.

Senders in content: `navigate()` in module 90975 (`window.postMessage({caller:"__x__", type:"push", value})`, content.pretty.js:318536-318538, also exposed via `useNavigate` context and the `Link` component at 263675-263705), search popup (`window.parent.postMessage(... "push" ...)`, content.pretty.js:274496, 274869), and a tweet-link handler (content.pretty.js:298387). `type: "replace"` is handled by the listener but no content-side sender was found.

### 2.4 Channel C: `window.postMessage` request/response for SuperX API proxying (same-context)

Content handler at content.pretty.js:212673-212742 accepts `e.source === window` and forwards to api.superx.tools with the bearer token:

| Request type | Endpoint (POST, `includeToken`) | Response type |
|---|---|---|
| `AI_REPLY_DETECT_REQUEST` | `/tools/detect-ai-reply` | `AI_REPLY_DETECT_RESPONSE` |
| `TWEET_SCORES_REQUEST` | `/tweets/scores` | `TWEET_SCORES_RESPONSE` |
| `FETCH_USER_SCORES` | `/users/scores` | `USER_SCORES_RESPONSE` |

Message shape: request `{type, requestId, payload}`; response `{type, requestId, success, data}` or `{type, requestId, success:false, error, errorDetails:{name,message,type,endpoint}}`. No sender for these request types exists in listener.js or content.js (grep), so this bridge is also dormant in 0.8.6 (likely intended for a future/legacy page-side AI-reply badge feature; `aiReplyEnabled`, `userViewSettings.aiReplies_*` defaults exist at content.pretty.js:215806, 267717).

### 2.5 Window `CustomEvent`s (content-internal)

- `superx-refresh-data` (dispatched content.pretty.js:300724 after `/extension/auto-refresh`; listened 300819) forces a re-fetch of `/pull/1.2/activity`.
- `superx-set-period` with `detail.periodDays` (listened 300832) changes the analytics period.

### 2.6 Complete list of message/event type constants found

`push`, `replace` (caller `__x__`); `AI_REPLY_DETECT_REQUEST`, `AI_REPLY_DETECT_RESPONSE`, `TWEET_SCORES_REQUEST`, `TWEET_SCORES_RESPONSE`, `FETCH_USER_SCORES`, `USER_SCORES_RESPONSE`; CustomEvents `superx-refresh-data`, `superx-set-period`; DOM-stream record key `inserts`. Enum `Events {SayHello=0, PopupShow=1}` and `AppConfig.frameId = "ext-frame"` exist (content.pretty.js:173670-173676, listener.pretty.js:302-321) but are unused (no iframe is created; grep for `createElement("iframe")` in app code is empty). Internal EventEmitter names on the SuperX auth client: `loaded`, `initiate`, `change` (`type: loaded|initiate|login|logout|unset|subscription_refresh`), `logout` (content.pretty.js:211096-211170, 211269-211285).

## 3. UI mounting, CSS isolation, theme, positioning

### 3.1 Host element and React root

Module 51444 (content.pretty.js:244843-244891):

```js
const v = document.createElement("div");
v.id = "__x_vision__"; v.className = "__x_vision__";
m && document.body.classList.add("__hcb");   // hideChatbox
h && document.body.classList.add("__hsb");   // isHideSidebar
p && document.body.classList.add("__ctmc");  // isCloseToMainColumn
document.body.appendChild(v);
g(v);  // style: zIndex 9999, position relative, pointerEvents none; createRoot(v).render(<Provider><AuthContext><AppContextContainer><App/></...>)
```

- **No shadow DOM, no iframe.** The React 18/19 root (`createRoot` from module 5338) is a plain `div#__x_vision__` appended to `document.body` with `pointer-events: none`; interactive children opt in with `pointer-events-auto` (content.pretty.js:329281, 329315).
- Additional React roots are created for X-page integrations: `.__x_vision_ai_reply__` in composer toolbars (content.pretty.js:267790-267800), `.__x_vision_add_contacts__` on profile pages (content.pretty.js:215032-215048), a body-level consent/modal host `div.xi.__x_vision__` (content.pretty.js:271157-271163), and a transient body-level prompt root (content.pretty.js:214672-214688).
- Portals: `<div id="__x_vision_portal__">` inside the sidebar (content.pretty.js:329303-329308); `getPortalRoot()` falls back to `document.body` (module 11951). Tooltip container is `#__x_vision__` (content.pretty.js:329294-329298).
- Provider tree: module 90975 (navigation context, posts `push` messages) -> `AuthContext` (20609) -> `AppContextContainer` (19885) -> `App` (82633) -> sidebar (96913). Redux `<Provider store>` is only mounted inside the Compose feature (content.pretty.js:289333), not at the root.

### 3.2 CSS isolation

Tailwind CSS is injected as a `<style>` in `<head>` by style-loader (`insert: "head"`, module 92371 at content.pretty.js:319675-319684; CSS string module 42964 at 219963). Isolation is by **selector scoping, not shadow DOM**: the Tailwind preflight is compiled with `:where(.__x_vision__, .__x_vision__ *)` (content.pretty.js:219971 onward), so resets only apply inside extension roots, and component classes are prefixed with `.xi` for theme rules (`.xi.dim *`, `.xi.light *`, `.xi.dark:not(.dim) *` border colors, `.xi .overflow-y-auto::-webkit-scrollbar` etc.). Every injected root carries `xi __x_vision__ <theme>` classes so the same stylesheet applies.

### 3.3 Theme detection (dark / dim / light)

`getAppTheme()` (module 83882, content.pretty.js:299778-299797):

```js
let e = db.getAppProps().theme;            // user override: "system"|"dark"|"dim"|"light"
if (e && e !== "system") return { theme: e, backgroundColor: appColors[e].background, className: e==="dim" ? "dim dark" : e };
let r = document.querySelector("body").style.backgroundColor;
e = r === "rgb(21, 32, 43)" ? "dim" : r === "rgb(0, 0, 0)" ? "dark" : "light";
```
`appColors = {dark: black, dim: #15202b, light: white}`. The detected background is written to `--superx-bg` on `<html>` (content.pretty.js:298632, 298694-298696) and consumed by `.theme-bg { background-color: var(--superx-bg) }`. `App` re-detects once 5 s after mount if no theme is persisted (content.pretty.js:298637-298640). Changing the theme in Settings persists `appProps.theme` and reloads the page (content.pretty.js:203129). Tailwind dark variants are driven by the `dark` class on the sidebar root (`"dim" === e ? "dark dim" : e`, content.pretty.js:329270-329273).

### 3.4 Positioning relative to X layout

Sidebar root (module 96913, content.pretty.js:329268-329313): `div.xi.fixed.right-0.top-0` containing a `w-[460px] h-screen` column with `border-l`, a fixed "Close" button at `top-[12px] right-0`, and a react-hot-toast `Toaster` (bottom-right).

- **Auto resize** (`isAutoResize`, default true): when `appSize !== "sm"` the root gets `w-[50vw]` and `paddingLeft` by breakpoint `{md:157, lg:250, xl:"calc(50vw - 460px)"}` (content.pretty.js:329398-329403) so the 460px column hugs X's content column.
- **Close to main column** (`isCloseToMainColumn`): instead uses `left: {md:"calc(142px + 50vw)", lg:"calc(235px + 50vw)", xl:"calc(234px + 50vw)"}` (content.pretty.js:329404-329409) and body class `__ctmc`.
- **Hide X sidebar / DM drawer**: body classes toggle CSS `.__hsb [data-testid=sidebarColumn]{display:none}` and `.__hcb [data-testid=DMDrawer]{display:none}` (CSS at content.pretty.js:219971 region, extracted rule text). Settings toggles add/remove `__hsb`/`__hcb` live (content.pretty.js:203311-203327).
- **Super Inbox** (`enableSuperInbox`, body class `__hcp`): `.__hcp:not([data-page=settings]) section[aria-labelledby=root-header]{position:fixed;pointer-events:none;opacity:0}` and `.__hcp section[aria-labelledby=detail-header]{margin-left:0}` hide X's native DM list column so SuperX's inbox can replace it (content.pretty.js:203328-203335 and CSS).
- Pinned/collapsed state is just `appProps.visible` in localStorage; the collapsed state shows the flame toggle button (3.1 / 1.3).

## 4. Routing (react-router memory router)

`createMemoryRouter` with `initialEntries: [xpayload.path || appProps.currentPath || "/"]`; `/messages*` maps to `/messages` (content.pretty.js:329250-329268). Route tree:

```
/login            -> module 621   (login page)            ErrorBoundary 51328
/login-success    -> module 15519 (consume xpayload token)
<Gate 37092>      (spinner until auth loaded; requires SuperX user with subscription status active|trialing|on_trial, otherwise renders paywall/login CTA 72428 or 7597, with inline Settings 32451)
  <Layout 84932>  (tab bar of routes with icon, period dropdown, #x-main scroll container, "Login to see more insights" CTA when no user, upgrade modal)
    t.routes (content.pretty.js:329360-329427):
```

| path | module | nav label | icon | flag (`appProps.*`) | notes |
|---|---|---|---|---|---|
| `/activate-subscription` | 59868 | Subscription created | none | | post-checkout |
| `/` | 65576 | Home | User | `enableHome` | tabs `?tab=best` (Highlights) / `recent` (Recents) (content.pretty.js:274664-274670) |
| `/compose` | 45531 | Compose | ComposeIcon | `enableTweetComposer` | userArea; Redux `schedule` store lives here |
| `/activities` | 25553 | Activities | Chart | `enableActivities` | profile analytics charts |
| `/tweets` | 81022 | Tweets | TableDocument | `enableTweets` | table of tweets/replies/RTs |
| `/engage` | 31432 | Feeds | Messages3 | `enableReplies` | userArea; discover posts to reply to |
| `/replies` | 31432 | Feeds | none | `enableReplies` | alias of `/engage`, not in tab bar |
| `/mentions` | 68436 | Mentions | Notification | `enableMentions` (defaultEnabled) | userArea |
| `/ask` | 23444 | Ask SuperX | MagicStar | `enableAsk` (defaultEnabled) | userArea; AI chat (`/ask/chats` API) |
| `/contacts` | 6694 | Contacts | Profile2User | `enableContacts` (defaultEnabled) | userArea; contact lists + drawer (modules 1306/50537) |
| `/timeline` | 864 | Timelines | Calendar | `enableTimeline` | userArea; custom timelines |
| `/settings` | 32451 | Settings | none | | |
| `/upgrade` | 81346 | Upgrade | none | | |
| `/support` | 51137 | Support | none | | |
| `/subscription` | 90937 | Subscription | none | | |

Only routes with `icon` appear in the tab bar; each is filtered by its `property` flag (content.pretty.js:300906-300915). `userArea` routes redirect to `/` when there is no SuperX user (content.pretty.js:300778-300785). Tab tooltip text is `${name}` plus `" (login required)"`. A `"Social Hub"` badge branch exists (content.pretty.js:300917) but no route has that name (dead). Period dropdown options: Today(0), 7, 14, 30, 60(=59, pro), 90(pro), 180(pro), All time(-1, pro) (`analyticsDateOptions`). Settings feature toggles list (content.pretty.js:203338-203358) mirrors the routes: Home, Composer, Activities, Tweets, Feeds, Mentions, Ask SuperX, Contacts, Timelines. Settings footer links: `https://app.superx.so` ("Explore Web App"), `/subscription`, `mailto:support@superx.so` (content.pretty.js:203220-203222, `docLinks`).

Strings the task asked about that are **not** present as routes: "Overview", "Best tweets", "Scheduler", "Inbox", "Engage" (the tab is labelled "Feeds" with path `/engage`), "Custom timelines" (appears only as a settings description).

## 5. Redux store

Redux Toolkit is present but used for exactly one slice.

- Store: module 10281 (content.pretty.js:175314-175325): `configureStore({ reducer: { schedule }, middleware: default.concat(eventMiddleware) })`. Mounted only inside the Compose feature via `<Provider store>` (content.pretty.js:289333).
- Slice `schedule` (module 75627, content.pretty.js:288943-289020+): `initialState = { scheduledTweets: [], predefinedSlots: [], scheduledTimes: [], nextAvailableSlot: null, selectedTime: null, isLoading: false, error: null, isEditMode: false, editingItemId: null, hasManualSelection: false, manualSelectionTime: 0, deletingIds: [] }`. Reducers seen: `clearSlotsForTimezoneChange`, `setSelectedTime`, `setManualSelection`, `clearManualSelection`, `addScheduledTweet`, `updateScheduledTweet`, plus async thunk `fetchPredefinedSlots` (content.pretty.js:288920-288941). Statuses use `TweetStatus.Scheduled|Draft`.
- `eventMiddleware` (module 13441, content.pretty.js:181336-181400): de-duplicates identical actions within 100 ms, marks `localStorage["queue-dirty-<userId>"] = Date.now()` on add/update, and re-emits actions on the global EventEmitter `events` (module 82821 `t.events`).

All other state is React context: `AppContext` (`appProps`, `visible`, `appSize`, `loaded`, `updateAppProps`), `AuthContext` (`user, subscription, profile, connectedToBsky, connectedToTwitter, bskyUsername, onboardingCompleted, settings, isSharedSession, sharedPermission`), `DataContext` (period, tweets, busy, limit info, fromDate, user, theme, dataMeta, isProBlocked, subscription, refreshKey, fetchError, retryFetch; content.pretty.js:300880-300903).

## 6. Persistence

### 6.1 localStorage (page origin, shared with X)

| Key | Written by | Purpose |
|---|---|---|
| `__X_VISION__PROPS` | `XDatabase.updateAppProps/getAppProps` (content.pretty.js:170499-170508, 330563-330567; also listener.pretty.js:202-211) | The whole settings/state blob: defaults at content.pretty.js:215793-215818 (`isHideSidebar, isAutoResize, hideChatbox, hideOverallActivities, isGraphAccumulate, period:30, visible, tweetInspirationLayout/Type, schedule, isEstimateEarning, isGraphIncludeChangeValue, enable* flags, inboxUserDetailsVisible, popupConsentGiven, userViewSettings.aiReplies_*`) plus runtime keys `appVersion (2024052301)`, `user`, `screen_name`, `currentUser`, `currentPath`, `theme`, `limit` (X rate-limit headers), `requestQueue`, `requestLog`, `lastOpen`, `composerCurrentTweetId`, `isCloseToMainColumn`, `isRevenueIndividualPostVisible`, `addToContactsEnabled`, `integratedPostEmojiEnabled`, `superXDevelopment`, `upgradeModal*`, `onboardingCompleted`, engage keys (`discoverFeeds, activeDiscoverFeedId, discoverKeywords, discoverQuery, engageReplyRules, engageIncludeAuthorName`, content.pretty.js:185044-185051) and composer setting keys. Removed on logout/switch account (content.pretty.js:211268, 211383). |
| `__superX__ak` | module 36410 `__setAuthPayload` (content.pretty.js:211276-211281) | SuperX auth `{token (JWT with uid/mainUid/isSharedSession/sharedPermission), user, ...}`. Read by `getAuthPayload()` (content.pretty.js:268646-268649). |
| `engage-lists-state` | engage feature | Removed on logout / account switch (content.pretty.js:211270, 211384) |
| `queue-dirty-<userId>` | eventMiddleware (content.pretty.js:181353) | schedule queue dirty marker |
| `superx_ai_chat_current_id` | module 5316 (content.pretty.js:167467-167510) | current Ask chat id |
| `__superx_ask_model` | content.pretty.js:216873 | selected AI model |
| `__x_vision_ai_reply_consent_<userId>` | content.pretty.js:271127-271131 | AI reply consent |
| `__x_vision_superx_discover_explainer_v1` | content.pretty.js:202083, 202368 | one-time explainer dismissed |
| `showMoreGuide` | content.pretty.js:243306, 326104 | composer "show more" guide toggle |
| `superx_search_popup_<ts>` | content.pretty.js:274803 | search popup window name (not storage) |

sessionStorage: `engage-lists-state`, `composerDraft` (content.pretty.js:211385-211386), plus minified-key entries in the composer.

### 6.2 IndexedDB (Dexie) `XDatabase`

Module 7935 (content.pretty.js:170300-170430; same schema in listener.pretty.js:3-140). Versions 4 to 110; current stores: `queues: "userId,screen_name,created,hit"` (users to background-fetch), `tweetQueues: "id,created,type"`, `converstaions: "conversation_id,create_time,sort_timestamp,created_by_user_id,type,muted,trusted,notifications_disabled"` (sic), `tweets: "++id,created_at,user_id_str,quote_count,retweet_count,reply_count"`, `users: "++id,x_user,uid,name,created_at,following,followers_count"`. `insertTweets/insertUsers` `bulkPut` into these tables and emit `insert` events (content.pretty.js:170468-170489). `followerTrackers` and `notifications` tables were dropped in v9.

### 6.3 localForage (default instance = X's own `localforage` DB)

Used read/write for `user:<uid>:rweb.recentSearches` (content.pretty.js:330603-330616) and read-only `keys()` to discover the logged-in uid (content.pretty.js:300658-300663). No custom `createInstance`/`config({name})`, so this is X's store.

### 6.4 chrome.storage

Not used.

## 7. DOM integration with X

Selectors relied on (all in content script):

- `[data-testid="primaryColumn"]` : MutationObserver root for composer/profile watchers (content.pretty.js:267843-267849, 215062-215070); reply-target article lookup (267741).
- `#layers` : X's modal layer, observed for composer dialogs (content.pretty.js:267737, 267855-267860).
- `[data-testid="tweetTextarea_0"]` : X compose box (contenteditable). Used to attach the AI reply button and for programmatic posting (content.pretty.js:267760, 302662-302668).
- `[data-testid="toolBar"]` : compose toolbar; the AI-reply root `.__x_vision_ai_reply__` is appended to its first child (content.pretty.js:267763-267790).
- `article`, `[data-testid="tweetText"]`, `[data-testid="User-Name"]` : scrape the tweet being replied to (text, author, quoted tweet, up to 2 context tweets) for the AI reply payload (content.pretty.js:267735-267751, 267805-267830).
- `[aria-modal="true"], [role="dialog"]` : reply dialog scope (267739).
- `[data-testid$="-follow"], [data-testid$="-unfollow"]`, `[data-testid="userActions"]` : profile header row detection for the "Add to Contacts" button; walks up to the flex-row container and inserts `.__x_vision_add_contacts__` after it (content.pretty.js:214977-215035). Profile pages are detected by regex `^/([A-Za-z0-9_]{1,15})/?$` minus a reserved-word set (`home, explore, notifications, messages, i, settings, search, compose, jobs, lists, bookmarks, communities, premium, verified-followers, hashtag, intent, share, about, tos, privacy`) (content.pretty.js:214930-214952, 214968-214973).
- `[data-testid=sidebarColumn]`, `[data-testid=DMDrawer]`, `section[aria-labelledby=root-header|detail-header]` : hidden via CSS body classes (3.4).
- `[aria-label=Post]` and Tailwind-like X class chain `.r-6koalj.r-eqz5dr.r-42olwf.r-z2wwpe.r-1phboty.r-d045u9` (drop zone) : `postFile()` automation opens X's composer, clears it with synthetic Backspace `KeyboardEvent`s, pastes text via a synthetic `ClipboardEvent("paste")`, then drops an image via `DragEvent("drop")` (content.pretty.js:302647-302714). Used to share analytics screenshots as posts.
- `document.body.style.backgroundColor` : theme detection (3.3).

Injection strategy: `waitUntil()` polling (200 ms) for the anchor element, then a `MutationObserver({childList, subtree})` debounced 500 ms re-runs the injector; each injector keeps a registry `[{container, root}]` and unmounts roots whose container/composer is disconnected (content.pretty.js:267720-267733, 214917-214926). Both integrations are gated on a SuperX login (`getAuthPayload()`), on `intergratedAppProps.aiReplyEnabled !== false` / `addToContactsEnabled !== false` (content.pretty.js:267717, 214921), and re-run on `onRouteChange`.

There is **no per-tweet quick-action button injection** into timeline `article`s in this version (no `data-testid="tweet"`, `like`, `retweet`, or `caret` selectors), and no hook on X's compose "Post" click beyond the automation above. `integratedPostEmojiEnabled` ("Post emoji reaction, developer only") is only a settings toggle; no consumer was found.

## 8. Third-party libraries identified in app code

React 18/19 (`createRoot`), react-router (memory router, `NavLink`, `Outlet`, `useSearchParams`), Redux Toolkit + react-redux, Dexie, localforage, react-hot-toast (`Toaster`), Chart.js, dayjs (+tz), zod, nanoid, jsonpath (`45615`), html-to-image (`toBlob/toPng`), react-markdown/remark, heic2any, floating-ui, iconsax icons (`1319`).

## Uncertainties

1. **listener.js live behavior**: I found no call sites for its transform functions and no `fetch`/XHR patch. I am confident interception is dead in 0.8.6, but a runtime check (breakpoint on `dbCore.insertTweets` in the page context) would confirm it never fires.
2. **`AI_REPLY_DETECT_REQUEST` senders**: none found in either bundle by grep; possibly sent by an older listener build or by a web app page. Treat channel C as reserved.
3. **`type: "replace"` sender**: handled by the listener but no content sender was located.
4. **X GraphQL query ids** (`p9sOCF1tLh4KfPWtt4TNGQ/UserTweets`, `xWw45l6nX7DP2FKRyePXSw/UserByScreenName`) and the hardcoded `x-client-transaction-id` fallback (content.pretty.js:195334) are version-specific; details belong to the API report.
5. **Exact behavior of `__hcp`/Super Inbox**: the toggle `enableSuperInbox` exists in the body-class map (content.pretty.js:203328) but I did not locate its settings UI row; it may be set from the Mentions/Inbox feature.
6. **`pro.x.com`**: matched by the manifest but no code path special-cases it; behavior there is untested.
7. **Redux store ownership**: `r(10281)` is also required at content.pretty.js:176688, 205583, 290231; I only verified the Provider mount at 289333 (Compose). Other usages may dispatch directly to the singleton store.
8. **Theme re-detection**: only a single 5 s re-check after mount was found; if the user switches X's theme mid-session without a persisted `theme`, the panel may stay stale until reload (not verified at runtime).
9. Line numbers refer to the prettier-formatted files in the scratchpad; re-prettifying with a different version will shift them.
