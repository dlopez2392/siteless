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
 * Second mutation: `grant insert on public.events to authenticated` against the live
 * database — 'a caller cannot author its own audit row' goes red, and only that one.
 */
import { describe, expect, it } from 'vitest';
import { actAs, seedTwoOrgs, withRollback } from './_fixtures';

const EMIT = 'select app.emit_event($1::text, $2::uuid, $3::text, $4::jsonb) as id';

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

  /**
   * WR-01. Append-only protected the PAST and left the present writable: `authenticated`
   * held INSERT (0007 line 71, re-granted by 0008 step 2) and `events_insert` admitted any
   * row whose org_id matched the caller. So a tenant session could write
   *
   *   insert into events (org_id, actor_id, entity_type, entity_id, action, before, after)
   *   values (<own org>, 'user_someone_else', 'businesses', <id>, 'delete', ...)
   *
   * and the record of truth recorded a state change that never happened, attributed to
   * somebody who never acted. D-06's integrity then rested on the application tier never
   * issuing that statement — which is precisely the assumption the trigger design was
   * chosen to stop relying on. app.log_event() is SECURITY DEFINER and never needed the
   * grant.
   *
   * Its own transaction: the refusal aborts the one it runs in.
   */
  it('a caller cannot author its own audit row', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const attempt = c.query(
        'insert into events (org_id, actor_id, entity_type, action) values ($1,$2,$3,$4)',
        [a, 'user_someone_else', 'businesses', 'delete'],
      );
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      // A GRANT refusal, not the RLS one. Without the revoke the events_insert policy
      // would ACCEPT this row — org_id is the caller's own — so a message assertion is the
      // only thing that distinguishes the fix from the hole.
      await expect(attempt).rejects.toThrow(/permission denied for table events/);
    }));

  /**
   * The positive control for the revoke above, and the reason it does not cost Phase 3 its
   * run-level event (.planning/CONVENTIONS.md: bulk ingest writes ONE event per run rather
   * than one per row). app.emit_event is SECURITY DEFINER, so it needs no grant, and it
   * takes neither org_id nor actor_id as a parameter — it reads both out of the
   * transaction-local claims itself. That is the whole point: the legitimate app-tier path
   * survives and a caller-authored actor does not.
   */
  it('positive control: app.emit_event writes and stamps the actor itself', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const emitted = await c.query<{ id: string }>(EMIT, [
        'ingest_runs',
        null,
        'insert',
        JSON.stringify({ rows: 10 }),
      ]);
      expect(emitted.rows[0]?.id).toBeTruthy();

      const { rows } = await c.query<{
        org_id: string;
        actor_id: string;
        entity_type: string;
        action: string;
        rows_written: string | null;
        has_occurred_at: boolean;
      }>(`
        select org_id, actor_id, entity_type, action,
               after->>'rows'            as rows_written,
               (occurred_at is not null) as has_occurred_at
          from events
         where entity_type = 'ingest_runs'
         order by id desc
         limit 1`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        org_id: a,
        actor_id: 'user_danlo',
        entity_type: 'ingest_runs',
        action: 'insert',
        rows_written: '10',
        has_occurred_at: true,
      });
    }));
});
