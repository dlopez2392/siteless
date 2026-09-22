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
 *
 * Phase 2 plan 03 adds `searches` and `search_versions` — a preset renamed or archived, and
 * a version created, are exactly the changes somebody later needs attributed — and adds two
 * more DELIBERATE exclusions, recorded here for the same reason as source_records:
 *
 *   * The six reference tables (industry_clusters, industry_terms, counties, cities,
 *     geo_presets, outlet_counts). app.log_event resolves app.current_org_id(), which is
 *     NULL for the seed loader running as the OWNER with no Clerk claim, while events.org_id
 *     is NOT NULL — a trigger there would fail the seed with 23502. Their history is the
 *     seed script in version control, not the audit log.
 *   * `runs`. Run-status volume belongs to Phase 4 and Phase 9, and a row trigger per
 *     transition is the same write-amplification shape source_records is excluded for. A
 *     run's spend history is the cost ledger; a run-level event goes through
 *     app.emit_event() when Phase 4 needs one.
 *
 * Plan 02-05 adds `budget_periods`, and excludes `cost_reservations` and `cost_ledger` for
 * the same write-amplification reason (RESEARCH Pitfall 9): one row per paid call each, and
 * the ledger row already IS the spend audit record. Only the CAP change is audited on
 * budget_periods — a reserve and a settle update that row too, and at Phase 4 volumes an
 * unnarrowed trigger would write ~2 events rows per paid call.
 */
const EVENT_LOGGED = new Set([
  'orgs',
  'businesses',
  'searches',
  'search_versions',
  'budget_periods',
]);

/**
 * 🔴 budget_periods carries TWO app.log_event triggers, not one, so the trigger ROW count
 * and the table NAME set are no longer the same number.
 *
 * PostgreSQL forbids a WHEN clause referencing both OLD and NEW on a combined
 * insert/update/delete trigger — OLD is unavailable to an INSERT, NEW to a DELETE — so
 * narrowing the UPDATE arm to a cap change (drizzle/0015) requires splitting it into
 * `budget_periods_event_ins_del` and `budget_periods_event_upd`.
 *
 * This count is asserted SEPARATELY from the name set below and is what keeps the
 * tolerance bounded. Comparing distinct names alone would silently accept a second,
 * UNNARROWED update trigger on budget_periods — which is the exact defect the split
 * exists to avoid, and it would restore the write amplification while leaving the name
 * set identical. 5 tables, 6 triggers.
 */
const LOG_EVENT_TRIGGER_ROWS = 6;

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
  select c.relname   as table_name,
         t.tgenabled::text as enabled
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
      const { rows } = await c.query<{ table_name: string; enabled: string }>(LOG_EVENT_TRIGGERS);
      // One row per TRIGGER, so this is checked before the name set: budget_periods holds
      // two, and a third anywhere is a surprise the distinct-name comparison below cannot
      // see.
      expect(rows).toHaveLength(LOG_EVENT_TRIGGER_ROWS);
      // Exact set equality in both directions: a missing trigger and a surprise extra one
      // are both failures, and the second is how source_records would quietly acquire the
      // write amplification the boundary exists to prevent. Distinct, because the query
      // returns one row per trigger and budget_periods legitimately contributes two.
      expect([...new Set(rows.map((r) => r.table_name))].sort()).toEqual([...EVENT_LOGGED].sort());
      // PRESENT is not FIRING. `alter table businesses disable trigger businesses_event`
      // leaves the pg_trigger row exactly where it was with tgenabled = 'D', so an
      // enumeration that only counts rows reports full coverage while attribution is
      // silently off — executed, and the suite stayed green here while only the behaviour
      // test above went red. 'O' fires on ordinary writes and 'A' fires always; 'D'
      // (disabled) and 'R' (replica only) do not.
      expect(rows.filter((r) => r.enabled !== 'O' && r.enabled !== 'A')).toEqual([]);
    }));
});
