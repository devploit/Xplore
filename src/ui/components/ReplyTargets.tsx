import { useEffect, useState } from "preact/hooks";
import type { UserRow } from "@/data/db";
import { replyTargets } from "@/analytics";
import { services } from "../services";
import { ownTweets, userId } from "../store";
import { navigateX } from "../navigate";
import { compact } from "./format";
import { CardLabel } from "./Section";
import { Icon } from "./icons";

/** Which accounts your replies reach the most, from your own replies in the selected period. */
export function ReplyTargets({ tweets }: { tweets: typeof ownTweets.value }) {
  const me = userId.value ?? "";
  const targets = replyTargets(tweets, me, 6);
  const [users, setUsers] = useState<Map<string, UserRow>>(new Map());
  const ids = targets.map((t) => t.userId).join(",");
  useEffect(() => {
    if (!ids) return;
    void services.db.users.bulkGet(ids.split(",")).then((rows) => setUsers(new Map(rows.filter((u): u is UserRow => !!u).map((u) => [u.id, u]))));
  }, [ids]);
  return (
    <div class="xl-card xl-card-2">
      <div class="flex items-center gap-1"><Icon.reply size={12} /><CardLabel>Who to reply to</CardLabel></div>
      <div class="mt-2 flex flex-col gap-1 text-[12px]">
        {targets.map((t) => {
          const u = users.get(t.userId);
          const handle = u?.screen_name;
          return (
            <div key={t.userId} class="flex justify-between gap-2" title={`${t.count} repl${t.count === 1 ? "y" : "ies"} · ${compact(t.totalEngagements)} interactions${u ? ` · ${compact(u.followers_count)} followers` : ""}`}>
              {handle ? <button class="truncate text-left hover:underline" onClick={() => navigateX(`/${handle}`)}>@{handle}</button> : <span class="truncate xl-muted">unknown account</span>}
              <span class="xl-muted whitespace-nowrap">{compact(t.avgImpressions)} avg · {t.count}</span>
            </div>
          );
        })}
        {targets.length === 0 && <span class="xl-muted text-xs">No replies to other accounts in this period.</span>}
      </div>
      {targets.length > 0 && <div class="text-[10.5px] xl-muted mt-1.5">Average impressions your replies get under each account.</div>}
    </div>
  );
}
