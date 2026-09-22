/**
 * D-03. JIT org provisioning: the orgs row is created on the first authenticated request
 * carrying a Clerk org claim not yet seen. It is a SECURITY DEFINER function precisely so
 * `authenticated` never holds blanket INSERT on the tenant root — which means the function
 * itself is the whole trust boundary, and the argument it is handed must be PROVED to be
 * the caller's own org.
 *
 * Mutation: delete the `if p_clerk_org_id is distinct from v_claim` guard from
 * drizzle/0004_ensure_org.sql — 'app.ensure_org refuses another org with 42501' goes red.
 *
 * Two tests, two transactions: the refusal aborts its own.
 */
import { describe, expect, it } from 'vitest';
import { actAs, withRollback } from './_fixtures';

const CALL = 'select app.ensure_org($1,$2) as id';

describe('app.ensure_org', () => {
  it('app.ensure_org is idempotent for the caller own org', () =>
    withRollback(async (c) => {
      await actAs(c, { o: { id: 'org_JIT' }, sub: 'user_danlo', role: 'authenticated' });
      const first = await c.query<{ id: string }>(CALL, ['org_JIT', 'JIT Org']);
      const second = await c.query<{ id: string }>(CALL, ['org_JIT', 'JIT Org']);
      expect(first.rows[0]?.id).toBeTruthy();
      expect(second.rows[0]?.id).toBe(first.rows[0]?.id);
      const { rows } = await c.query<{ n: number }>(
        'select count(*)::int as n from orgs where clerk_org_id = $1',
        ['org_JIT'],
      );
      expect(rows[0]?.n).toBe(1);
    }));

  it('app.ensure_org refuses another org with 42501', () =>
    withRollback(async (c) => {
      await actAs(c, { o: { id: 'org_JIT' }, sub: 'user_danlo', role: 'authenticated' });
      // A member of org A provisioning — and therefore owning — a row for org B is the
      // spoofing threat this function exists to close (T-1-01).
      await expect(c.query(CALL, ['org_SOMEONE_ELSE', 'Nope'])).rejects.toMatchObject({
        code: '42501',
      });
    }));
});
