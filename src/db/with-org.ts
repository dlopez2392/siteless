import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from './client';

/** Never interpolate a role that came from input. */
const ROLES = new Set(['authenticated', 'anon']);

export type OrgClaims = { o: { id: string }; sub: string; role: 'authenticated' };

/**
 * THE runtime database entry point. Everything a request touches goes through here.
 *
 * The Drizzle docs' Supabase recipe interpolates the serialized claims into the
 * statement as raw SQL text — that breaks, or injects, the moment a claim value contains
 * a single quote. Bind the parameter instead. (The forbidden form is enforced by a bare
 * token grep over this file, so it is not spelled here; the one raw() call below carries
 * a role that was allow-listed against a Set two lines earlier, never a claim value.)
 *
 * The `true` on set_config is the LOCAL form: it dies with the transaction. The non-local
 * form survives the commit, and on a transaction-mode pooler the connection is handed to
 * the next request with the previous tenant's claims still set (verified).
 *
 * Both of those are load-bearing and invisible to typecheck, so they are pinned by
 * tests/db/with-org.test.ts, not by a one-time grep. Changing the `true` below to `false`
 * is mutation M4 in 01-VALIDATION.md and must turn that one test red.
 */
export async function withOrg<T>(
  claims: OrgClaims,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  if (!ROLES.has(claims.role)) throw new Error('withOrg: refusing role ' + claims.role);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`);
    await tx.execute(sql.raw('set local role ' + claims.role)); // safe: allow-listed above
    return fn(tx);
  });
}
