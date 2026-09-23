/**
 * The ETL tier's identity: WHO is writing (`app.actor_id`) and FOR WHICH ORG
 * (`request.jwt.claims`). Both, per transaction, from an explicitly passed `clerk_org_id`.
 *
 * 🔴 THE DEFECT THIS FILE EXISTS TO CLOSE. `app.current_org_id()`
 * (drizzle/0002_tenancy_functions.sql) resolves the org from the `request.jwt.claims` GUC and
 * from NOTHING ELSE. `app.emit_event` (drizzle/0011) opens with
 * `v_org := app.current_org_id(); if v_org is null then raise ... '42501'`. The desk scripts
 * connect as the migration OWNER (D-01), not as a Clerk session, so nothing sets that GUC for
 * them. The asymmetry is what makes the hole easy to miss: the ACTOR already has an ETL path
 * (the Clerk subject, then `current_setting('app.actor_id', true)`, then 'system'), the ORG
 * does not. A desk script that sets only `app.actor_id` therefore raises
 * `42501 emit_event: no current org` on the FIRST `finishRun()` of the FIRST run — and the same
 * hole takes down `app.record_merge` for every auto-merge in the resolve pass. Every DB test
 * that reaches the database through `actAs` sets the claim itself, which is exactly why no
 * such test could ever have seen this. `tests/db/ingest-idempotency.test.ts`
 * 'emit_event succeeds from an owner connection with no claims' is the one that can.
 *
 * REJECTED, AND WRITTEN DOWN SO NOBODY "SIMPLIFIES" BACK TO IT: a caller-supplied `p_org_id`
 * parameter on the definers. An app-tier session could then forge the org, and T-3-08's whole
 * argument for why `merged_by` / `decided_by` are unforgeable is that the definers take
 * NEITHER `org_id` NOR `actor_id` as a parameter — both are resolved inside the definer from
 * state a client cannot set.
 *
 * 🔴 BOTH GUCs ARE TRANSACTION-LOCAL (`set_config(..., true)`) AND DIE AT COMMIT. Call
 * `setEtlActor` AND `resolveEtlOrg` inside EVERY transaction — each ~500-row ingest batch and
 * each transaction of the resolve pass. Calling either once at startup sets it for the first
 * transaction only and leaves every later batch orgless. The local form is also what keeps a
 * pooled connection from handing the next transaction the previous org (same reason as
 * `withOrg` in src/db/with-org.ts).
 *
 * Every value is a bound parameter; nothing is concatenated into statement text.
 */

/**
 * The narrowest executor these helpers need: a `pg.Client` / `pg.PoolClient`-shaped
 * `query(text, params)`. The desk scripts connect the way `scripts/seed.ts` does (an owner
 * `pg` connection), and the DB tests drive THESE helpers through `asEtlExecutor(c)` from
 * `tests/db/_ingest-fixtures.ts` — so a helper that forgets a statement is caught, which a
 * test re-typing the SQL could never do.
 */
export interface EtlExecutor {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/** The desk scripts. The actor string is `etl:<script>` and nothing else. `rederive` is
 *  scripts/rederive.ts (review 03, A-WR-06): it writes businesses only, never a merge. */
export type EtlScript = 'ingest-comptroller' | 'ingest-overture' | 'resolve' | 'rederive';

/** Thrown when no `clerk_org_id` was passed. Never recovered by picking an org. */
export class EtlOrgRequiredError extends Error {
  constructor() {
    super(
      'resolveEtlOrg: a clerk_org_id is required (pass --org=<clerk_org_id>). The ETL never ' +
        'picks an org on its own — a default like that is a bug that appears once, and only ' +
        'once a second org exists (T-3-01).',
    );
    this.name = 'EtlOrgRequiredError';
  }
}

/** Thrown when the passed `clerk_org_id` matches no `orgs` row. Names what it was handed. */
export class EtlOrgNotFoundError extends Error {
  constructor(readonly clerkOrgId: string) {
    super(`resolveEtlOrg: no org has clerk_org_id ${JSON.stringify(clerkOrgId)}`);
    this.name = 'EtlOrgNotFoundError';
  }
}

/**
 * Per transaction, per CONVENTIONS § Claims. The third argument is `true`: the
 * transaction-LOCAL form, same reason as withOrg — the non-local form survives the COMMIT and
 * hands the next request the previous actor.
 *
 * `app.log_event`, `app.emit_event` and `app.touch_updated_at` all resolve the actor as the
 * Clerk subject, then this GUC, then 'system'. The claim `resolveEtlOrg` installs carries no
 * subject, so this GUC is what they land on.
 */
export async function setEtlActor(tx: EtlExecutor, script: EtlScript): Promise<void> {
  await tx.query("select set_config('app.actor_id', $1, true)", ['etl:' + script]);
}

/**
 * Resolves the org id from an EXPLICITLY passed clerk_org_id AND installs the
 * transaction-local org claim every SECURITY DEFINER in this schema reads. Both, in the same
 * transaction. Returns `orgs.id`.
 *
 * Three deliberate omissions, each a silent defect if "helpfully" added:
 *
 *  - NO `sub`. The definers resolve `coalesce(app.jwt()->>'sub', app.actor_id GUC, 'system')`.
 *    With no `sub` the actor falls through to the GUC and the run stays attributed
 *    `etl:<script>` (T-3-02). A fabricated `sub` would silently re-attribute ~92k first-run
 *    `events` rows to a user who did nothing, and no test or constraint would fail.
 *  - NO `o.rol`. `app.current_org_role()` therefore returns NULL on an ETL connection, so a
 *    desk script cannot pass any role-gated definer (`app.set_budget_cap`). The ETL gets ORG
 *    CONTEXT, NOT ADMIN (T-3-15).
 *  - NO role switch. The desk script stays the owner (D-01). Becoming `authenticated` would
 *    put RLS in front of ~92k writes and re-introduce the grant layer these scripts
 *    deliberately sit behind.
 *
 * And never "the only org" as a fallback for a missing argument (T-3-01).
 */
export async function resolveEtlOrg(tx: EtlExecutor, clerkOrgId: string): Promise<string> {
  // 1. An explicit org, or nothing runs.
  if (typeof clerkOrgId !== 'string' || clerkOrgId.trim() === '') {
    throw new EtlOrgRequiredError();
  }

  // 2. The org row, by the key the operator passed. The owner connection bypasses RLS, so
  //    this read needs no claim.
  const { rows } = await tx.query<{ id: string }>(
    'select id from orgs where clerk_org_id = $1',
    [clerkOrgId],
  );
  const orgId = rows[0]?.id;
  if (!orgId) throw new EtlOrgNotFoundError(clerkOrgId);

  // 3. The org claim — `{o:{id}}` and NOTHING else — for the rest of THIS transaction.
  //    `app.current_org_id()` reads `coalesce(jwt->'o'->>'id', jwt->>'org_id')`, so the v2
  //    nested shape is sufficient. `true` = transaction-LOCAL: it dies at COMMIT.
  await tx.query(
    `select set_config(
       'request.jwt.claims',
       json_build_object('o', json_build_object('id', $1::text))::text,
       true
     )`,
    [clerkOrgId],
  );
  return orgId;
}
