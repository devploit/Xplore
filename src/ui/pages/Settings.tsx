import { useState } from "preact/hooks";
import type { Settings, ThemeSetting } from "@/data/settings";
import { ROUTES } from "../router";
import { services } from "../services";
import { captured, jobStatus, me, rateLimits, settings, toast, updateSettings } from "../store";
import { tweetsToCsv } from "@/data/export";
import { currentUserId } from "@/data/identity";
import { CardLabel, SectionTitle } from "../components/Section";
import { Icon } from "../components/icons";

function Row({ label, children, hint }: { label: string; children: preact.ComponentChildren; hint?: string }) {
  return (
    <label class="flex items-center justify-between gap-3 py-1.5 text-[13px]">
      <span>
        {label}
        {hint && <span class="block text-[11px] xl-muted">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} class="relative w-9 h-5 rounded-full transition-colors shrink-0" style={{ background: on ? "var(--xl-accent)" : "var(--xl-border)" }} onClick={() => onChange(!on)}>
      <span class="absolute top-[2px] w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: on ? "18px" : "2px" }} />
    </button>
  );
}

export function SettingsPage() {
  const s = settings.value;
  const [confirm, setConfirm] = useState(false);
  const set = (patch: Partial<Settings>) => void updateSettings(patch);

  const download = (content: string, type: string, extension: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `xplore-export-${new Date().toISOString().slice(0, 10)}.${extension}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportJson = async () => {
    const db = services.db;
    const dump = { exported_at: new Date().toISOString(), tweets: await db.tweets.toArray(), users: await db.users.toArray(), followerSnapshots: await db.followerSnapshots.toArray(), tweetMetrics: await db.tweetMetrics.toArray(), timelines: await db.timelines.toArray(), settings: s };
    download(JSON.stringify(dump), "application/json", "json");
  };
  /** Own posts only, one row each, for spreadsheets. */
  const exportCsv = async () => {
    const id = currentUserId();
    if (!id) return toast("No X session detected", "error");
    const own = await services.db.tweets.where("user_id_str").equals(id).toArray();
    download(tweetsToCsv(own, me.value?.screen_name ?? "i"), "text/csv;charset=utf-8", "csv");
  };
  const wipe = async () => {
    const db = services.db;
    await Promise.all([db.tweets.clear(), db.users.clear(), db.followerSnapshots.clear(), db.queryIds.clear(), db.rateLimits.clear(), db.backfill.clear(), db.timelines.clear(), db.settings.clear(), db.tweetMetrics.clear()]);
    setConfirm(false);
    toast("All local data deleted");
  };

  return (
    <section class="flex flex-col gap-2.5">
      <div class="xl-card xl-card-2 flex items-center gap-3">
        {me.value?.profile_image_url_https && <img src={me.value.profile_image_url_https} alt="" width={40} height={40} class="rounded-full" referrerpolicy="no-referrer" />}
        <div class="min-w-0">
          <div class="font-semibold truncate">{me.value?.name ?? "Not detected yet"}</div>
          <div class="text-xs xl-muted truncate">{me.value ? `@${me.value.screen_name} · ${me.value.followers_count.toLocaleString()} followers` : "Open your profile once on X"}</div>
        </div>
        <span class="ml-auto text-[11px] xl-muted whitespace-nowrap">Alt+X toggles</span>
      </div>

      <SectionTitle>Appearance</SectionTitle>
      <div class="xl-card xl-card-2">
        <Row label="Theme">
          <select class="xl-input" value={s.theme} onChange={(e) => set({ theme: (e.target as HTMLSelectElement).value as ThemeSetting })}>
            <option value="system">Follow X</option>
            <option value="light">Light</option>
            <option value="dim">Dim</option>
            <option value="dark">Dark</option>
          </select>
        </Row>
        <Row label="Panel width">
          <div class="xl-seg" role="radiogroup" aria-label="Panel width">
            {([400, 460, 540] as const).map((w) => (
              <button key={w} role="radio" aria-selected={s.width === w} aria-checked={s.width === w} onClick={() => set({ width: w })}>{w === 400 ? "Narrow" : w === 460 ? "Default" : "Wide"}</button>
            ))}
          </div>
        </Row>
        <Row label="Compact post cards" hint="Three lines of text, tighter spacing"><Toggle on={s.compactCards} onChange={(v) => set({ compactCards: v })} label="Compact post cards" /></Row>
        <Row label="Hide X's right column"><Toggle on={s.hideXSidebar} onChange={(v) => set({ hideXSidebar: v })} label="Hide X's right column" /></Row>
        <Row label="Hide the DM drawer"><Toggle on={s.hideDmDrawer} onChange={(v) => set({ hideDmDrawer: v })} label="Hide the DM drawer" /></Row>
      </div>

      <SectionTitle>Pages</SectionTitle>
      <div class="xl-card xl-card-2">
        {ROUTES.filter((r) => r.id !== "settings").map((r) => {
          const I = Icon[r.icon];
          return (
            <Row key={r.id} label={r.label}>
              <span class="flex items-center gap-3"><span class="xl-muted"><I size={14} /></span><Toggle on={s.pages[r.id] !== false} onChange={(v) => set({ pages: { ...s.pages, [r.id]: v } })} label={`Show ${r.label}`} /></span>
            </Row>
          );
        })}
      </div>

      <SectionTitle>Data</SectionTitle>
      <div class="xl-card xl-card-2">
        <Row label="Keep other people's posts for" hint="Your own posts are never deleted">
          <span class="flex items-center gap-1 text-xs"><input class="xl-input w-16" type="number" min={7} max={3650} value={s.retentionDays} onChange={(e) => set({ retentionDays: Math.max(7, Number((e.target as HTMLInputElement).value) || 90) })} /> days</span>
        </Row>
        <div class="text-[11px] xl-muted py-1">This session: {captured.value.messages} responses observed, {captured.value.tweets} posts stored, {captured.value.dropped} dropped.</div>
        <div class="flex gap-2 pt-2 flex-wrap">
          <button class="xl-btn" onClick={() => void exportJson()}><Icon.share size={13} /> Export JSON</button>
          <button class="xl-btn" onClick={() => void exportCsv()} title="Your posts, one per row, for spreadsheets"><Icon.list size={13} /> Export CSV</button>
          {confirm ? (
            <>
              <button class="xl-btn danger" onClick={() => void wipe()}>Yes, delete everything</button>
              <button class="xl-btn" onClick={() => setConfirm(false)}>Cancel</button>
            </>
          ) : (
            <button class="xl-btn" onClick={() => setConfirm(true)}><Icon.trash size={13} /> Delete all data</button>
          )}
        </div>
      </div>

      <SectionTitle>X rate limits</SectionTitle>
      <div class="xl-card xl-card-2">
        {rateLimits.value.length === 0 && <div class="text-xs xl-muted">No requests made yet.</div>}
        {rateLimits.value.map((r) => {
          const pct = r.limit ? Math.round((100 * r.remaining) / r.limit) : 0;
          return (
            <div key={r.endpoint} class="py-1 text-[11.5px]">
              <div class="flex justify-between"><span>{r.endpoint}</span><span class={r.remaining < 30 ? "text-red-400" : "xl-muted"}>{r.remaining}/{r.limit} · resets {new Date(r.reset * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
              <div class="h-[3px] rounded-full mt-1" style={{ background: "var(--xl-hover)" }}><div class="h-full rounded-full" style={{ width: `${pct}%`, background: r.remaining < 30 ? "#f87171" : "var(--xl-accent)" }} /></div>
            </div>
          );
        })}
      </div>

      <SectionTitle>Background sync</SectionTitle>
      <div class="xl-card xl-card-2">
        {Object.keys(jobStatus.value).length === 0 && <div class="text-xs xl-muted">Nothing has run yet. The first sync starts 15 s after X loads.</div>}
        {Object.entries(jobStatus.value).map(([name, v]) => {
          const e = v as { at: number; detail: unknown };
          return (
            <div key={name} class="text-[11.5px] py-1">
              <div class="flex justify-between"><span class={`font-medium ${name.endsWith(":error") ? "text-red-400" : ""}`}>{name}</span><span class="xl-muted">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
              <div class="xl-muted truncate" title={JSON.stringify(e.detail)}>{summarize(e.detail)}</div>
            </div>
          );
        })}
      </div>

      <div class="text-[11px] xl-muted text-center py-2"><CardLabel>Xplore</CardLabel>Talks only to x.com. No servers, no telemetry.</div>
    </section>
  );
}

function summarize(detail: unknown): string {
  if (detail === undefined || detail === null) return "done";
  if (typeof detail === "boolean") return detail ? "snapshot written" : "already up to date";
  if (typeof detail === "number") return `${detail} old posts pruned`;
  if (typeof detail !== "object") return String(detail);
  return Object.entries(detail as Record<string, unknown>)
    .map(([k, v]) => (v && typeof v === "object" && "stoppedBy" in (v as object) ? `${k}: ${(v as { pages?: number }).pages ?? 0} pages, ${(v as { stoppedBy: string }).stoppedBy}` : `${k}: ${JSON.stringify(v)}`))
    .join(" · ")
    .slice(0, 200);
}
