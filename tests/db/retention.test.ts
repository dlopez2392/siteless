/**
 * Criterion 3: "An attempt to persist Google Places content into a durable field is
 * refused by a database constraint, not by a code review."
 *
 * The codes here are NOT the RLS/grant one every other DB test in this repo pins. A CHECK
 * violation is 23514 and a foreign-key violation is 23503; the insufficient-privilege code
 * appears nowhere in this file, and an acceptance grep enforces that — which is why this
 * comment does not spell it either (01-06: a comment naming the thing it forbids trips the
 * guard it describes). Pin the constraint NAME as well as the code — the name is the thing
 * a future migration can rename out from under the test.
 *
 * Mutation: drop constraint sr_google_is_ephemeral from source_records —
 * 'google content cannot be durable' goes red, and only that one.
 * Second mutation: drop constraint businesses_phone_src_fk from businesses —
 * 'durable cites durable: a durable field citing an ephemeral source is refused' goes red,
 * and only that one. The positive control stays green under both, which is what tells a
 * working guard apart from one that simply refuses everything (01-05's M1 lesson).
 *
 * Phase 3 plan 05 adds three more provenance pairs, each with its own refusal and its own
 * positive control, each in its own transaction and each resting on a different constraint:
 *   M18: drop constraint businesses_location_src_fk — 'location cites durable: …refused'
 *        goes red, and only that one. THIS is Phase 4's legal boundary (T-3-06): a Places
 *        sweep's ephemeral lat/lng can never become the durable businesses.lat/lng.
 *   drop constraint businesses_address_src_fk   — 'address cites durable: …refused' only.
 *   drop constraint businesses_closed_at_src_fk — 'closed_at cites durable: …refused' only.
 * And the widened source-key CHECK: reverting sr_source_key_known to the Phase 1 list reds
 * 'source key known: the four Phase 3 keys are accepted' AND the location and closed_at
 * positive controls (measured) — they cite census_geocoder and tx_comptroller_closures
 * sources on purpose, the keys that really feed those fields, so they depend on the widened
 * CHECK too. Dropping the CHECK reds 'source key known: an unknown key is refused' only.
 *
 * One refused statement per withRollback: a refusal aborts the transaction and the next
 * statement reports 25P02 instead of its own reason.
 */
import { describe, expect, it } from 'vitest';
import { seedTwoOrgs, SQL_FRESH_EXTERNAL_KEY, withRollback } from './_fixtures';

const INSERT_SOURCE_NO_TTL =
  'insert into source_records (org_id, source_key, retention_class, expires_at) ' +
  'values ($1,$2,$3,null) returning id';

// 21 days, not 30 (ARCHITECTURE.md): a missed purge run is then not a breach.
const INSERT_SOURCE_TTL =
  'insert into source_records (org_id, source_key, retention_class, expires_at) ' +
  "values ($1,$2,$3, now() + interval '21 days') returning id";

const INSERT_BUSINESS_CITING = `insert into businesses (org_id, display_name, phone_source_id, external_key) values ($1,$2,$3,${SQL_FRESH_EXTERNAL_KEY})`;

/** One business insert citing a source record from the given provenance column. */
const insertBusinessCiting = (column: string) =>
  `insert into businesses (org_id, display_name, ${column}, external_key) values ($1,$2,$3,${SQL_FRESH_EXTERNAL_KEY})`;

/**
 * Phase 3 plan 05's three new provenance pairs (drizzle/0023). The durable source key for
 * each positive control is the one that will really feed it in this phase.
 */
const NEW_PAIRS = [
  {
    field: 'address',
    column: 'address_source_id',
    constraint: 'businesses_address_src_fk',
    durableSourceKey: 'tx_comptroller',
  },
  {
    field: 'location',
    column: 'location_source_id',
    constraint: 'businesses_location_src_fk',
    durableSourceKey: 'census_geocoder',
  },
  {
    field: 'closed_at',
    column: 'closed_at_source_id',
    constraint: 'businesses_closed_at_src_fk',
    durableSourceKey: 'tx_comptroller_closures',
  },
] as const;

describe('Places retention is a database constraint', () => {
  it('google content cannot be durable', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      // The whole legal story in one statement: place_id is the only field exempt from
      // the caching restriction, so a Google payload may never become the durable record.
      const attempt = c.query(INSERT_SOURCE_NO_TTL, [a, 'google_places', 'durable']);
      await expect(attempt).rejects.toMatchObject({
        code: '23514',
        constraint: 'sr_google_is_ephemeral',
      });
    }));

  it('an ephemeral source record without expires_at is refused', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      // Ephemeral means a TTL. Without one the purge job has nothing to select on and the
      // row lives forever — which is the breach the retention class exists to prevent.
      const attempt = c.query(INSERT_SOURCE_NO_TTL, [a, 'overture', 'ephemeral']);
      await expect(attempt).rejects.toMatchObject({
        code: '23514',
        constraint: 'sr_ephemeral_has_expiry',
      });
    }));

  it('a durable source record with an expires_at is refused', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      // The CHECK is an equivalence, so it bites in both directions: a durable record
      // carrying a TTL would be silently purged out from under the fields citing it.
      const attempt = c.query(INSERT_SOURCE_TTL, [a, 'overture', 'durable']);
      await expect(attempt).rejects.toMatchObject({
        code: '23514',
        constraint: 'sr_ephemeral_has_expiry',
      });
    }));

  it('durable cites durable: a durable field citing an ephemeral source is refused', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const src = await c.query<{ id: string }>(INSERT_SOURCE_TTL, [
        a,
        'google_places',
        'ephemeral',
      ]);
      const sourceId = src.rows[0]?.id;
      expect(sourceId).toBeTruthy();
      // If the only thing that knows this roofer's phone number is a Google payload, the
      // column cannot be set at all: phone_src_ret is GENERATED ALWAYS AS ('durable'), so
      // the composite FK has nothing to point at and the column stays NULL.
      const attempt = c.query(INSERT_BUSINESS_CITING, [a, 'Alpha Roofing', sourceId]);
      await expect(attempt).rejects.toMatchObject({
        code: '23503',
        constraint: 'businesses_phone_src_fk',
      });
    }));

  it('positive control: a durable field citing a durable source is accepted', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const src = await c.query<{ id: string }>(INSERT_SOURCE_NO_TTL, [a, 'overture', 'durable']);
      const sourceId = src.rows[0]?.id;
      expect(sourceId).toBeTruthy();
      // A refusal test with no positive control passes when everything is broken.
      const ok = await c.query(INSERT_BUSINESS_CITING, [a, 'Alpha Roofing', sourceId]);
      expect(ok.rowCount).toBe(1);
    }));

  // ---- Phase 3 plan 05: three more provenance pairs, and the widened source-key CHECK ----
  //
  // Each positive control is declared FIRST and runs in its own transaction, so a dropped FK
  // reds its refusal test specifically while the control stays green — and a constraint
  // that refused everything would red the control instead.

  for (const pair of NEW_PAIRS) {
    it(`positive control: ${pair.field} cites durable source and is accepted`, () =>
      withRollback(async (c) => {
        const { a } = await seedTwoOrgs(c);
        const src = await c.query<{ id: string }>(INSERT_SOURCE_NO_TTL, [
          a,
          pair.durableSourceKey,
          'durable',
        ]);
        const sourceId = src.rows[0]?.id;
        expect(sourceId).toBeTruthy();
        const ok = await c.query(insertBusinessCiting(pair.column), [a, 'Alpha Roofing', sourceId]);
        expect(ok.rowCount).toBe(1);
      }));

    it(`${pair.field} cites durable: an ephemeral google_places source is refused`, () =>
      withRollback(async (c) => {
        const { a } = await seedTwoOrgs(c);
        const src = await c.query<{ id: string }>(INSERT_SOURCE_TTL, [
          a,
          'google_places',
          'ephemeral',
        ]);
        const sourceId = src.rows[0]?.id;
        expect(sourceId).toBeTruthy();
        // ONE refused statement in this transaction. SQLSTATE and constraint NAME both:
        // before this plan's fixture fix the same insert failed 23502 on external_key, and
        // a bare toThrow() would have passed on it.
        const attempt = c.query(insertBusinessCiting(pair.column), [a, 'Alpha Roofing', sourceId]);
        await expect(attempt).rejects.toMatchObject({
          code: '23503',
          constraint: pair.constraint,
        });
      }));
  }

  it('source key known: the four Phase 3 keys are accepted', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      // All four /sources rows are durable: public-domain Comptroller data and a free
      // federal geocoder, neither under a caching restriction.
      for (const key of ['tx_comptroller', 'tx_comptroller_closures', 'overture', 'census_geocoder']) {
        const ok = await c.query(INSERT_SOURCE_NO_TTL, [a, key, 'durable']);
        expect(ok.rowCount, key).toBe(1);
      }
    }));

  it('source key known: an unknown key is refused', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      // A plausible-looking typo of a real key, not garbage: that is the mistake the CHECK
      // exists to catch before a source tag renders as something /sources has no row for.
      const attempt = c.query(INSERT_SOURCE_NO_TTL, [a, 'tx_comptroller_closure', 'durable']);
      await expect(attempt).rejects.toMatchObject({
        code: '23514',
        constraint: 'sr_source_key_known',
      });
    }));

  it('source_records has a partial index on expires_at', () =>
    withRollback(async (c) => {
      // Phase 4's purge job deletes where expires_at < now(). Without this index that is a
      // sequential scan of every payload the pipeline ever fetched.
      const { rows } = await c.query<{ indexdef: string }>(
        "select indexdef from pg_indexes where schemaname = 'public' and tablename = 'source_records' and indexname = 'sr_expiry'",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.indexdef).toMatch(/where \(expires_at IS NOT NULL\)/i);
    }));
});
