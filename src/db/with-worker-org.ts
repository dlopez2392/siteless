import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from './client';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * D-14 tier context. A workflow step has no Clerk request: the org comes from the run's own
 * server-verified start input. This is the third database path outside withOrg (after
 * /api/health's `select 1` and withCronRole) — CONVENTIONS § Database access.
 *
 * The claims are `{o:{id}}` ONLY, mirroring `resolveEtlOrg` (src/lib/ingest/etl-actor.ts):
 *
 *  - NO subject claim. Attribution falls to the `app.actor_id` GUC (`workflow:<runId>`), the
 *    way the desk ETL lands on `etl:<script>`. A fabricated user would silently re-attribute
 *    every event a sweep writes to somebody who did nothing.
 *  - NO role claim. `app.current_org_role()` is therefore NULL here, so a workflow can never
 *    pass an admin-gated definer (`app.set_budget_cap`): ORG CONTEXT, NOT ADMIN.
 *  - `set local role authenticated`, so RLS and the column grants stand in front of every
 *    statement exactly as they do for a signed-in human. The first statement of every step
 *    re-reads the run under that RLS; a mismatched org sees zero rows and fails closed (M46).
 *
 * Per transaction, never per step: both GUCs are set with the transaction-LOCAL `true`, so they
 * die at COMMIT and a pooled connection is never handed on still wearing this tenant. Both
 * values are bound parameters; the one raw() call carries a constant.
 */
export async function withWorkerOrg<T>(
  clerkOrgId: string,
  actor: `workflow:${string}`,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (typeof clerkOrgId !== 'string' || clerkOrgId.trim() === '') {
    throw new Error('withWorkerOrg: a clerk org id is required');
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('request.jwt.claims', json_build_object('o', json_build_object('id', ${clerkOrgId}::text))::text, true)`,
    );
    await tx.execute(sql`select set_config('app.actor_id', ${actor}, true)`);
    await tx.execute(sql.raw('set local role authenticated'));
    return fn(tx);
  });
}
