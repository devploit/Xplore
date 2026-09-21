import type { UserRow, XploreDb } from "./db";

/** X stores the logged-in user id in the readable `twid` cookie as `u%3D<id>` (or `u=<id>`). */
export function currentUserId(cookie: string = document.cookie): string | undefined {
  const match = /(?:^|;\s*)twid=([^;]+)/.exec(cookie);
  if (!match?.[1]) return undefined;
  const decoded = decodeURIComponent(match[1]).replace(/^"|"$/g, "");
  const id = /^u=(\d+)$/.exec(decoded);
  return id?.[1];
}

export function csrfToken(cookie: string = document.cookie): string | undefined {
  const match = /(?:^|;\s*)ct0=([^;]+)/.exec(cookie);
  return match?.[1] || undefined;
}

export async function currentUser(db: XploreDb, cookie?: string): Promise<UserRow | undefined> {
  const id = currentUserId(cookie);
  return id ? db.users.get(id) : undefined;
}
