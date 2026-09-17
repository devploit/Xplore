import type { XlyticsDb } from "../db";

export const LEASE_MS = 2 * 60_000;

/**
 * Cooperative lock in the `backfill` table so that two X tabs never run the same job at once.
 * Returns true when this tab now owns the job.
 */
export async function acquireLease(db: XlyticsDb, key: string, owner: string, now: number = Date.now(), ttl: number = LEASE_MS): Promise<boolean> {
  return db.transaction("rw", db.backfill, async () => {
    const row = (await db.backfill.get(key)) ?? { key };
    if (row.lease_owner && row.lease_owner !== owner && (row.lease_until ?? 0) > now) return false;
    await db.backfill.put({ ...row, lease_owner: owner, lease_until: now + ttl });
    return true;
  });
}

export async function renewLease(db: XlyticsDb, key: string, owner: string, now: number = Date.now(), ttl: number = LEASE_MS): Promise<void> {
  const row = await db.backfill.get(key);
  if (row?.lease_owner === owner) await db.backfill.put({ ...row, lease_until: now + ttl });
}

export async function releaseLease(db: XlyticsDb, key: string, owner: string): Promise<void> {
  const row = await db.backfill.get(key);
  if (row?.lease_owner === owner) {
    const { lease_owner: _o, lease_until: _u, ...rest } = row;
    await db.backfill.put(rest);
  }
}
