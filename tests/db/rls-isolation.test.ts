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
 */
import { describe, expect, it } from 'vitest';
import { actAs, actAsRole, seedTwoOrgs, withRollback } from './_fixtures';

const INSERT_BUSINESS = 'insert into businesses (org_id, display_name) values ($1,$2)';

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
