import { useEffect, useState } from "preact/hooks";
import { liveQuery } from "dexie";
import type { TimelineRow, TweetRow, UserRow } from "@/data/db";
import { normalizeGraphql } from "@/data/normalizer";
import { repliesToday, replyRadar, type RadarPost } from "@/analytics";
import { XApiError } from "@/x-api/client";
import { bottomCursor } from "@/x-api/cursor";
import { ops, type Page } from "@/x-api/operations";
import { services } from "../services";
import { me, ownTweets, settings, toast, updateSettings } from "../store";
import { TweetCard } from "../components/TweetCard";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/icons";
import { SectionTitle } from "../components/Section";

interface Feed {
  tweets: TweetRow[];
  users: Map<string, UserRow>;
  cursor?: string;
  loading: boolean;
}

async function fetchPage(tl: TimelineRow, cursor?: string): Promise<Page> {
  const c = services.client;
  if (tl.type === "list" && tl.listId) return ops.listLatestTweets(c, tl.listId, cursor);
  if (tl.type === "search" && tl.query) return ops.searchTimeline(c, tl.query, tl.product ?? "Latest", cursor);
  if (tl.type === "user") {
    let userId = tl.userId;
    if (!userId && tl.screenName) {
      const page = await ops.userByScreenName(c, tl.screenName);
      userId = normalizeGraphql(page.body).users[0]?.id;
      if (userId) await services.db.timelines.update(tl.id, { userId });
    }
    if (!userId) throw new Error("Unknown user");
    return ops.userTweets(c, userId, cursor);
  }
  throw new Error("Timeline is misconfigured");
}

export function Timelines() {
  const [list, setList] = useState<TimelineRow[]>([]);
  const [active, setActive] = useState<TimelineRow | null>(null);
  const [feed, setFeed] = useState<Feed>({ tweets: [], users: new Map(), loading: false });
  const [creating, setCreating] = useState(false);
  const [hot, setHot] = useState<RadarPost[]>([]);
  const [hotUsers, setHotUsers] = useState<Map<string, UserRow>>(new Map());
  const [showHot, setShowHot] = useState(false);
  const radar = settings.value.radar;
  const myFollowers = me.value?.followers_count;

  useEffect(() => {
    const sub = liveQuery(() => services.db.timelines.orderBy("created_at").toArray()).subscribe({ next: setList });
    // Posts captured from your own timeline, filtered to where a reply can still be seen and ranked by reach per minute.
    const hotSub = liveQuery(async () => {
      const db = services.db;
      const since = Date.now() - radar.maxAgeHours * 3_600_000;
      const recent = await db.tweets.where("created_at").above(since).toArray();
      const authors = await db.users.bulkGet([...new Set(recent.map((t) => t.user_id_str))]);
      const users = new Map(authors.filter((u): u is UserRow => !!u).map((u) => [u.id, u]));
      const ranked = replyRadar(recent, users, me.value?.id, { maxAgeHours: radar.maxAgeHours, maxReplies: radar.fewReplies ? 5 : undefined, minAuthorFollowers: radar.biggerOnly ? myFollowers : undefined }, Date.now(), 30);
      return { ranked, users };
    }).subscribe({ next: ({ ranked, users }) => { setHot(ranked); setHotUsers(users); } });
    return () => {
      sub.unsubscribe();
      hotSub.unsubscribe();
    };
  }, [radar.maxAgeHours, radar.fewReplies, radar.biggerOnly, myFollowers]);
  const done = repliesToday(ownTweets.value);
  const goal = settings.value.replyGoal;
  const setRadar = (patch: Partial<typeof radar>) => void updateSettings({ radar: { ...radar, ...patch } });
  const ageLabel = (m: number) => (m < 60 ? `${Math.round(m)}m` : `${Math.round(m / 60)}h`);

  const load = async (tl: TimelineRow, more = false) => {
    setFeed((f) => ({ ...(more ? f : { tweets: [], users: new Map<string, UserRow>() }), loading: true }));
    try {
      const page = await fetchPage(tl, more ? feed.cursor : undefined);
      await services.ingestor.ingestBody(page.body);
      const { tweets, users } = normalizeGraphql(page.body);
      const next = bottomCursor(page.body);
      setFeed((f) => {
        const merged = new Map(f.users);
        users.forEach((u) => merged.set(u.id, u));
        const seen = new Set(f.tweets.map((t) => t.id));
        const fresh = tweets.filter((t) => !seen.has(t.id)).sort((a, b) => b.created_at - a.created_at);
        return { tweets: [...f.tweets, ...fresh], users: merged, loading: false, ...(next ? { cursor: next } : {}) };
      });
    } catch (err) {
      setFeed((f) => ({ ...f, loading: false }));
      toast(err instanceof XApiError ? `Could not load: ${err.kind}` : "Could not load timeline", "error");
    }
  };

  const open = (tl: TimelineRow) => {
    setActive(tl);
    void load(tl);
  };
  const remove = async (tl: TimelineRow) => {
    await services.db.timelines.delete(tl.id);
    if (active?.id === tl.id) setActive(null);
  };

  if (active) {
    return (
      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <button class="xl-btn" onClick={() => setActive(null)}><Icon.back size={13} /> Feeds</button>
          <strong class="truncate mx-2">{active.name}</strong>
          <button class="xl-btn icon" disabled={feed.loading} onClick={() => void load(active)} title="Refresh" aria-label="Refresh"><Icon.refresh size={14} /></button>
        </div>
        {feed.tweets.map((t) => <TweetCard key={t.id} tweet={t} screenName={feed.users.get(t.user_id_str)?.screen_name ?? "i"} />)}
        {feed.loading && <div class="xl-muted text-xs text-center py-3">Loading…</div>}
        {!feed.loading && feed.tweets.length === 0 && <EmptyState title="No posts" />}
        {feed.cursor && !feed.loading && <button class="xl-btn self-center" onClick={() => void load(active, true)}>Load more</button>}
      </section>
    );
  }

  return (
    <section class="flex flex-col gap-3">
      <SectionTitle right={<button class="xl-btn text-[11px] py-[3px]" onClick={() => setCreating(true)}><Icon.plus size={12} /> New feed</button>}>Custom feeds</SectionTitle>
      {creating && <NewTimeline onDone={() => setCreating(false)} />}
      <button class="xl-card xl-card-2 flex items-center justify-between gap-2 text-left w-full" onClick={() => setShowHot(!showHot)} aria-expanded={showHot}>
        <span class="min-w-0">
          <span class="font-semibold inline-flex items-center gap-1"><Icon.flame size={14} /> Worth replying to</span>
          <span class="block text-xs xl-muted">Fresh posts from your timeline where a reply still gets seen · {hot.length}</span>
        </span>
        <span class="flex items-center gap-2 shrink-0">
          <span class="xl-pill" title="Replies you published today, against your daily goal (set it in the radar)" style={done >= goal ? { background: "rgba(34,197,94,0.15)", color: "#22c55e" } : undefined}>
            <Icon.reply size={11} /> {done}/{goal}
          </span>
          <span class="xl-muted">{showHot ? "▾" : "▸"}</span>
        </span>
      </button>
      {showHot && (
        <div class="xl-card xl-card-2 flex flex-wrap items-center gap-2 py-2 text-[11px]">
          <div class="xl-seg" role="radiogroup" aria-label="Maximum age">
            {[1, 3, 24].map((h) => (
              <button key={h} role="radio" aria-checked={radar.maxAgeHours === h} aria-selected={radar.maxAgeHours === h} onClick={() => setRadar({ maxAgeHours: h })}>{`< ${h}h`}</button>
            ))}
          </div>
          <button class={`xl-btn text-[11px] py-[3px] ${radar.fewReplies ? "active" : ""}`} aria-pressed={radar.fewReplies} title="At most 5 replies so far" onClick={() => setRadar({ fewReplies: !radar.fewReplies })}>Few replies</button>
          <button class={`xl-btn text-[11px] py-[3px] ${radar.biggerOnly ? "active" : ""}`} aria-pressed={radar.biggerOnly} disabled={!myFollowers} title="Only accounts with more followers than you" onClick={() => setRadar({ biggerOnly: !radar.biggerOnly })}>Bigger than me</button>
          <label class="ml-auto xl-metric xl-muted" title="Replies per day you aim for">
            Goal <input class="xl-input w-12 py-[2px] px-1.5 text-[11px]" type="number" min={1} max={100} aria-label="Daily reply goal" value={goal} onChange={(e) => void updateSettings({ replyGoal: Math.max(1, Number((e.target as HTMLInputElement).value) || 10) })} />
          </label>
        </div>
      )}
      {showHot && (hot.length === 0 ? <EmptyState title="Nothing on the radar" hint="Scroll your home timeline for a bit, or relax the filters above. Posts you see are ranked by impressions per minute." /> : hot.map((h) => (
        <div key={h.tweet.id} class="relative">
          <span class="absolute -top-2 left-3 z-10 xl-pill" style={{ background: "var(--xl-bg)", border: "1px solid var(--xl-border)" }} title={`${Math.round(h.perMinute)} impressions per minute · ${Math.round(h.velocity)} engagements per hour · posted ${ageLabel(h.ageMinutes)} ago`}>
            {h.perMinute > 0 ? `${compactRate(h.perMinute)}/min` : `${Math.round(h.velocity)}/h`} · {ageLabel(h.ageMinutes)}
          </span>
          <TweetCard tweet={h.tweet} screenName={hotUsers.get(h.tweet.user_id_str)?.screen_name ?? "i"} />
        </div>
      )))}
      {list.length === 0 && !creating && <EmptyState title="No timelines yet" hint="Build a feed from one of your X lists, a user, or a keyword search." />}
      {list.map((tl) => (
        <div key={tl.id} class="xl-card xl-card-2 flex items-center justify-between gap-2">
          <button class="text-left flex-1" onClick={() => open(tl)}>
            <div class="font-semibold">{tl.name}</div>
            <div class="text-xs xl-muted">{tl.type === "list" ? `List ${tl.listId}` : tl.type === "user" ? `@${tl.screenName}` : `Search: ${tl.query} (${tl.product})`}</div>
          </button>
          <button class="xl-btn icon" onClick={() => void remove(tl)} aria-label={`Delete ${tl.name}`} title="Delete"><Icon.trash size={14} /></button>
        </div>
      ))}
    </section>
  );
}

/** Starting points that only use X search operators, so they stay local. */
const PRESETS: { label: string; query: string; product: "Top" | "Latest" }[] = [
  { label: "Viral today", query: "min_faves:5000 -filter:replies lang:en", product: "Top" },
  { label: "Viral (Spanish)", query: "min_faves:2000 -filter:replies lang:es", product: "Top" },
  { label: "Questions in my niche", query: "? min_faves:20 -filter:replies -filter:links", product: "Latest" },
  { label: "Rising with links", query: "min_faves:200 filter:links -filter:replies", product: "Latest" },
];

function NewTimeline({ onDone }: { onDone: () => void }) {
  const [type, setType] = useState<TimelineRow["type"]>("search");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [product, setProduct] = useState<"Top" | "Latest">("Latest");
  const [lists, setLists] = useState<{ id: string; name: string }[] | null>(null);

  const loadLists = async () => {
    try {
      const page = await ops.listsManagement(services.client);
      const found: { id: string; name: string }[] = [];
      const visit = (n: unknown): void => {
        if (Array.isArray(n)) return n.forEach(visit);
        if (typeof n !== "object" || n === null) return;
        const r = n as Record<string, unknown>;
        if (r.__typename === "TimelineTwitterList" && typeof r.list === "object" && r.list) {
          const l = r.list as Record<string, unknown>;
          if (typeof l.id_str === "string" && typeof l.name === "string") found.push({ id: l.id_str, name: l.name });
        }
        Object.values(r).forEach(visit);
      };
      visit(page.body);
      setLists(found);
    } catch {
      toast("Could not load your lists", "error");
      setLists([]);
    }
  };
  useEffect(() => {
    if (type === "list" && lists === null) void loadLists();
  }, [type]);

  const save = async () => {
    const v = value.trim().replace(/^@/, "");
    if (!v) return;
    const row: TimelineRow = { id: crypto.randomUUID(), type, name: name.trim() || v, created_at: Date.now() };
    if (type === "list") row.listId = v.split("/").pop() ?? v;
    if (type === "user") row.screenName = v;
    if (type === "search") {
      row.query = v;
      row.product = product;
    }
    await services.db.timelines.put(row);
    onDone();
  };

  return (
    <div class="xl-card xl-card-2 flex flex-col gap-2">
      <div class="flex gap-1" role="radiogroup" aria-label="Timeline type">
        {(["search", "list", "user"] as const).map((t) => (
          <button key={t} role="radio" aria-checked={type === t} class={`xl-btn capitalize ${type === t ? "active" : ""}`} onClick={() => setType(t)}>{t}</button>
        ))}
      </div>
      <input class="xl-input" placeholder="Name (optional)" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      {type === "search" && (
        <div class="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button key={p.label} class="xl-btn text-[11px] py-[3px]" onClick={() => { setValue(p.query); if (!name) setName(p.label); setProduct(p.product); }} title={p.query}>{p.label}</button>
          ))}
        </div>
      )}
      {type === "list" && lists && lists.length > 0 ? (
        <select class="xl-input" value={value} onChange={(e) => setValue((e.target as HTMLSelectElement).value)}>
          <option value="">Pick a list</option>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      ) : (
        <input class="xl-input" placeholder={type === "list" ? "List id or URL" : type === "user" ? "@username" : "Search query, e.g. from:nasa -filter:replies"} value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} />
      )}
      {type === "search" && (
        <select class="xl-input" value={product} onChange={(e) => setProduct((e.target as HTMLSelectElement).value as "Top" | "Latest")}>
          <option value="Latest">Latest</option>
          <option value="Top">Top</option>
        </select>
      )}
      <div class="flex gap-2 justify-end">
        <button class="xl-btn" onClick={onDone}>Cancel</button>
        <button class="xl-btn active" onClick={() => void save()}>Save</button>
      </div>
    </div>
  );
}

function compactRate(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n));
}
