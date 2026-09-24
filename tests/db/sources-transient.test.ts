/**
 * `/sources` — the page's ONE read: the ledger and the Google Places transient figures
 * (04-17, D-12; 04-UI-SPEC § Screen 4, Rules 27 and 37).
 *
 * Driven through the SHIPPED `listSourcesPage` on the runtime driver (`_drizzle-tx.ts`), as a
 * Clerk user under RLS and the grants — `authenticated` holds NO privilege on
 * `place_coordinates` (0027), so the figures can only have come from
 * `app.places_transient_stats()`.
 *
 * 🔴 ONE TRANSACTION. The pool is `max: 1`; a second `withOrg` inside the first HANGS rather
 * than failing. `@/db/with-org` is replaced here by a stand-in that does exactly what the real
 * one does (the claims via `set_config(..., true)`, then `set local role authenticated`) inside
 * a SAVEPOINT of the test's rolled-back transaction — and COUNTS its calls, so "one withOrg per
 * page" is an assertion, not a comment.
 *
 * 🔴 THE MOCK IS `vi.doMock` + `vi.resetModules()` + DYNAMIC IMPORT, UNDONE IN `afterAll`. The
 * DB suite runs `isolate: false`; a hoisted `vi.mock` could reach another file's real import
 * (tests/db/review-actions.test.ts, same pattern).
 *
 * 🔴 NO `Date` IS BOUND. postgres.js through drizzle refuses one (src/db/drizzle-executor.ts),
 * so every instant below is built in SQL from `now()` and read back as epoch-ms text.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OrgClaims } from '@/db/with-org';
import type { Tx } from '@/server/queries/budget';
import { seedTwoOrgs } from './_fixtures';
import { asPg, closeDrizzleTx, withTxRollback } from './_drizzle-tx';
import { seedOvertureSide } from './_merge-fixtures';
import { seedPlacesRun } from './_places-fixtures';

vi.mock('server-only', () => ({}));

const USER_A: OrgClaims = { o: { id: 'org_A' }, sub: 'user_sources_A', role: 'authenticated' };
const USER_B: OrgClaims = { o: { id: 'org_B' }, sub: 'user_sources_B', role: 'authenticated' };

const request: { tx: Tx | null; withOrgCalls: number } = { tx: null, withOrgCalls: 0 };

let listSourcesPage: typeof import('@/server/queries/sources').listSourcesPage;

const MOCKED = ['@/db/with-org'] as const;

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('@/db/with-org', () => ({
    withOrg: async <T>(claims: OrgClaims, fn: (tx: Tx) => Promise<T>): Promise<T> => {
      request.withOrgCalls += 1;
      const outer = request.tx;
      if (!outer) throw new Error('sources-transient: no request transaction is open');
      return outer.transaction(async (sp) => {
        const tx = sp as unknown as Tx;
        await tx.execute(
          sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`,
        );
        await tx.execute(sql`set local role authenticated`);
        return fn(tx);
      });
    },
  }));
  ({ listSourcesPage } = await import('@/server/queries/sources'));
});

afterAll(async () => {
  for (const id of MOCKED) vi.doUnmock(id);
  vi.resetModules();
  request.tx = null;
  await closeDrizzleTx();
});

/**
 * One attachment + observation for `placeId`, observed `ageDays` ago, with its coordinate row
 * expiring 30 days after it was observed (the longest `pc_expiry_within_30_days` allows). As the
 * OWNER: `place_coordinates` grants `authenticated` nothing.
 */
async function seedHeldPlace(
  tx: Tx,
  orgId: string,
  businessId: string,
  runId: string,
  placeId: string,
  ageDays: number,
): Promise<void> {
  const c = asPg(tx);
  const a = await c.query<{ id: string }>(
    `insert into place_attachments (org_id, business_id, place_id, status, reason, score, features,
                                    first_seen_run_id, last_seen_run_id)
     values ($1, $2, $3, 'attached', 'score', 95, '{"name":30}'::jsonb, $4, $4)
     returning id`,
    [orgId, businessId, placeId, runId],
  );
  const o = await c.query<{ id: string }>(
    `insert into place_observations (org_id, business_id, place_id, run_id, attachment_id,
                                     had_website_uri, host_class, sku, pure_sab, observed_at)
     values ($1, $2, $3, $4, $5, false, 'none', 'ts_enterprise', false,
             now() - make_interval(days => $6::int))
     returning id`,
    [orgId, businessId, placeId, runId, a.rows[0]!.id, ageDays],
  );
  await c.query(
    `insert into place_coordinates (org_id, observation_id, lat, lng, observed_at, expires_at)
     select org_id, id, 26.2159, -98.2336, observed_at, observed_at + interval '30 days'
       from place_observations where id = $1`,
    [o.rows[0]!.id],
  );
}

describe('sources page read', () => {
  it("transient stats are read in the sources page's one transaction", () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const { a } = await seedTwoOrgs(c);
      const side = await seedOvertureSide(c, a, {
        name: 'Transient Plumbing',
        street: '1200 N 10th St',
        zip: '78501',
        city: 'McAllen',
        lat: 26.2159,
        lng: -98.2336,
        phone: '+19566319901',
        basicCategory: 'home_service',
      });
      const run = await seedPlacesRun(c, a);
      // Held: observed 12 days ago. Expired, not yet purged: observed 31 days ago.
      await seedHeldPlace(tx, a, side.businessId, run.runId, 'synthetic-transient-held', 12);
      await seedHeldPlace(tx, a, side.businessId, run.runId, 'synthetic-transient-expired', 31);
      await c.query(
        `insert into place_purge_runs (org_id, ran_at, rows_purged, trigger)
         values ($1, now() - interval '3 days', 9, 'cron'), ($1, now() - interval '1 day', 5, 'desk')`,
        [a],
      );
      const expected = await c.query<{ oldest: string; last: string }>(
        `select (select floor(extract(epoch from observed_at) * 1000)::bigint::text
                   from place_coordinates where org_id = $1 and expires_at > now()) as oldest,
                (select floor(extract(epoch from max(ran_at)) * 1000)::bigint::text
                   from place_purge_runs where org_id = $1) as last`,
        [a],
      );

      request.tx = tx;
      request.withOrgCalls = 0;
      const pageA = await listSourcesPage(USER_A);
      expect(request.withOrgCalls).toBe(1);

      // The ledger is unchanged: exactly four rows, in ledger order (Rule 27 / Rule 37 — the
      // transient source is NOT a fifth row).
      expect(pageA.rows.map((r) => r.sourceKey)).toEqual([
        'tx_comptroller',
        'tx_comptroller_closures',
        'overture',
        'census_geocoder',
      ]);
      expect(pageA.transient).toEqual({
        placeIdsHeld: 2,
        coordinatesHeld: 1,
        oldestCoordinateMs: Number(expected.rows[0]!.oldest),
        expiredAwaitingPurge: 1,
        lastPurgeMs: Number(expected.rows[0]!.last),
        lastRowsPurged: 5,
      });

      // Org B holds nothing and has never been purged: zeros and nulls, never org A's figures.
      request.withOrgCalls = 0;
      const pageB = await listSourcesPage(USER_B);
      expect(request.withOrgCalls).toBe(1);
      expect(pageB.rows).toHaveLength(4);
      expect(pageB.transient).toEqual({
        placeIdsHeld: 0,
        coordinatesHeld: 0,
        oldestCoordinateMs: null,
        expiredAwaitingPurge: 0,
        lastPurgeMs: null,
        lastRowsPurged: null,
      });
      request.tx = null;
    }));

  it('a failed transient read leaves the ledger standing', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      await seedTwoOrgs(c);
      // The definer refuses this session (42501) — revoked as the owner, inside the rolled-back
      // transaction, so nothing outlives the test. Without the savepoint the refusal would
      // abort the whole transaction and the ledger read would go with it.
      await c.query('revoke execute on function app.places_transient_stats() from authenticated');
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      request.tx = tx;
      request.withOrgCalls = 0;
      try {
        const page = await listSourcesPage(USER_A);
        expect(request.withOrgCalls).toBe(1);
        expect(page.transient).toBeNull();
        expect(page.rows.map((r) => r.sourceKey)).toEqual([
          'tx_comptroller',
          'tx_comptroller_closures',
          'overture',
          'census_geocoder',
        ]);
        // Logged by error NAME only.
        expect(errors).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(errors.mock.calls[0])).not.toMatch(/permission denied/);
      } finally {
        errors.mockRestore();
        request.tx = null;
      }
    }));
});
