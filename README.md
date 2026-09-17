# x-lytics

Fully local X (Twitter) analytics sidebar for Chrome. It reproduces the local parts of the SuperX extension (analytics, best and worst posts, mentions inbox, custom timelines, quick actions, shareable posters) without any third-party server: the extension only ever talks to `x.com`, and a build test enforces it.

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
