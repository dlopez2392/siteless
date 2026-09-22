/**
 * D-08: attribution is a property of the database, not of anybody's memory. The acceptance
 * test is literally "a direct write still produces an event" — raw SQL, no application
 * code anywhere in the path. BIS logged events from the application tier through emit(),
 * which existed as five byte-identical copies, and a fix reached exactly one of them. A
 * write helper cannot pass the test below; an AFTER ... FOR EACH ROW trigger does.
 *
 * D-07: updated_at / updated_by are denormalized so a list can say "changed 2h ago by
 * danlo" without a join. A BEFORE UPDATE trigger is what stops them being a lie the first
 * time somebody writes SQL by hand.
 *
 * Mutation: `drop trigger businesses_event on businesses` — 'a direct write still produces
 * an event' goes red, and only that one.
 * Second mutation: `drop trigger businesses_touch on businesses` — 'an UPDATE of only a
 * domain column still moves updated_at and stamps updated_by' goes red, and only that one.
 */
import { describe, expect, it } from 'vitest';
import { actAs, seedTwoOrgs, withRollback } from './_fixtures';

const ORG_A_CLAIMS = { o: { id: 'org_A' }, sub: 'user_danlo', role: 'authenticated' } as const;

/**
 * The event-scope boundary, as a Set literal IN THIS FILE rather than a config file, so
 * widening it is a diff a reviewer sees (.planning/CONVENTIONS.md records the decision).
 *
 * source_records is the deliberate exclusion: Phase 3 ingests ~10k Comptroller and Overture
 * rows per run, and a row trigger there would write 10k event rows each carrying a full
 * before/after payload. Bulk ingest writes ONE run-level event instead. Any OTHER
 * state-bearing table added later must appear here, which is what stops Phase 3 shipping a
 * table with no attribution.
 */
const EVENT_LOGGED = new Set(['orgs', 'businesses']);

type LatestEvent = {
  actor_id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  name: string | null;
  has_before: boolean;
  has_after: boolean;
  has_occurred_at: boolean;
  age_seconds: string | null;
};

// occurred_at is compared in SQL. A timestamptz handed back through pg becomes a JS Date,
// and this suite runs in UTC on an America/Chicago machine — the round trip is exactly
// where a wrong comparison hides.
const LATEST_BUSINESS_EVENT = `
  select actor_id,
         entity_type,
         entity_id,
         action,
         after->>'display_name'                       as name,
         (before is not null)                         as has_before,
         (after is not null)                          as has_after,
         (occurred_at is not null)                    as has_occurred_at,
         extract(epoch from (now() - occurred_at))::text as age_seconds
    from events
   where entity_type = 'businesses'
   order by id desc
   limit 1`;

const LOG_EVENT_TRIGGERS = `
  select c.relname as table_name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal
     and n.nspname = 'public'
     and p.proname = 'log_event'
   order by c.relname`;

describe('attribution is a property of the database', () => {
  it('a direct write still produces an event', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);

      // Raw SQL issued by the test itself — no ORM, no helper, no emit(). That is the
      // entire claim: a write nothing in src/ made still lands in the audit trail, with
      // the Clerk actor the trigger read out of the transaction-local claims.
      const ins = await c.query<{ id: string }>(
        "insert into businesses (org_id, display_name) values ($1, 'direct-write') returning id",
        [a],
      );
      const businessId = ins.rows[0]?.id;
      expect(businessId).toBeTruthy();

      const first = await c.query<LatestEvent>(LATEST_BUSINESS_EVENT);
      expect(first.rows).toHaveLength(1);
      expect(first.rows[0]).toMatchObject({
        actor_id: 'user_danlo',
        entity_type: 'businesses',
        action: 'insert',
        name: 'direct-write',
        has_occurred_at: true,
      });
      expect(first.rows[0]?.entity_id).toBe(businessId);
      expect(Number(first.rows[0]?.age_seconds)).toBeGreaterThanOrEqual(0);
      expect(Number(first.rows[0]?.age_seconds)).toBeLessThan(60);

      await c.query("update businesses set display_name = 'renamed' where id = $1", [businessId]);
      const second = await c.query<LatestEvent>(LATEST_BUSINESS_EVENT);
      expect(second.rows).toHaveLength(1);
      // An UPDATE carries both halves: what it was and what it became.
      expect(second.rows[0]).toMatchObject({
        actor_id: 'user_danlo',
        action: 'update',
        name: 'renamed',
        has_before: true,
        has_after: true,
      });
    }));

  it('an UPDATE of only a domain column still moves updated_at and stamps updated_by', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);

      // The baseline is aged DELIBERATELY. now() is transaction_timestamp() and is constant
      // for the whole transaction, so a row inserted and then updated inside one
      // withRollback carries the identical updated_at whether the trigger fires or not —
      // "strictly greater" would be unfalsifiable. Backdating the insert restores the
      // discrimination that two separate transactions would give in production.
      const ins = await c.query<{ id: string; epoch: string }>(
        'insert into businesses (org_id, display_name, updated_at) ' +
          "values ($1, 'Alpha Roofing', now() - interval '1 hour') " +
          'returning id, extract(epoch from updated_at)::text as epoch',
        [a],
      );
      const businessId = ins.rows[0]?.id;
      const beforeEpoch = Number(ins.rows[0]?.epoch);
      expect(businessId).toBeTruthy();
      expect(beforeEpoch).toBeGreaterThan(0);

      await actAs(c, ORG_A_CLAIMS);
      // city is a domain column and nothing else is named: no updated_at, no updated_by.
      const upd = await c.query<{ epoch: string; updated_by: string | null }>(
        "update businesses set city = 'McAllen' where id = $1 " +
          'returning extract(epoch from updated_at)::text as epoch, updated_by',
        [businessId],
      );
      expect(upd.rows).toHaveLength(1);
      expect(Number(upd.rows[0]?.epoch)).toBeGreaterThan(beforeEpoch);
      expect(upd.rows[0]?.updated_by).toBe('user_danlo');
    }));

  it('every state-bearing table has an app.log_event after-row trigger', () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ table_name: string }>(LOG_EVENT_TRIGGERS);
      // Exact set equality in both directions: a missing trigger and a surprise extra one
      // are both failures, and the second is how source_records would quietly acquire the
      // write amplification the boundary exists to prevent.
      expect(rows.map((r) => r.table_name).sort()).toEqual([...EVENT_LOGGED].sort());
    }));
});
