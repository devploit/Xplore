import { render } from "preact";
import css from "./styles.css?inline";
import { App } from "./App";
import { getDb } from "@/data/db";
import { currentUserId } from "@/data/identity";
import { Ingestor } from "@/data/ingest";
import { Scheduler } from "@/data/jobs/scheduler";
import { XClient } from "@/x-api/client";
import { isXlMessage } from "@/shared/messages";
import { ensurePageStyles } from "./page-styles";
import { setServices } from "./services";
import { captured, initStore, jobStatus, settings, theme } from "./store";
import { observeTheme } from "./theme";
import { watchXRoute } from "./xroute";

const HOST_ID = "xplore-root";

async function bootstrap(): Promise<void> {
  if (document.getElementById(HOST_ID)) return;
  const db = getDb();
  const ingestor = new Ingestor(db, () => currentUserId());
  const client = new XClient({ db });
  const scheduler = new Scheduler({
    ctx: { db, client, ingestor },
    retentionDays: async () => settings.value.retentionDays,
    onEvent: (name, detail) => (jobStatus.value = { ...jobStatus.value, [name]: { at: Date.now(), detail } }),
  });
  setServices({ db, client, ingestor, scheduler });

  // Passive capture: every GraphQL response X receives arrives here from the interceptor.
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data: unknown = event.data;
    if (!isXlMessage(data)) return;
    if (data.kind === "dropped") {
      captured.value = { ...captured.value, dropped: captured.value.dropped + 1 };
      return;
    }
    if (data.kind !== "graphql" && data.kind !== "rest") return;
    const done = data.kind === "graphql" ? ingestor.ingestMessage(data) : ingestor.ingestRest(data);
    void done.then((r) => {
      captured.value = { messages: captured.value.messages + 1, dropped: captured.value.dropped, tweets: captured.value.tweets + r.tweets };
    });
  });

  await initStore(db);
  observeTheme((t) => {
    if (settings.value.theme === "system") theme.value = t;
  });
  ensurePageStyles();
  watchXRoute();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "position:fixed;top:0;right:0;z-index:2147483000;";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  shadow.appendChild(style);
  const mount = document.createElement("div");
  shadow.appendChild(mount);
  document.body.appendChild(host);
  render(<App host={host} />, mount);

  scheduler.start();
  window.addEventListener("pagehide", () => scheduler.stop());
}

void bootstrap();
