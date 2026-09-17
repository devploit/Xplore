import { useState } from "preact/hooks";
import type { ThemeSetting } from "@/data/settings";
import { ROUTES } from "../router";
import { services } from "../services";
import { captured, jobStatus, rateLimits, settings, toast, updateSettings } from "../store";

export function SettingsPage() {
  const s = settings.value;
  const [confirm, setConfirm] = useState(false);
  const check = (key: "hideXSidebar" | "hideDmDrawer" | "closeToMainColumn", label: string) => (
    <label class="flex items-center justify-between text-sm py-1">
      {label}
      <input type="checkbox" checked={s[key]} onChange={(e) => void updateSettings({ [key]: (e.target as HTMLInputElement).checked })} />
    </label>
  );

  const exportJson = async () => {
    const db = services.db;
    const dump = { exported_at: new Date().toISOString(), tweets: await db.tweets.toArray(), users: await db.users.toArray(), followerSnapshots: await db.followerSnapshots.toArray(), timelines: await db.timelines.toArray(), settings: s };
    const blob = new Blob([JSON.stringify(dump)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `x-lytics-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const wipe = async () => {
    const db = services.db;
    await Promise.all([db.tweets.clear(), db.users.clear(), db.followerSnapshots.clear(), db.queryIds.clear(), db.rateLimits.clear(), db.backfill.clear(), db.timelines.clear(), db.settings.clear()]);
    setConfirm(false);
    toast("All local data deleted");
  };

  return (
    <section class="flex flex-col gap-3 text-sm">
      <div class="xl-card">
        <div class="font-semibold mb-1">Appearance</div>
        <label class="flex items-center justify-between py-1">
          Theme
          <select class="xl-input" value={s.theme} onChange={(e) => void updateSettings({ theme: (e.target as HTMLSelectElement).value as ThemeSetting })}>
            <option value="system">Follow X</option>
            <option value="light">Light</option>
            <option value="dim">Dim</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        {check("hideXSidebar", "Hide X's right column")}
        {check("hideDmDrawer", "Hide the DM drawer")}
      </div>

      <div class="xl-card">
        <div class="font-semibold mb-1">Pages</div>
        {ROUTES.filter((r) => r.id !== "settings").map((r) => (
          <label key={r.id} class="flex items-center justify-between py-1">
            {r.label}
            <input type="checkbox" checked={s.pages[r.id] !== false} onChange={(e) => void updateSettings({ pages: { ...s.pages, [r.id]: (e.target as HTMLInputElement).checked } })} />
          </label>
        ))}
      </div>

      <div class="xl-card">
        <div class="font-semibold mb-1">Data</div>
        <label class="flex items-center justify-between py-1">
          Keep other people's posts for (days)
          <input class="xl-input w-20" type="number" min={7} max={3650} value={s.retentionDays} onChange={(e) => void updateSettings({ retentionDays: Math.max(7, Number((e.target as HTMLInputElement).value) || 90) })} />
        </label>
        <div class="text-xs xl-muted py-1">Captured this session: {captured.value.messages} responses, {captured.value.tweets} posts, {captured.value.dropped} dropped.</div>
        <div class="flex gap-2 pt-2">
          <button class="xl-btn" onClick={() => void exportJson()}>Export JSON</button>
          {confirm ? (
            <>
              <button class="xl-btn bg-red-600 text-white border-red-600" onClick={() => void wipe()}>Yes, delete everything</button>
              <button class="xl-btn" onClick={() => setConfirm(false)}>Cancel</button>
            </>
          ) : (
            <button class="xl-btn" onClick={() => setConfirm(true)}>Delete all data</button>
          )}
        </div>
      </div>

      <div class="xl-card">
        <div class="font-semibold mb-1">X rate limits</div>
        {rateLimits.value.length === 0 && <div class="text-xs xl-muted">No requests made yet.</div>}
        {rateLimits.value.map((r) => (
          <div key={r.endpoint} class="flex justify-between text-xs py-[2px]">
            <span>{r.endpoint}</span>
            <span class={r.remaining < 30 ? "text-red-500" : ""}>{r.remaining}/{r.limit} · resets {new Date(r.reset * 1000).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>

      <div class="xl-card">
        <div class="font-semibold mb-1">Background jobs</div>
        {Object.keys(jobStatus.value).length === 0 && <div class="text-xs xl-muted">Nothing has run yet. The first sync starts 15 s after X loads.</div>}
        {Object.entries(jobStatus.value).map(([name, v]) => {
          const e = v as { at: number; detail: unknown };
          return (
            <div key={name} class="text-xs py-[2px]">
              <span class="font-medium">{name}</span> <span class="xl-muted">{new Date(e.at).toLocaleTimeString()}</span>
              <div class="xl-muted truncate" title={JSON.stringify(e.detail)}>{summarize(e.detail)}</div>
            </div>
          );
        })}
      </div>

      <div class="text-xs xl-muted">x-lytics talks only to x.com. No servers, no telemetry.</div>
    </section>
  );
}

function summarize(detail: unknown): string {
  if (detail === undefined || detail === null) return "done";
  if (typeof detail !== "object") return String(detail);
  return Object.entries(detail as Record<string, unknown>)
    .map(([k, v]) => (v && typeof v === "object" && "stoppedBy" in (v as object) ? `${k}: ${(v as { pages?: number }).pages ?? 0} pages, ${(v as { stoppedBy: string }).stoppedBy}` : `${k}: ${JSON.stringify(v)}`))
    .join(" · ")
    .slice(0, 200);
}
