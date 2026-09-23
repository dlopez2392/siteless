import 'server-only';

import { clerkClient } from '@clerk/nextjs/server';

/**
 * How long the detail page waits on Clerk for cosmetic names before rendering the raw ids
 * (C-WR-01). The names are the only thing on `/businesses/[id]` that is not ours; every field
 * and the unmerge action must not wait on a slow or rate-limited third party for them.
 */
export const ACTOR_LOOKUP_TIMEOUT_MS = 1500;

/** One page of `getUserList`. Past this, the remaining actors print as raw ids — honest, and
 *  far inside Clerk's own 500 ceiling, which a page of 500+ distinct actors would breach. */
const MAX_LOOKUP = 100;

type NamedUser = {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
};

/**
 * First + last name, else the username, else nothing (→ the raw id).
 *
 * 🔴 NEVER THE EMAIL (C-WR-01). The old third fallback printed "Reviewed by jane@…" to every
 * member of the org, `Member` role included. An address is contact data, not a name.
 */
function displayNameOf(user: NamedUser): string | null {
  const full = [user.firstName, user.lastName]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0)
    .join(' ');
  if (full) return full;
  const username = user.username?.trim();
  return username ? username : null;
}

/**
 * Clerk user ids → the names "Reviewed by {actor}" and "Unmerged by {actor}" print.
 *
 * The stored actor is the Clerk subject (T-3-08: stamped by the definer, never sent by the
 * client). A raw `user_2x…` on screen would be honest and unreadable, so the names are looked
 * up — one call, only when a row needs one. A lookup that fails, or does not answer within
 * `ACTOR_LOOKUP_TIMEOUT_MS`, falls back to the id itself: the record of who acted is never
 * dropped to make the row prettier.
 */
export async function actorNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;

  const wanted = ids.slice(0, MAX_LOOKUP);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('clerk lookup timed out')), ACTOR_LOOKUP_TIMEOUT_MS);
  });

  try {
    const lookup = (async () => {
      const client = await clerkClient();
      return client.users.getUserList({ userId: wanted, limit: wanted.length });
    })();
    // The losing lookup is left to settle on its own; swallow its late rejection.
    lookup.catch(() => {});
    const { data } = await Promise.race([lookup, deadline]);
    for (const user of data) {
      const name = displayNameOf(user);
      if (name) names.set(user.id, name);
    }
  } catch {
    // Timed out or failed: fall through to the raw ids.
  } finally {
    clearTimeout(timer);
  }
  return names;
}
