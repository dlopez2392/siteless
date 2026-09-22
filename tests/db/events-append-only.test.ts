/**
 * D-06: events is the record of truth for every state change, and its immutability is a
 * GRANT, not a policy. The message matters as much as the code — an RLS refusal says
 * "new row violates row-level security policy" and a grant refusal says "permission denied
 * for table events". Asserting only 42501 cannot tell them apart, and this file is where
 * the difference is the whole point.
 *
 * BIS's version has two defects this port fixes: an un-argumented `.rejects.toThrow`
 * passes on ANY error, including a typo in the SQL, and it puts two refusals in ONE
 * transaction — the second reports 25P02, not its own reason. The argument-free spelling
 * is not written out here either: an acceptance grep requires it to be absent from this
 * file, and a comment naming the thing it forbids trips the guard it describes (01-06).
 *
 * Mutation: delete the `revoke update, delete on events from authenticated` line from
 * drizzle/0007_event_triggers.sql — 'events are append-only: UPDATE as authenticated is
 * refused' goes red, and only that one.
 */
import { describe, expect, it } from 'vitest';
import { actAs, seedTwoOrgs, withRollback } from './_fixtures';

const ORG_A_CLAIMS = { o: { id: 'org_A' }, sub: 'user_danlo', role: 'authenticated' } as const;
const INSERT_BUSINESS = 'insert into businesses (org_id, display_name) values ($1,$2)';

describe('events are immutable by grant', () => {
  it('events are append-only: UPDATE as authenticated is refused', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      // Insert as the owner first so real event rows exist. A refusal proved over an
      // empty table keeps passing the day the trigger stops firing.
      await c.query(INSERT_BUSINESS, [a, 'Alpha Roofing']);
      await actAs(c, ORG_A_CLAIMS);
      const attempt = c.query("update events set action = 'hacked'");
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      // The wording, not only the code. Without the revoke this statement is merely
      // FILTERED to zero rows by RLS and reads as "nothing happened"; 42501 alone is also
      // what a policy refusal raises, and a policy is the thing a later `for all` widens.
      await expect(attempt).rejects.toThrow(/permission denied for table events/);
    }));

  it('events are append-only: DELETE as authenticated is refused', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await c.query(INSERT_BUSINESS, [a, 'Alpha Roofing']);
      await actAs(c, ORG_A_CLAIMS);
      // Its own transaction on purpose: the UPDATE refusal above aborts the one it runs
      // in, and any further statement there reports 25P02 instead of its own reason.
      const attempt = c.query('delete from events');
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(/permission denied for table events/);
    }));
});
