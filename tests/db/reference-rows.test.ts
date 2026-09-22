/**
 * SRCH-02 / T-2-09 / T-2-10. What makes a built-in a built-in.
 *
 * 🔴 THE TRAP THIS FILE EXISTS TO AVOID. The obvious test —
 * `await expect(update).rejects.toThrow('42501')` — is GREEN FOR THE WRONG REASON on
 * UPDATE and DELETE. RLS does not refuse a statement aimed at an invisible row; it FILTERS
 * the row out and the statement succeeds having changed nothing. Executed on PostgreSQL
 * 18.6: `update ... where org_id is null` returns `rowCount 0` and raises nothing, `delete`
 * likewise, and ONLY an INSERT carrying `org_id = null` raises `42501` with the
 * row-level-security wording that the forged-INSERT test below pins verbatim — the literal
 * appears exactly once in this file, in that assertion, so that grepping for it finds the
 * guard rather than the commentary. A refusal-shaped test would therefore
 * have passed against a policy that had been widened to permit the update, because the
 * update would still have been refused — by a different guard, for a different reason.
 * So the zero-row cases are asserted with `rowCount` and 42501 is pinned for the forged
 * INSERT alone (src/db/schema/_helpers.ts § referencePolicies, surprise 1).
 *
 * One refused statement per rolled-back transaction: a refusal aborts the transaction and
 * the next statement reports 25P02 rather than its own reason. The two refusals below rest
 * on DIFFERENT invariants — the insert policy's WITH CHECK, and the unique constraint.
 *
 * Two orgs, always. A policy that returns everything and a policy that returns the
 * caller's rows are the same result set with one tenant.
 *
 * Mutations executed against the LIVE database during plan 02-06, each reverted and each
 * verified back from pg_policy / pg_constraint rather than from the fact that a script ran:
 *
 *   `alter policy industry_clusters_update on industry_clusters using (true) with check (true)`
 *     -> 'built-in rows: a tenant UPDATE is filtered to zero rows, not refused' red, ALONE
 *        (9 of 10 green), failing on the built-in assertion with the tenant's own-row
 *        positive control already passed.
 *
 *   `alter table industry_clusters drop constraint industry_clusters_org_key_uniq`
 *     -> reds TWO tests, and that coupling is deliberate rather than a defect to design
 *        away: 'a duplicate built-in is refused with 23505' and 'seed idempotent: a second
 *        upsert changes no row count' ARE the same invariant seen from two sides —
 *        idempotency is not a property of the loader, it is UNIQUE ... NULLS NOT DISTINCT.
 *        They still fail DIFFERENTLY and diagnostically: the first because the duplicate
 *        INSERT resolves instead of rejecting, the second with 42704 raised by the
 *        loader's own `on conflict on constraint` naming a constraint that is gone. A
 *        third test would be needed to separate them only if there were a third thing to
 *        separate.
 */
import { describe, expect, it } from 'vitest';
import { actAs, actAsOwner, seedTwoOrgs, withRollback } from './_fixtures';
import { clustersFile, upsertIndustryClusters } from '../../scripts/seed';

const ORG_A_CLAIMS = { o: { id: 'org_A' }, sub: 'user_danlo', role: 'authenticated' } as const;

/** The seeded built-ins, as committed. The counts are the seed loader's contract. */
const BUILT_IN_CLUSTERS = 4;
const BUILT_IN_COUNTIES = 254;

async function countBuiltIn(
  c: Parameters<Parameters<typeof withRollback>[0]>[0],
  table: string,
): Promise<number> {
  const { rows } = await c.query<{ n: number }>(
    `select count(*)::int as n from ${table} where org_id is null`,
  );
  return rows[0]?.n ?? -1;
}

describe('built-in reference rows', () => {
  it('built-in reference rows are visible to a tenant', () =>
    withRollback(async (c) => {
      await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      // The POSITIVE read comes first and is not decoration: every refusal below would also
      // pass against a policy that refused everything, and this is the assertion that tells
      // "a built-in is read-only" apart from "the reference tables are unreadable".
      expect(await countBuiltIn(c, 'industry_clusters')).toBe(BUILT_IN_CLUSTERS);
      expect(await countBuiltIn(c, 'counties')).toBe(BUILT_IN_COUNTIES);
    }));

  it('built-in rows: a tenant UPDATE is filtered to zero rows, not refused', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);

      // POSITIVE CONTROL FIRST, deliberately. The tenant's OWN row in the same table is an
      // ordinary tenant row and is fully writable; without this, a policy of
      // `using (false)` would look identical to the correct one. It runs first so that the
      // targeted mutation below reds the built-in assertion specifically — the control has
      // already executed and passed by then, instead of being skipped by the failure.
      await c.query(
        "insert into industry_clusters (org_id, key, display_name) values ($1, 'tenant_own', 'Tenant Own')",
        [a],
      );
      const own = await c.query(
        "update industry_clusters set display_name = 'Renamed' where org_id = $1 and key = 'tenant_own'",
        [a],
      );
      expect(own.rowCount).toBe(1);

      // No .rejects here, deliberately. This statement SUCCEEDS and changes nothing.
      // `alter policy industry_clusters_update ... using (true) with check (true)` makes it
      // return 4 and reds this line alone.
      const builtIn = await c.query(
        "update industry_clusters set display_name = 'x' where org_id is null",
      );
      expect(builtIn.rowCount).toBe(0);
    }));

  it('built-in rows: a tenant DELETE is filtered to zero rows, not refused', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);

      // Positive control first, on the same table and for the same statement kind, for the
      // reason spelled out in the UPDATE test above.
      await c.query(
        `insert into geo_presets (org_id, key, display_name, kind, payload)
         values ($1, 'tenant_own', 'Tenant Own', 'counties', '{"countyIds":[]}'::jsonb)`,
        [a],
      );
      const own = await c.query(
        "delete from geo_presets where org_id = $1 and key = 'tenant_own'",
        [a],
      );
      expect(own.rowCount).toBe(1);

      const builtIn = await c.query('delete from geo_presets where org_id is null');
      expect(builtIn.rowCount).toBe(0);
    }));

  it('built-in rows: a forged INSERT carrying org_id NULL is refused with 42501', () =>
    withRollback(async (c) => {
      await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      // The ONE statement kind RLS can refuse here: there is no existing row to filter, so
      // the insert policy's WITH CHECK sees the forged row and rejects it.
      const attempt = c.query(
        "insert into industry_clusters (org_id, key, display_name) values (null, 'forged', 'Forged')",
      );
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      // The MESSAGE, not only the code. 42501 also covers a grant refusal
      // ("permission denied for table ..."), and tests/db/versioned-presets.test.ts turns
      // entirely on telling the two apart. If this ever starts reading as a grant refusal,
      // the policy has been replaced by something with different semantics.
      await expect(attempt).rejects.toThrow(/new row violates row-level security policy/);
    }));

  it('built-in rows: a duplicate built-in is refused with 23505', () =>
    withRollback(async (c) => {
      await seedTwoOrgs(c);
      // As the OWNER: `authenticated` cannot write an org_id IS NULL row at all, so a
      // tenant could never reach this constraint. The duplicate the seed loader must not
      // create is one the LOADER would create, and the loader is the owner.
      await actAsOwner(c);
      const attempt = c.query(
        "insert into industry_clusters (org_id, key, display_name) values (null, 'home_services', 'Duplicate')",
      );
      await expect(attempt).rejects.toMatchObject({ code: '23505' });
      // This is what UNIQUE ... NULLS NOT DISTINCT buys, and the name is pinned because a
      // plain UNIQUE (org_id, key) ACCEPTS this row — NULL != NULL — leaving the seed
      // loader silently doubling every built-in on its second run.
      await expect(attempt).rejects.toThrow(/industry_clusters_org_key_uniq/);
    }));

  it('seed idempotent: a second upsert changes no row count', () =>
    withRollback(async (c) => {
      await seedTwoOrgs(c);
      await actAsOwner(c);

      // scripts/seed.ts's OWN exported upsert, not a restatement of it. A test that retypes
      // the SQL proves that the retyped SQL is idempotent and says nothing about the loader.
      const first = await upsertIndustryClusters(c);
      const afterFirst = await c.query<{ id: string; key: string }>(
        'select id, key from industry_clusters where org_id is null order by key',
      );
      const second = await upsertIndustryClusters(c);
      const afterSecond = await c.query<{ id: string; key: string }>(
        'select id, key from industry_clusters where org_id is null order by key',
      );

      expect(afterFirst.rows).toHaveLength(BUILT_IN_CLUSTERS);
      expect(afterSecond.rows).toHaveLength(BUILT_IN_CLUSTERS);
      // Not just the count: the IDENTITIES. A loader that deleted and re-inserted would
      // hold the count constant while breaking every FK that cites a cluster — which is
      // precisely what outlet_counts and industry_terms do.
      expect(afterSecond.rows).toEqual(afterFirst.rows);
      // Both passes touched every row rather than skipping: 4 statements, 0 new rows.
      expect(first.inserted + first.updated).toBe(BUILT_IN_CLUSTERS);
      expect(second.inserted).toBe(0);
      expect(second.updated).toBe(BUILT_IN_CLUSTERS);
      // And the committed corpus is the source of the count, so a fifth cluster added to
      // clusters.json without touching this file fails here rather than silently.
      expect(clustersFile().clusters).toHaveLength(BUILT_IN_CLUSTERS);
    }));

  it("built-in rows: org A cannot see org B's own reference row", () =>
    withRollback(async (c) => {
      const { b } = await seedTwoOrgs(c);
      // Inserted by the owner so that this test's subject is the READ policy alone. T-2-10:
      // admitting `org_id is null` on read must not have widened the read to everything.
      await c.query(
        "insert into industry_clusters (org_id, key, display_name) values ($1, 'bravo_only', 'Bravo Only')",
        [b],
      );
      await actAs(c, ORG_A_CLAIMS);
      const { rows } = await c.query<{ key: string }>(
        'select key from industry_clusters where org_id is not null',
      );
      expect(rows.map((r) => r.key)).toEqual([]);
      // ...while the built-ins stay visible in the same breath, so "org A sees nothing" is
      // excluded as the explanation.
      expect(await countBuiltIn(c, 'industry_clusters')).toBe(BUILT_IN_CLUSTERS);
    }));
});
