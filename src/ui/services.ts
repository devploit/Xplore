import type { XlyticsDb } from "@/data/db";
import type { Ingestor } from "@/data/ingest";
import type { Scheduler } from "@/data/jobs/scheduler";
import type { XClient } from "@/x-api/client";

/** Long-lived objects created once at bootstrap and shared by pages. */
export interface Services {
  db: XlyticsDb;
  client: XClient;
  ingestor: Ingestor;
  scheduler: Scheduler;
}

export let services: Services;

export function setServices(s: Services): void {
  services = s;
}
