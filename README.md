# x-lytics

Fully local X (Twitter) analytics sidebar for Chrome. It reproduces the local parts of the SuperX extension (analytics, best and worst posts, mentions inbox, custom timelines, quick actions, shareable posters) without any third-party server: the extension only ever talks to `x.com`, and a build test enforces it.

## Features

- **Home**: highlights (top posts by likes) and recents for the selected period.
- **Activity**: frequency heatmap with posting streak, engagement cards (impressions, tweets, likes, retweets, replies, bookmarks) with period change and share, engagement rate, earnings estimate, weekday by hour impressions heatmap, post types, followers, and insights: best times to post, hashtags that work, length versus performance.
- **Posts**: sortable table with colored metric columns, tabs for tweets, replies, retweets, best and worst, text search and totals.
- **Mentions**: replies and quotes to you with filters (minimum likes, retweets, impressions, followers, verified, hide replied) and top or latest sort.
- **Feeds**: custom timelines from an X list, a user or a search (with presets), plus "worth replying to": posts from your own timeline gaining engagement fastest in the last 24 hours.
- **Profile**: appears when you open any profile on X; analyses that account from what has been captured, with a one-click fetch of its last 90 days.
- **Posters**: share any chart as a PNG with 16 background styles.
- **Settings**: theme (follows X, blue accent in Dim), panel width, compact cards, page toggles, retention, export and delete, X rate limits and background sync status. Alt+X toggles the panel.

## How it works

- `interceptor.js` (MAIN world, `document_start`) observes the GraphQL responses X itself loads and forwards them to the sidebar. It also learns the query ids X currently uses.
- `sidebar.js` (isolated world) stores everything in IndexedDB (`xlytics`), runs throttled background syncs of your own posts with your session, computes the analytics locally and renders a Preact UI in a shadow root.
- No `permissions`, no `host_permissions`, no background worker, no telemetry.

Design: `docs/superpowers/specs/2026-09-16-x-lytics-local-extension-design.md`. Reverse-engineering notes on SuperX: `docs/research/`.

## Build and load

```bash
npm install
npm run verify      # typecheck, unit tests, build, bundle guard
```

Then in Chrome open `chrome://extensions`, enable Developer mode, click "Load unpacked" and select the `dist/` folder. Open `https://x.com`; the sidebar appears on the right. Visit your profile once so your posts are captured immediately; the background sync starts 15 seconds after load.

## Development

```bash
npm run test:watch
npm run dev         # rebuilds sidebar.js on change; reload the extension in chrome://extensions
```
