import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from './client';

/** D-12. The coordinate purge is cross-org by nature, so it cannot run through withOrg().
 *  This is the second database path outside withOrg (after /api/health's `select 1`), and it
 *  can do exactly one thing: siteless_cron holds EXECUTE on app.purge_expired_place_coordinates
 *  and no privilege on any table. Never interpolate a role that came from input. */
const CRON_ROLE = 'siteless_cron' as const;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `fn` in one transaction as `siteless_cron` (drizzle/0027 creates it NOLOGIN and grants
 * it to app_user; drizzle/0028 grants it `usage on schema app` and EXECUTE on the purge only).
 *
 * `set local role` — the LOCAL form dies with the transaction, so a pooled connection is
 * never handed back still wearing the cron role (the same reason withOrg uses the local
 * set_config). The role is a module constant, never a parameter; the one raw() call below
 * concatenates nothing that came from a caller. No claims are set: the purge takes no org,
 * and a tenant table read from here is `42501 permission denied` (tests/db/places-definers).
 */
export async function withCronRole<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw('set local role ' + CRON_ROLE));
    return fn(tx);
  });
}
