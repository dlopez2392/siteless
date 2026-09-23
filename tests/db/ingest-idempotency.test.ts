/**
 * DATA-04 against the live local database: a re-run is idempotent by external id, a changed
 * `payload_hash` updates the payload AND the derived columns, a row absent from a run is
 * counted `gone` and never deleted, and each run emits exactly one run-level event.
 *
 * 🔴 EVERY TEST HERE CONNECTS THE WAY THE DESK SCRIPTS DO: the owner connection, NO `actAs`,
 * NO `set role`, NO Clerk claims — `setEtlActor` + `resolveEtlOrg` in the transaction, and
 * nothing else. Every other DB suite reaches the database through `actAs(c, ORG_A_CLAIMS)`,
 * which sets `request.jwt.claims` itself; that fixture is MORE PERMISSIVE than the connection
 * the ingest actually has, and would have masked the one defect this plan exists to close
 * (`app.emit_event` → `42501 emit_event: no current org` on the first desk run). So there is
 * no `actAs` anywhere in this file, by design.
 *
 * Mutations, executed 2026-09-22 (03-09-SUMMARY.md has the output):
 *   M20 literal (payload_hash added to the conflict target) — PostgreSQL refuses the statement
 *         outright (42P10: no unique index matches), so all five DATA-04 tests go red,
 *         'payload hash diff' included. 03-VALIDATION's "payload hash diff stays green" is not
 *         reachable for that form.
 *   M20 as a behaviour (delete the businesses-write gate in upsertBusinessFromSource) — reds
 *         're-run is idempotent' and 'payload hash diff' on the businesses events count.
 *   The ETL org-context mutation (resolveEtlOrg returns before installing the claim) — every
 *         test that reaches finishRun, and 'emit_event succeeds from an owner connection with
 *         no claims', goes red with 42501 'emit_event: no current org'. That this whole file
 *         reds is the point: every test here has the desk-script connection shape.
 */
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { resolveEtlOrg, setEtlActor } from '@/lib/ingest/etl-actor';
import { localDate } from '@/lib/time';
import { seedTwoOrgs, withRollback } from './_fixtures';
import {
  asEtlExecutor,
  COMPTROLLER_FIXTURE,
  comptrollerIngestInput,
  runFixtureIngest,
  seedIngestRun,
  type IngestInput,
} from './_ingest-fixtures';

const INPUTS: IngestInput[] = COMPTROLLER_FIXTURE.map((r) => comptrollerIngestInput(r));
const N = INPUTS.length;

/** The desk-script transaction preamble: the actor GUC, then the org claim. Nothing else. */
async function asDeskScript(c: Client): Promise<{ a: string; b: string }> {
  const orgs = await seedTwoOrgs(c); // owner connection; NO actAs, NO set role
  const x = asEtlExecutor(c);
  await setEtlActor(x, 'ingest-comptroller');
  const orgId = await resolveEtlOrg(x, 'org_A');
  expect(orgId).toBe(orgs.a);
  return orgs;
}

const businessEvents = async (c: Client, orgId: string): Promise<number> =>
  Number(
    (
      await c.query<{ n: string }>(
        "select count(*) as n from events where entity_type='businesses' and org_id = $1",
        [orgId],
      )
    ).rows[0]?.n,
  );

/**
 * Every business in the org with its physical tuple id. `updated_at` alone cannot prove "not
 * written" inside one transaction — `app.touch_updated_at` stamps `now()`, which is the
 * TRANSACTION start, so an UPDATE here would leave it unchanged. `ctid` moves on every UPDATE
 * (a new tuple version, HOT or not), so it is the discriminating half of the snapshot.
 */
const businessSnapshot = async (c: Client, orgId: string) =>
  (
    await c.query<{ id: string; ctid: string; updated_at: string; display_name: string }>(
      `select id, ctid::text as ctid, updated_at::text as updated_at, display_name
         from businesses where org_id = $1 order by id`,
      [orgId],
    )
  ).rows;

describe('DATA-04: the ingest write path', () => {
  it('re-run is idempotent', () =>
    withRollback(async (c) => {
      const { a } = await asDeskScript(c);
      const eventsBefore = await businessEvents(c, a);

      const first = await runFixtureIngest(c, a, 'tx_comptroller', INPUTS);
      expect(first.report).toEqual({ added: N, changed: 0, unchanged: 0, gone: 0, totalSeen: N });
      // Positive control: the first run DOES write one businesses event per row. Without this
      // line, "the count did not move" would also pass with the trigger disabled.
      const eventsAfterFirst = await businessEvents(c, a);
      expect(eventsAfterFirst - eventsBefore).toBe(N);
      const snapshot = await businessSnapshot(c, a);
      expect(snapshot).toHaveLength(N);

      const second = await runFixtureIngest(c, a, 'tx_comptroller', INPUTS);
      expect(second.startedAt.getTime()).toBeGreaterThan(first.startedAt.getTime());

      // 🔴 The idempotency proof, the event-volume guard and M20's target, all at once.
      expect(second.report).toEqual({ added: 0, changed: 0, unchanged: N, gone: 0, totalSeen: N });
      expect(await businessEvents(c, a)).toBe(eventsAfterFirst); // entity_type='businesses'
      expect(await businessSnapshot(c, a)).toEqual(snapshot); // no row written: ctid + updated_at
      const sr = await c.query<{ n: string; seen: string }>(
        `select count(*) as n, count(*) filter (where last_seen_at = $2::timestamptz) as seen
           from source_records where org_id = $1 and source_key = 'tx_comptroller'`,
        [a, second.startedAt.toISOString()],
      );
      expect(sr.rows[0]).toEqual({ n: String(N), seen: String(N) }); // every row re-seen, none added
    }));

  it('payload hash diff', () =>
    withRollback(async (c) => {
      const { a } = await asDeskScript(c);
      await runFixtureIngest(c, a, 'tx_comptroller', INPUTS);
      const before = await businessSnapshot(c, a);
      const eventsBefore = await businessEvents(c, a);

      // One field of one row changes upstream: the DBA was corrected.
      const target = COMPTROLLER_FIXTURE[3]!;
      const edited = COMPTROLLER_FIXTURE.map((r) =>
        r === target ? { ...r, outlet_name: 'LA ESTRELLA BAKERY & CAFE' } : r,
      ).map((r) => comptrollerIngestInput(r));
      const externalId = `${target.taxpayer_number}-${target.outlet_number}`;

      const second = await runFixtureIngest(c, a, 'tx_comptroller', edited);
      expect(second.report).toEqual({ added: 0, changed: 1, unchanged: N - 1, gone: 0, totalSeen: N });

      // The changed row: payload AND derived columns both moved.
      const changed = await c.query<{
        payload_name: string;
        display_name: string;
        legal_name: string;
        name_norm: string;
      }>(
        `select sr.payload->>'outlet_name' as payload_name, b.display_name, b.legal_name, b.name_norm
           from source_records sr join businesses b on b.id = sr.business_id
          where sr.org_id = $1 and sr.source_key = 'tx_comptroller' and sr.external_id = $2`,
        [a, externalId],
      );
      expect(changed.rows[0]).toEqual({
        payload_name: 'LA ESTRELLA BAKERY & CAFE',
        display_name: 'LA ESTRELLA BAKERY & CAFE',
        legal_name: 'LA ESTRELLA BAKERY & CAFE',
        name_norm: edited[3]!.derived.nameNorm,
      });
      expect(await businessEvents(c, a)).toBe(eventsBefore + 1); // exactly the one update

      // Every OTHER business is untouched; every source record's last_seen_at advanced.
      const after = await businessSnapshot(c, a);
      const changedId = after.find((r) => r.display_name === 'LA ESTRELLA BAKERY & CAFE')!.id;
      expect(after.filter((r) => r.id !== changedId)).toEqual(
        before.filter((r) => r.id !== changedId),
      );
      expect(after.find((r) => r.id === changedId)!.ctid).not.toBe(
        before.find((r) => r.id === changedId)!.ctid,
      );
      const seen = await c.query<{ n: string }>(
        `select count(*) as n from source_records
          where org_id = $1 and source_key = 'tx_comptroller' and last_seen_at = $2::timestamptz`,
        [a, second.startedAt.toISOString()],
      );
      expect(seen.rows[0]?.n).toBe(String(N));
    }));

  it('gone is not a delete', () =>
    withRollback(async (c) => {
      const { a } = await asDeskScript(c);
      const first = await runFixtureIngest(c, a, 'tx_comptroller', INPUTS);
      const missing = INPUTS[7]!;
      const second = await runFixtureIngest(
        c,
        a,
        'tx_comptroller',
        INPUTS.filter((i) => i !== missing),
      );

      expect(second.report).toEqual({ added: 0, changed: 0, unchanged: N - 1, gone: 1, totalSeen: N - 1 });
      const sr = await c.query<{ n: string }>(
        "select count(*) as n from source_records where org_id = $1 and source_key = 'tx_comptroller'",
        [a],
      );
      expect(sr.rows[0]?.n).toBe(String(N)); // nothing deleted

      // The vanished row: still there, still active, last seen in the FIRST run.
      const gone = await c.query<{ status: string; last_seen: string; first: string }>(
        `select b.status,
                (extract(epoch from sr.last_seen_at) * 1000)::bigint::text as last_seen,
                $3::text as first
           from source_records sr join businesses b on b.id = sr.business_id
          where sr.org_id = $1 and sr.external_id = $2`,
        [a, missing.externalId, String(first.startedAt.getTime())],
      );
      expect(gone.rows).toHaveLength(1);
      expect(gone.rows[0]!.status).toBe('active');
      expect(gone.rows[0]!.last_seen).toBe(gone.rows[0]!.first);
    }));

  it('one run-level event', () =>
    withRollback(async (c) => {
      const { a } = await asDeskScript(c);
      const first = await runFixtureIngest(c, a, 'tx_comptroller', INPUTS);
      const second = await runFixtureIngest(c, a, 'tx_comptroller', INPUTS);

      for (const run of [first, second]) {
        const ev = await c.query<{
          id: string;
          org_id: string;
          actor_id: string;
          action: string;
          unchanged: number;
        }>(
          `select id::text as id, org_id, actor_id, action, (after->>'unchanged')::int as unchanged
             from events where entity_type = 'ingest_runs' and entity_id = $1`,
          [run.runId],
        );
        expect(ev.rows).toHaveLength(1); // exactly one per run
        expect(ev.rows[0]).toEqual({
          id: run.eventId,
          org_id: a,
          // The GUC fallback resolved: the ETL claim carries no Clerk sub.
          actor_id: 'etl:ingest-comptroller',
          action: 'complete',
          unchanged: run.report.unchanged,
        });
      }

      // The run row itself carries the report (D-06: persisted, not printed).
      const row = await c.query(
        `select status, added, changed, unchanged, gone, total_seen, finished_at is not null as finished
           from ingest_runs where id = $1`,
        [second.runId],
      );
      expect(row.rows[0]).toEqual({
        status: 'complete',
        added: 0,
        changed: 0,
        unchanged: N,
        gone: 0,
        total_seen: N,
        finished: true,
      });
      // T-3-02: the row-level businesses events are attributed to the ETL too, never 'system'.
      const actors = await c.query<{ actor_id: string }>(
        "select distinct actor_id from events where entity_type = 'businesses' and org_id = $1",
        [a],
      );
      expect(actors.rows).toEqual([{ actor_id: 'etl:ingest-comptroller' }]);
    }));

  it('two zones', () =>
    withRollback(async (c) => {
      const { a } = await asDeskScript(c);
      const run = await runFixtureIngest(c, a, 'tx_comptroller', INPUTS.slice(0, 2));

      const typ = await c.query<{ t: string; ms: string }>(
        `select pg_typeof(started_at)::text as t,
                (extract(epoch from started_at) * 1000)::bigint::text as ms
           from ingest_runs where id = $1`,
        [run.runId],
      );
      expect(typ.rows[0]!.t).toBe('timestamp with time zone');
      // The instant startRun handed back IS the stored value (millisecond-truncated on write).
      expect(typ.rows[0]!.ms).toBe(String(run.startedAt.getTime()));

      // 🔴 One instant, two zones, opposite verdicts. 03:30Z on the 22nd is 22:30 CDT on the
      // 21st — a Chicago-only fixture on a Chicago machine could not tell these apart.
      const straddle = '2026-09-22T03:30:00.000Z';
      await c.query('update ingest_runs set started_at = $2::timestamptz where id = $1', [
        run.runId,
        straddle,
      ]);
      const buckets = await c.query<{ chicago: string; utc: string }>(
        `select (started_at at time zone 'America/Chicago')::date::text as chicago,
                (started_at at time zone 'UTC')::date::text as utc
           from ingest_runs where id = $1`,
        [run.runId],
      );
      expect(buckets.rows[0]).toEqual({ chicago: '2026-09-21', utc: '2026-09-22' });
      // And the app's own bucketing agrees with the database on both halves.
      const instant = new Date(straddle);
      expect(localDate(instant)).toBe('2026-09-21');
      expect(localDate(instant, 'UTC')).toBe('2026-09-22');
    }));
});

describe('the ETL tier has org context without Clerk claims', () => {
  it('emit_event succeeds from an owner connection with no claims', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c); // owner connection; NO actAs, NO set role
      // The desk-script shape, asserted rather than assumed: no claims at all, and the owner.
      const pre = await c.query<{ claims: string | null; is_owner: boolean }>(
        `select nullif(current_setting('request.jwt.claims', true), '') as claims,
                current_user <> 'authenticated' as is_owner`,
      );
      expect(pre.rows[0]).toEqual({ claims: null, is_owner: true });

      await c.query("select set_config('app.actor_id','etl:ingest-comptroller',true)");
      const orgId = await resolveEtlOrg(asEtlExecutor(c), 'org_A'); // installs the org claim
      expect(orgId).toBe(a);

      const runId = await seedIngestRun(c, a);
      const { rows } = await c.query<{ id: string }>(
        "select app.emit_event('ingest_runs', $1::uuid, 'complete', '{}'::jsonb) as id",
        [runId],
      );
      const ev = await c.query<{ org_id: string; actor_id: string }>(
        'select org_id, actor_id from events where id = $1',
        [rows[0]!.id],
      );
      expect(ev.rows[0]!.org_id).toBe(a);
      expect(ev.rows[0]!.actor_id).toBe('etl:ingest-comptroller'); // sub omitted ⇒ GUC wins
    }));

  it('emit_event refuses an owner connection that skipped resolveEtlOrg', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await c.query("select set_config('app.actor_id','etl:ingest-comptroller',true)");
      const runId = await seedIngestRun(c, a);
      // The ONE refused statement of this transaction. The message is pinned, not only the
      // code: 42501 also covers an RLS refusal and a grant refusal, and only the message tells
      // this guard apart from those.
      await expect(
        c.query("select app.emit_event('ingest_runs', $1::uuid, 'complete', '{}'::jsonb)", [runId]),
      ).rejects.toMatchObject({ code: '42501', message: 'emit_event: no current org' });
    }));

  it('resolveEtlOrg installs org context, not admin and not a user', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const x = asEtlExecutor(c);
      await setEtlActor(x, 'ingest-overture');
      await resolveEtlOrg(x, 'org_A');
      const r = await c.query<{
        claims: unknown;
        org: string;
        role: string | null;
        sub: string | null;
        actor: string;
        is_owner: boolean;
      }>(
        `select current_setting('request.jwt.claims', true)::jsonb as claims,
                app.current_org_id() as org,
                app.current_org_role() as role,
                app.jwt()->>'sub' as sub,
                current_setting('app.actor_id', true) as actor,
                current_user <> 'authenticated' as is_owner`,
      );
      // T-3-15: {o:{id}} and NOTHING else — no sub (T-3-02), no o.rol, no role switch (D-01).
      expect(r.rows[0]).toEqual({
        claims: { o: { id: 'org_A' } },
        org: a,
        role: null,
        sub: null,
        actor: 'etl:ingest-overture',
        is_owner: true,
      });
    }));

  it('resolveEtlOrg refuses a missing or unknown org and never picks one', () =>
    withRollback(async (c) => {
      await seedTwoOrgs(c);
      const x = asEtlExecutor(c);
      // T-3-01: two orgs exist, and still neither is chosen for the caller.
      await expect(resolveEtlOrg(x, '')).rejects.toMatchObject({ name: 'EtlOrgRequiredError' });
      await expect(resolveEtlOrg(x, '   ')).rejects.toMatchObject({ name: 'EtlOrgRequiredError' });
      await expect(resolveEtlOrg(x, 'org_nope')).rejects.toMatchObject({
        name: 'EtlOrgNotFoundError',
        message: expect.stringContaining('"org_nope"'),
      });
      // Neither refusal installed a claim.
      const r = await c.query<{ claims: string | null }>(
        "select nullif(current_setting('request.jwt.claims', true), '') as claims",
      );
      expect(r.rows[0]!.claims).toBeNull();
    }));
});
