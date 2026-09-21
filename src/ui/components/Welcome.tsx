import { BACKFILL_MAX_PAGES } from "@/data/jobs/jobs";
import { backfillState, captured, me, ownTweets, userId } from "../store";
import { Icon } from "./icons";
import { CardLabel } from "./Section";

/** First-run card: what Xplore is doing right now and what the user can do to speed it up. */
export function Welcome() {
  const session = !!userId.value;
  const handle = me.value?.screen_name;
  const posts = ownTweets.value.length;
  const bf = backfillState.value;
  const pages = bf?.pages ?? 0;
  const done = !!bf?.completed_at;
  const progress = done ? 100 : Math.min(95, Math.round((100 * pages) / BACKFILL_MAX_PAGES));
  const steps: { title: string; detail: string; state: "done" | "active" | "todo" }[] = [
    { title: "Session detected", detail: session ? (handle ? `Signed in as @${handle}` : "Reading your profile…") : "Log in to X in this tab", state: session ? "done" : "active" },
    { title: "Capturing your posts", detail: posts > 0 ? `${posts} posts stored so far` : `${captured.value.messages} responses observed. Visit your profile to speed this up.`, state: posts > 0 ? "done" : session ? "active" : "todo" },
    { title: "Loading your history", detail: done ? "Up to a year of posts loaded" : bf?.last_run || pages > 0 ? `${pages} pages loaded, keep this tab open` : "Starts 15 seconds after X loads", state: done ? "done" : posts > 0 ? "active" : "todo" },
  ];
  return (
    <div class="xl-card xl-card-2 flex flex-col gap-3" role="status" aria-live="polite">
      <div>
        <CardLabel>Welcome to Xplore</CardLabel>
        <div class="text-[15px] font-bold mt-0.5">Setting up your analytics</div>
        <div class="text-xs xl-muted mt-0.5">Everything happens in this browser. Nothing is sent anywhere but x.com.</div>
      </div>
      <ol class="flex flex-col gap-2">
        {steps.map((s, i) => (
          <li key={s.title} class="flex gap-2.5 items-start">
            <span class={`xl-step ${s.state}`} aria-hidden="true">{s.state === "done" ? <Icon.check size={12} /> : i + 1}</span>
            <div class="min-w-0">
              <div class={`text-[13px] font-semibold ${s.state === "todo" ? "xl-muted" : ""}`}>{s.title}</div>
              <div class="text-[11.5px] xl-muted">{s.detail}</div>
            </div>
          </li>
        ))}
      </ol>
      <div>
        <div class="flex justify-between text-[11px] xl-muted mb-1"><span>History</span><span>{done ? "complete" : `${progress}%`}</span></div>
        <div class="h-[5px] rounded-full" style={{ background: "var(--xl-hover)" }} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="History loading progress">
          <div class="h-full rounded-full transition-[width] duration-500" style={{ width: `${progress}%`, background: "var(--xl-accent)" }} />
        </div>
      </div>
    </div>
  );
}
