/**
 * Criterion 2. Two seeded orgs, always: with one org a policy that returns everything and
 * a policy that returns the caller's rows are the same result set.
 *
 * One refused statement per withRollback. A refusal aborts the transaction and the next
 * statement reports 25P02 instead of its own reason, so each refusal gets its own test.
 *
 * Under RLS a cross-org SELECT/UPDATE/DELETE is FILTERED to zero rows, not refused; only
 * an INSERT carrying a foreign org_id raises. Criterion 2 needs both halves.
 *
 * Mutation: drop the `with check` clause from the businesses_insert policy in
 * drizzle/0003_policies.sql — 'org A cannot INSERT into org B, and the refusal is 42501'
 * goes red, and only that one.
 * Second mutation: `grant update on public.orgs to authenticated` against the live database
 * — 'a tenant cannot re-key its own clerk_org_id' goes red, and only that one.
 */
import { describe, expect, it } from 'vitest';
import { actAs, actAsRole, seedTwoOrgs, SQL_FRESH_EXTERNAL_KEY, withRollback } from './_fixtures';

const INSERT_BUSINESS = `insert into businesses (org_id, display_name, external_key) values ($1,$2,${SQL_FRESH_EXTERNAL_KEY})`;

describe('RLS tenant isolation', () => {
  it('org A sees only its own org rows under a v1 flat claim', () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoOrgs(c);
      await c.query(INSERT_BUSINESS, [a, 'Alpha Roofing']);
      await c.query(INSERT_BUSINESS, [b, 'Bravo Plumbing']);
      await actAs(c, { org_id: 'org_A', sub: 'user_danlo', role: 'authenticated' });
      const { rows } = await c.query<{ display_name: string }>(
        'select display_name from businesses',
      );
      expect(rows.map((r) => r.display_name)).toEqual(['Alpha Roofing']);
    }));

  it('a token v2 nested claim resolves the same org as v1', () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoOrgs(c);
      await c.query(INSERT_BUSINESS, [a, 'Alpha Roofing']);
      await c.query(INSERT_BUSINESS, [b, 'Bravo Plumbing']);
      // Clerk session token v2 nests the org claim under `o`, and only while an
      // organization is ACTIVE. app.current_org_id() coalesces both shapes (D-11).
      await actAs(c, { o: { id: 'org_A' }, sub: 'user_danlo', role: 'authenticated' });
      const { rows } = await c.query<{ display_name: string }>(
        'select display_name from businesses',
      );
      expect(rows.map((r) => r.display_name)).toEqual(['Alpha Roofing']);
    }));

  it('org A cannot INSERT into org B, and the refusal is 42501', () =>
    withRollback(async (c) => {
      const { b } = await seedTwoOrgs(c);
      await actAs(c, { o: { id: 'org_A' }, sub: 'user_danlo', role: 'authenticated' });
      const attempt = c.query(INSERT_BUSINESS, [b, 'pwned']);
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      // 42501 also covers a plain grant refusal, and plan 09's events tests turn on
      // telling the two apart — so pin the message as well as the code.
      await expect(attempt).rejects.toThrow(/row-level security/);
    }));

  it('a second statement in the same aborted transaction reports 25P02', () =>
    withRollback(async (c) => {
      await seedTwoOrgs(c);
      await actAs(c, { org_id: 'org_A', sub: 'user_danlo', role: 'authenticated' });
      // Deliberately NOT the cross-org business INSERT. This test's subject is the
      // transaction-abort rule, and borrowing the previous test's refusal coupled the two:
      // the M1 mutation then turned TWO tests red, which is exactly how a mutation check
      // stops telling you which guard you broke. `orgs` has no INSERT policy for
      // `authenticated` at all (T-1-23), so this refusal rests on a different invariant.
      await c
        .query('insert into orgs (clerk_org_id, name_internal, display_name) values ($1,$2,$3)', [
          'org_C',
          'Charlie (test)',
          'Charlie',
        ])
        .catch(() => undefined);
      await expect(c.query('select 1')).rejects.toMatchObject({ code: '25P02' });
    }));

  it('a cross-org UPDATE and DELETE are filtered, not refused', () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoOrgs(c);
      await c.query(INSERT_BUSINESS, [a, 'Alpha Roofing']);
      await c.query(INSERT_BUSINESS, [b, 'Bravo Plumbing']);
      await actAs(c, { org_id: 'org_A', sub: 'user_danlo', role: 'authenticated' });
      const updated = await c.query('update businesses set display_name = $2 where org_id = $1', [
        b,
        'x',
      ]);
      expect(updated.rowCount).toBe(0);
      const deleted = await c.query('delete from businesses where org_id = $1', [b]);
      expect(deleted.rowCount).toBe(0);
    }));

  /**
   * CR-02. The `orgs_update` policy protects `id` and nothing else: USING passes because
   * A.id = A.id, and WITH CHECK passes because NEW.id is still A.id — app.current_org_id()
   * is STABLE and resolves against the pre-statement row. So the policy alone let a member
   * of tenant A point A's row at any not-yet-provisioned Clerk organisation, after which
   * that organisation's users resolve, through app.current_org_id() and app.ensure_org,
   * INTO tenant A — reading and writing A's rows — while A's own members lose their tenant.
   *
   * The fix is a column-level privilege, which PostgreSQL checks against the statement's
   * SET list. The suite already pins that businesses.org_id cannot be moved across tenants;
   * this is the same claim for the tenant root's own key, which had no test at all.
   *
   * The refusal rests on a DIFFERENT invariant from the other two in this file (the
   * businesses WITH CHECK, and orgs having no INSERT policy), so a mutation to any one of
   * the three reds exactly one test.
   */
  it('a tenant cannot re-key its own clerk_org_id', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, { o: { id: 'org_A' }, sub: 'user_danlo', role: 'authenticated' });
      const attempt = c.query("update orgs set clerk_org_id = 'org_X' where id = $1", [a]);
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      // The wording, not only the code. A GRANT refusal says "permission denied for table
      // orgs"; an RLS refusal says "new row violates row-level security policy". Only the
      // message tells them apart, and this guard is the grant one — if it ever starts
      // reading as an RLS refusal the column privilege has been replaced by something
      // weaker.
      await expect(attempt).rejects.toThrow(/permission denied for table orgs/);
    }));

  it('positive control: a tenant can still rename itself, and the touch trigger still fires', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, { o: { id: 'org_A' }, sub: 'user_danlo', role: 'authenticated' });
      // Revoking too much is the other way to break this database. display_name is one of
      // the three columns the grant keeps.
      const renamed = await c.query<{ display_name: string; updated_by: string | null }>(
        'update orgs set display_name = $2 where id = $1 returning display_name, updated_by',
        [a, 'Renamed'],
      );
      expect(renamed.rowCount).toBe(1);
      expect(renamed.rows[0]?.display_name).toBe('Renamed');
      // updated_by is NOT in the column grant, and app.touch_updated_at() writes it anyway:
      // PostgreSQL checks column privileges against the statement's SET list, not against
      // what a BEFORE trigger goes on to change. That is the property that makes a
      // column-level grant usable here at all, so it is asserted rather than assumed.
      expect(renamed.rows[0]?.updated_by).toBe('user_danlo');
    }));

  it('a connection without set local role authenticated is refused 42501', () =>
    withRollback(async (c) => {
      await seedTwoOrgs(c);
      // app_user is NOINHERIT and owns nothing: it holds `authenticated` but does not use
      // its privileges until it explicitly SET ROLEs, so a forgotten wrapper fails loudly
      // instead of reading every tenant. D-11b.
      await actAsRole(c, 'app_user');
      const attempt = c.query('select * from businesses');
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(/permission denied/);
    }));
});
