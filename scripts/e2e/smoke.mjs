import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Headless end-to-end check: loads dist/ into a throwaway Chrome profile, opens the fake X served by
// fake-x.mjs, and prints what the extension captured, rendered and stored. Usage:
//   node scripts/e2e/fake-x.mjs &   then   node scripts/e2e/smoke.mjs dist 22000

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dist = resolve(process.argv[2] ?? "dist");
const profile = mkdtempSync(join(tmpdir(), "xl-smoke-"));
const port = 9333;
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--enable-unsafe-extension-debugging", "--remote-allow-origins=*", "--no-first-run", "--no-default-browser-check", "--proxy-server=http://127.0.0.1:8080", "--ignore-certificate-errors", "--window-size=1200,1100", "--hide-scrollbars", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch {}
    await sleep(250);
  }
  throw new Error("Chrome did not start");
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); } else if (d.method) this.events.push(d); }; }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((r) => this.pending.set(id, r)); }
}

try {
  const version = await waitFor(`http://127.0.0.1:${port}/json/version`);
  const bws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => (bws.onopen = r));
  const browser = new Cdp(bws);
  const loaded = await browser.send("Extensions.loadUnpacked", { path: dist });
  console.log("loadUnpacked:", JSON.stringify(loaded).slice(0, 200));
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?https://x.com/`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  const cdp = new Cdp(ws);
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await sleep(Number(process.argv[3] || 9000));
  const evalJs = async (expr) => (await Promise.race([cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }), sleep(8000).then(() => ({ result: { result: { value: "TIMEOUT" } } }))])).result?.result?.value;
  const info = await evalJs(`(() => { const h = document.getElementById("xplore-root"); const s = document.getElementById("xplore-page-css"); return { url: location.href, host: !!h, shadow: !!h?.shadowRoot, uiText: (h?.shadowRoot?.querySelector('div')?.textContent ?? '').replace(/\\s+/g,' ').slice(0, 700), classes: h?.className, pageCss: !!s, patchedFetch: window.fetch.name, router: typeof window.__xlRouter, dbs: undefined }; })()`);
  await cdp.send("Page.enable");
  const shotDir = process.env.XL_SHOTS;
  if (shotDir) mkdirSync(shotDir, { recursive: true });
  if (process.env.XL_THEME === "dim") await evalJs(`document.body.style.backgroundColor = "rgb(21, 32, 43)"`);
  if (process.env.XL_THEME === "light") await evalJs(`document.body.style.backgroundColor = "rgb(255, 255, 255)"`);
  await sleep(500);
  const pages = {};
  for (const label of ["Activity", "Posts", "Mentions", "Feeds", "Settings", "Sniper", "Home"]) {
    if (label === "Sniper") { await evalJs(`history.pushState({}, "", "/friend"); dispatchEvent(new PopStateEvent("popstate"))`); await sleep(800); }
    if (label === "Feeds") { await evalJs(`(() => { const h = document.getElementById("xplore-root"); const b = [...h.shadowRoot.querySelectorAll("nav button")].find(b => b.getAttribute("aria-label") === "Feeds"); b?.click(); })()`); await sleep(400); await evalJs(`(() => { const h = document.getElementById("xplore-root"); const b = [...h.shadowRoot.querySelectorAll("main button")].find(b => b.textContent.includes("Worth replying")); b?.click(); })()`); }
    await evalJs(`(() => { const h = document.getElementById("xplore-root"); const b = [...h.shadowRoot.querySelectorAll("nav button, header button")].find(b => (b.getAttribute("aria-label") || b.textContent).includes("${label}")); b?.click(); return !!b; })()`);
    await sleep(700);
    if (shotDir) {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 1200 - 470, y: 0, width: 470, height: 1100, scale: 1 } });
      writeFileSync(join(shotDir, `${label.toLowerCase()}.png`), Buffer.from(shot.result.data, "base64"));
    }
    pages[label] = await evalJs(`(() => { const h = document.getElementById("xplore-root"); return (h.shadowRoot.querySelector("main")?.textContent ?? "").replace(/\\s+/g, " ").slice(0, 260); })()`);
  }
  const restProbe = await evalJs(`new Promise((res) => { const seen = []; const h = (e) => { if (e.data && e.data.source === "xplore") seen.push(e.data.kind + ":" + (e.data.op || e.data.path)); }; window.addEventListener("message", h); fetch("/i/api/2/notifications/all.json?probe=1").then(r => r.text()).then((t) => setTimeout(() => { window.removeEventListener("message", h); res({ seen, len: t.length, head: t.slice(0, 80) }); }, 800)); })`);
  const dbs = await evalJs(`indexedDB.databases().then(d => d.map(x => x.name))`);
  const db = await evalJs(`new Promise((res) => { const r = indexedDB.open("xlytics"); r.onsuccess = () => { const d = r.result; const out = {}; const names = [...d.objectStoreNames]; let n = names.length; if (n === 0) return res({ empty: true }); for (const name of names) { const rq = d.transaction(name).objectStore(name).getAll(); rq.onsuccess = () => { out[name] = rq.result; if (--n === 0) res(out); }; } }; r.onerror = () => res({ error: String(r.error) }); })`);
  
  const errors = cdp.events.filter((e) => (e.method === "Runtime.exceptionThrown") || (e.method === "Log.entryAdded" && e.params.entry.level === "error") || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error")).map((e) => JSON.stringify(e.params).slice(0, 300));
  const summary = { queryIds: db.queryIds, tweets: (db.tweets||[]).map(t => ({ id: t.id, u: t.user_id_str, likes: t.favorite_count })), users: (db.users||[]).map(u => u.screen_name), snapshots: db.followerSnapshots, rateLimits: db.rateLimits, backfill: db.backfill, settings: db.settings?.length };
  console.log(JSON.stringify({ info, restProbe, pages, dbs, summary, errors: errors.slice(0, 10), errorCount: errors.length }, null, 2));
} finally {
  chrome.kill("SIGKILL");
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
