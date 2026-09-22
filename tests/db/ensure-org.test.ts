/**
 * D-03. JIT org provisioning: the orgs row is created on the first authenticated request
 * carrying a Clerk org claim not yet seen. It is a SECURITY DEFINER function precisely so
 * `authenticated` never holds blanket INSERT on the tenant root — which means the function
 * itself is the whole trust boundary, and the argument it is handed must be PROVED to be
 * the caller's own org.
 *
 * Mutation: delete the `if p_clerk_org_id is distinct from v_claim` guard from
 * drizzle/0004_ensure_org.sql — 'app.ensure_org refuses another org with 42501' goes red.
 * Second mutation: restore 0004's `on conflict (clerk_org_id) do update set clerk_org_id =
 * excluded.clerk_org_id` in place of 0009's select-then-insert — 'app.ensure_org writes
 * nothing on an already-provisioned org' goes red, and only that one.
 *
 * Three tests, three transactions: the refusal aborts its own.
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

  /**
   * CR-01. `page.tsx` calls ensureOrgRow() on EVERY render, so whatever this function does
   * on the already-provisioned path, it does once per signed-in page view. 0004 resolved
   * that path with `on conflict ... do update set clerk_org_id = excluded.clerk_org_id`,
   * and PostgreSQL executes the DO UPDATE arm as a real row UPDATE — a same-value SET is
   * not a no-op — so `orgs_touch` and `orgs_event` both fired. D-06's "record of truth for
   * every state change" then grew one fabricated `update` row per request, and D-07's
   * updated_at/updated_by meant "last VIEWED by" rather than "last changed by".
   *
   * updated_by is the discriminator, not updated_at: now() is transaction_timestamp() and
   * is constant for the whole transaction, so an insert and a later touch inside one
   * withRollback carry the identical updated_at and the comparison would be unfalsifiable.
   * app.touch_updated_at() is BEFORE UPDATE only — an INSERT never fires it — so
   * updated_by IS NULL is positive proof that no UPDATE reached the row.
   */
  it('app.ensure_org writes nothing on an already-provisioned org', () =>
    withRollback(async (c) => {
      await actAs(c, { o: { id: 'org_JIT' }, sub: 'user_danlo', role: 'authenticated' });
      const first = await c.query<{ id: string }>(CALL, ['org_JIT', 'JIT Org']);
      const id = first.rows[0]?.id;
      expect(id).toBeTruthy();
      const second = await c.query<{ id: string }>(CALL, ['org_JIT', 'JIT Org']);
      expect(second.rows[0]?.id).toBe(id);

      // Grouped and ordered, never pre-filtered to the action under suspicion: the row
      // COUNT is the control. `[{ action: 'insert', n: 1 }]` says both that provisioning
      // logged exactly once and that nothing else was logged at all.
      const { rows } = await c.query<{ action: string; n: number }>(
        `select action, count(*)::int as n
           from events
          where entity_type = 'orgs' and entity_id = $1
          group by action
          order by action`,
        [id],
      );
      expect(rows).toEqual([{ action: 'insert', n: 1 }]);

      const touched = await c.query<{ updated_by: string | null }>(
        'select updated_by from orgs where id = $1',
        [id],
      );
      expect(touched.rows).toHaveLength(1);
      expect(touched.rows[0]?.updated_by).toBeNull();
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
