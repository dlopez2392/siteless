import { drizzle } from 'drizzle-orm/postgres-js';
import type { Client } from 'pg';
import postgres from 'postgres';
import { drizzleExecutor } from '@/db/drizzle-executor';
import * as schema from '@/db/schema';
import type { Tx } from '@/server/queries/budget';

/**
 * A rolled-back DRIZZLE transaction on the RUNTIME driver, for the DB tests that drive a
 * `tx`-taking query module or action core (plan 03-15).
 *
 * WHY NOT `withRollback` FROM `_fixtures.ts`. That hands a `pg.Client`; the query modules take
 * drizzle's postgres-js transaction and call `tx.execute(sql)`. A different driver would prove
 * the wrong thing: it is postgres.js through drizzle, with `prepare: false`, that returns a
 * `timestamptz` as a STRING, throws on a bound `Date`, and expands a JS array into N
 * placeholders. So the transaction here is built exactly the way `src/db/client.ts` builds
 * the app's — postgres.js, `prepare: false`, `max: 1`, the same `schema` — and only the
 * connection's identity differs.
 *
 * WHY THE OWNER, NOT `app_user`. The fixtures must insert rows `authenticated` holds
 * SELECT-only on (`merge_candidates`, `ingest_runs`) and orgs it cannot create; they run as
 * the owner BEFORE `actAs`, exactly as in every other DB test. `actAs(asPg(tx), claims)` then
 * sets the claims and `set local role authenticated` — a Clerk user under RLS AND the column
 * grants, which a service-role fixture is blind to.
 *
 * 🔴 EVERYTHING ROLLS BACK. The callback's work is discarded by a thrown sentinel; nothing is
 * committed, so a concurrently running plan's DB tests never see these rows.
 *
 * `asPg(tx)` exposes the transaction as the `{ query(text, params) }` shape the existing
 * fixtures (`seedTwoOrgs`, `actAs`, `seedMergePair`, ...) call — through the SAME adapter the
 * review actions use (`src/db/drizzle-executor.ts`), so every fixture statement is one more
 * proof of that adapter against the real database.
 */

let client: ReturnType<typeof postgres> | null = null;
let ownerDb: ReturnType<typeof makeDb> | null = null;

function makeDb(c: ReturnType<typeof postgres>) {
  return drizzle({ client: c, schema });
}

function db() {
  if (ownerDb) return ownerDb;
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('tests/db/_drizzle-tx.ts: TEST_DATABASE_URL is not set.');
  if (/supabase\.(co|com)|pooler\.supabase/.test(url)) {
    throw new Error(
      'tests/db/_drizzle-tx.ts: TEST_DATABASE_URL points at a Supabase host. D-04: production is never a test target.',
    );
  }
  client = postgres(url, { prepare: false, max: 1, connect_timeout: 10 });
  ownerDb = makeDb(client);
  return ownerDb;
}

/** Ends the pool. Safe to call when nothing was opened; a later call to `withTxRollback` reopens. */
export async function closeDrizzleTx(): Promise<void> {
  const c = client;
  client = null;
  ownerDb = null;
  if (c) await c.end({ timeout: 5 });
}

class RolledBack extends Error {}

export async function withTxRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db().transaction(async (tx) => {
      await fn(tx as unknown as Tx);
      throw new RolledBack('rolled back by design');
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

/** The transaction as the `pg.Client`-shaped `{ query }` the shared fixtures call. */
export function asPg(tx: Tx): Client {
  return drizzleExecutor(tx) as unknown as Client;
}
