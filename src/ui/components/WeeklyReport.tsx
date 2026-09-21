import { useState } from "preact/hooks";
import { streak, weeklySummary } from "@/analytics";
import { followerPoints, me, ownTweets } from "../store";
import { compact, percent, signed } from "./format";
import { PosterModal } from "./Poster";
import { CardLabel } from "./Section";
import { Icon } from "./icons";

/** Button plus poster with the last seven days, meant to be shared on X. */
export function WeeklyReportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button class="xl-btn text-[11px] py-[3px]" onClick={() => setOpen(true)} title="Share a poster with your last 7 days"><Icon.share size={12} /> Weekly report</button>
      {open && (
        <PosterModal title="Weekly report" onClose={() => setOpen(false)}>
          <WeeklyReport />
        </PosterModal>
      )}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string | undefined }) {
  return (
    <div>
      <div class="text-[10px] font-bold tracking-wider uppercase opacity-70">{label}</div>
      <div class="text-[24px] font-extrabold leading-none mt-0.5 tabular-nums">{value}</div>
      {sub && <div class="text-[11px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

export function WeeklyReport() {
  const s = weeklySummary(ownTweets.value, followerPoints.value);
  const st = streak(ownTweets.value);
  const from = new Date(s.since).toLocaleDateString([], { day: "numeric", month: "short" });
  const to = new Date().toLocaleDateString([], { day: "numeric", month: "short" });
  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <div>
          <CardLabel>Weekly report</CardLabel>
          <div class="text-[17px] font-extrabold leading-tight">{me.value?.name ?? `@${me.value?.screen_name ?? "me"}`}</div>
          <div class="text-[11px] opacity-70">{from} to {to}</div>
        </div>
        {me.value?.profile_image_url_https && <img src={me.value.profile_image_url_https} alt="" width={44} height={44} class="rounded-full" referrerpolicy="no-referrer" />}
      </div>
      <div class="grid grid-cols-3 gap-3">
        <Stat label="Followers" value={s.followersGained === undefined ? "n/a" : signed(s.followersGained)} sub={me.value ? `${compact(me.value.followers_count)} total` : undefined} />
        <Stat label="Impressions" value={compact(s.impressions)} sub={`${s.posts} posts · ${s.replies} replies`} />
        <Stat label="Engagement" value={percent(s.engagementRate)} sub={`${compact(s.engagements)} interactions`} />
      </div>
      {s.best && (
        <div class="rounded-lg p-3" style={{ background: "rgba(127,127,127,0.15)" }}>
          <div class="text-[10px] font-bold tracking-wider uppercase opacity-70 mb-1">Best post · {compact(s.best.view_count)} impressions</div>
          <div class="text-[12.5px] leading-snug line-clamp-3">{s.best.full_text}</div>
        </div>
      )}
      <div class="flex items-center gap-4 text-[11px] opacity-80">
        {st.current > 0 && <span class="inline-flex items-center gap-1"><Icon.flame size={12} /> {st.current}-day streak</span>}
        <span class="ml-auto">made with Xplore</span>
      </div>
    </div>
  );
}
