<p align="center">
  <img src="public/icons/logo.png" alt="Xplore logo" width="160">
</p>

<h1 align="center">Xplore</h1>

<p align="center">Analytics for your X (Twitter) account, shown in a side panel right inside x.com.</p>

Everything runs in your browser. Xplore never sends your data to any server other than x.com itself. No account, no subscription, no telemetry.


## What you get

- **Home**: your best and most recent posts for the chosen period.
- **Activity**: impressions, likes, replies, followers, posting heatmaps, best times to post.
- **Posts**: every post in a sortable table, with tabs for best and worst.
- **Mentions**: replies and quotes to you, with filters to find the ones worth answering.
- **Feeds**: custom timelines from a list, a user or a search, plus a reply radar: fresh posts from bigger accounts where a reply still gets seen, and a daily reply goal.
- **Sniper**: open anyone's profile on X, or type a handle in the tab, and get the same analytics for that account over the period you select. Data loads on demand and the tab says how many days are covered.
- **Post detail**: click the chart icon on any of your posts for its counters, its first 48 hours and the replies it got.
- **Threads**: your threads grouped as one, with the reach of the whole thread and of the first post.
- **Compare**: draw the previous period as a dashed line behind every chart.
- **Growth**: what brought you followers (your posts, your replies, or someone mentioning you), which accounts your replies reach the most, and old posts worth bringing back.
- **Weekly report**: a shareable poster with your last seven days.
- **Posters**: share any chart as an image.

Press `Alt+X` at any time to show or hide the panel.

## Install

You need Google Chrome or any Chromium browser such as Brave, Edge or Arc. No technical knowledge is required and it takes about two minutes.

### 1. Download

Go to the [Releases page](../../releases/latest) and download the file named `xplore-vX.Y.Z.zip`. Unzip it. You get a folder called `xplore-vX.Y.Z`; keep it somewhere you will not delete, for example in Documents. Chrome loads the extension from that folder every time it starts.

### 2. Load it in Chrome

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (switch in the top-right corner).
3. Click **Load unpacked**.
4. Select the unzipped `xplore-vX.Y.Z` folder.

Open [x.com](https://x.com). The Xplore panel appears on the right. Visit your own profile once so your posts are picked up right away.

Chrome will show a "Disable developer mode extensions" notice on startup because the extension was not installed from the Chrome Web Store. Close it; the extension keeps working.

## Updating

Download the new zip from the Releases page, unzip it, then in `chrome://extensions` click **Remove** on the Xplore card and **Load unpacked** again with the new folder. Your data stays: it lives in the browser, not in the extension folder.

## Troubleshooting

- **The panel does not appear**: reload the x.com tab. If it is still missing, press `Alt+X`, or check in `chrome://extensions` that Xplore is enabled.
- **"npm: command not found"**: Node.js is not installed or the terminal was opened before installing it. Close the terminal, install Node.js, and open a new one.
- **No data yet**: Xplore only sees what X loads while you browse. Visit your profile, scroll a bit, and give the background sync a minute.

## Privacy

Xplore only talks to x.com using your existing session. Your data lives in your browser's local storage and never leaves it. You can export everything as JSON or CSV, or delete it, from the Settings page. An automated test on every build verifies the extension contains no other network destinations.

Xplore never posts on your behalf. The pencil button and the reply buttons open X's own composer.

## For developers

Building from source needs [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
npm run build        # produces dist/, load it with "Load unpacked"
npm run dev          # rebuild on change, then reload the extension in chrome://extensions
npm run test:watch   # unit tests
npm run verify       # typecheck, unit tests, build, bundle guard
npm run package      # verify-ready zip in release/, the same file a release ships
```

Releases are automated: bump `version` in `manifest.json` and `package.json`, commit, tag it `vX.Y.Z` and push the tag. The workflow in `.github/workflows/release.yml` runs the checks, zips `dist/` and publishes the GitHub release with the zip attached.

- `interceptor.js` runs in the page and forwards the GraphQL responses X loads to the sidebar.
- `sidebar.js` stores everything in IndexedDB, computes the analytics locally and renders the Preact UI in a shadow root.

Design notes: `docs/superpowers/specs/2026-09-16-xplore-local-extension-design.md` and `docs/superpowers/specs/2026-09-18-xplore-v2-improvements-design.md`.

## How it works without the X API

X's official API costs money and its free tier does not cover analytics. Xplore does not use it. It works the way your browser already works when you use x.com.

**1. It watches what X already loads.** When you scroll your profile, open a post or check notifications, the X web app asks its own servers for that data and gets JSON back. The first part of Xplore runs inside the page and quietly reads those responses as they arrive. Nothing extra is requested: it is the same data your screen is about to show, saved before it disappears.

**2. It asks X the same way X asks itself.** For the parts you would not load by browsing (your posts from months ago, the latest replies to you, a fresh count of your followers) Xplore repeats the exact calls the X web app makes, from the same tab, with the cookies you are already logged in with. To X, it looks like you opened your profile and scrolled. Xplore does this sparingly: a couple of pages every half hour to refresh recent posts, a slow walk back through your history, never more than half of any rate-limit window, and it stops the moment X asks it to slow down.

**3. It learns the details from X itself.** These internal calls use identifiers that X changes from time to time. Instead of hardcoding them, Xplore notes the ones X is currently using while you browse, and uses those. When X changes something, Xplore picks up the new version the next time you load a page.

**4. It keeps everything in your browser.** Posts, counters, follower snapshots and hourly metric snapshots of your recent posts are stored in IndexedDB, a database built into Chrome. The charts, the best times to post and the rest are computed locally from that store. There is no Xplore server, so there is nothing to sign up for and nothing that can leak.

**What this means in practice.**

- Xplore only sees what you could see yourself on X, logged in as you.
- It needs an X tab open to collect anything. Close the tab and it simply waits.
- History fills in gradually. The first day loads up to a year of posts; the curves of a post's first 48 hours only exist for posts published after you installed Xplore.
- It follows X's rate limits and never posts, likes or follows on its own. The like, retweet and bookmark buttons act only when you click them, exactly like the ones on X.
- This relies on X's internal web interface, which X can change at any time. When that happens a feature may pause until Xplore is updated.

## FAQ

**Where is my data stored, exactly?**
In IndexedDB, the database built into Chrome, inside your Chrome profile and under the `https://x.com` origin. The database is called `xlytics`, a name kept from the first version. There is no Xplore server, nothing is written to the extension folder and nothing is synced to your Google account. On disk it lives in Chrome's profile directory, for example `~/Library/Application Support/Google/Chrome/Default/IndexedDB/https_x.com_0.indexeddb.leveldb/` on macOS or `%LOCALAPPDATA%\Google\Chrome\User Data\Default\IndexedDB\https_x.com_0.indexeddb.leveldb\` on Windows. It is Chrome's internal format, not meant to be read by hand; to inspect it, open x.com, open DevTools, go to Application, IndexedDB, and look for `xlytics`.

**What is in there?**
Your posts and the posts of accounts you have seen, with their counters. Profiles that were captured, with follower counts and avatar. Your follower count each time X reported it while you browsed, a daily snapshot of it, and hourly metric snapshots of your recent posts. The feeds you created, the panel settings, and technical bookkeeping: the query identifiers X currently uses, rate limits and the state of background loads.

**What is not in there?**
Cookies, session tokens or passwords. Xplore uses the X session your browser already has when it makes a request, but never copies it anywhere.

**Does anything leave my computer?**
No. The only network destination is x.com, using your own session. Every build runs a test that fails if the bundle mentions any other host.

**Can I get my data out, or delete it?**
Yes. Settings has Export JSON (everything), Export CSV (your posts, one per row) and Delete all data. Clearing site data for x.com in Chrome also wipes it. Other people's posts are deleted automatically after 90 days by default; you can change that in Settings. Your own posts are never deleted automatically.

**If I reinstall or update the extension, do I lose my data?**
No. The data belongs to x.com in your browser, not to the extension folder. Removing the extension card in Chrome and loading the new folder keeps everything.

**Does it work on my other computer or in another browser?**
No. Each Chrome profile has its own database, so another machine, another profile or an incognito window starts from zero. Use Export JSON if you want to keep a copy.

**I use several X accounts. Does it mix them up?**
No. Your own analytics are tied to the account logged in on the tab, so each account sees its own posts. Captured posts from other people are shared between accounts, which is harmless.

**Could X ban my account for using this?**
Nobody can promise zero risk with a tool X did not sanction, so here is exactly what Xplore does instead of a promise. It never posts, follows, likes or retweets on its own; the only writes are the like, retweet and bookmark buttons, one request per click. Everything it reads is either data X already sent to your browser or the same requests the X web app makes, sent from the same tab with your own session. Those requests are throttled harder than X requires:

- Never more than half of any rate-limit window is used, so X's own web app always has room. When X answers with a rate limit, the job stops instead of retrying.
- A hard ceiling of 20 requests per minute across everything, enforced locally before any request leaves the tab.
- Pages are fetched two seconds apart, with a fifteen-second pause every six pages.
- Background work: a refresh of your two newest pages at most every 30 minutes whatever the number of tabs, an unfinished history walk resuming at most every 30 minutes, one follower check a day, and a mentions search at most every 10 minutes when that tab is open (once a minute if you press Refresh repeatedly).
- Manual loads are bounded too: a Sniper click fetches at most six pages, a feed click one page.

Tools with this profile have run for years without account actions. If it still worries you, keep the panel closed most of the time: passive capture alone makes no extra requests.

**Why does Chrome warn about Developer mode?**
Because the extension is not installed from the Chrome Web Store. The notice is cosmetic; close it and the extension keeps working.

**Why do my numbers differ from X Analytics?**
Xplore only counts posts it has captured, and each counter is the value X reported the last time that post was loaded. X Analytics counts on its own servers, includes posts you never scrolled past and updates continuously. Expect the same shape, not the same digits.

**Why does the Sniper tab say "Partial data"?**
Because it only has posts back to a certain date for that profile. Stats are computed over the loaded days only, hatched days in the heatmap are unknown rather than empty, and Load more fetches further back. Pick a shorter period if you want a complete picture quickly.

**Why does Best times say "Based on single posts"?**
Best times prefers weekday and hour slots with at least two posts, so one viral post cannot crown its hour. When too few slots qualify it falls back to single posts and tells you. A longer period fixes it.

**How does "What brought followers" work?**
Every time X reports your follower count while you browse, Xplore notes it. Each change between two notes is split among everything that put your name in front of people in the previous 24 hours: your posts, your replies, and other people's posts that mentioned you, quoted you or replied to you, in proportion to their impressions. It is an estimate: it says what coincided with growth, not what caused it. It only knows about changes that happened while you had X open, and only about mentions and quotes X loaded in your browser.

**Why is the first 48 hours chart empty on my post?**
Those curves come from snapshots taken every time X reloads the post during its first week. Posts published before you installed Xplore have no snapshots, so the chart only appears for newer posts.

**Can I post or schedule from Xplore?**
No, by design. Posting through X's internal interface is the one thing that could look like automation, so the pencil and reply buttons open X's own composer instead.

**Does it slow X down?**
Barely. It parses responses X already received and does the analytics in the side panel. If you notice lag, close the panel with Alt+X; capture keeps working in the background.

**Which browsers are supported?**
Chrome and other Chromium browsers such as Brave, Edge and Arc. Firefox and Safari are not supported: the extension relies on Manifest V3 features they handle differently.

**What happens when X changes something?**
Xplore learns the identifiers X uses while you browse, so most changes are picked up automatically. If X reshapes its data, a feature may show empty until the extension is updated. Nothing breaks on X's side.

## Credits

Made by [@devploit](https://x.com/devploit). Questions, ideas and bug reports are welcome there.
