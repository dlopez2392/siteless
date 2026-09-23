/**
 * `/businesses/[id]` — D-18 provenance as `readBusinessDetail` returns it (plan 03-15).
 *
 * Driven through the SHIPPED query module on the runtime driver (`_drizzle-tx.ts`) as a Clerk
 * user under RLS and the column grants.
 *
 * 🔴 THE ABSENCE OF A SOURCE ID IS NOT THE ABSENCE OF A VALUE. The UI renders "Not stored" for
 * a null value and "No durable source" for an uncited one; a view that collapses the two cannot
 * render CONVENTIONS § Retention honestly. So one field below has a value and NO source id.
 *
 * 🔴 THE LEAK TEST ASSERTS ON KEYS, NOT VALUES. `undefined` and "absent" differ, and only
 * "absent" survives `JSON.stringify` into a payload — a view that carried `nameNorm: undefined`
 * would look clean in a value check and leak the moment a refactor filled it.
 *
 * 🔴 A FOREIGN ID AND AN UNKNOWN ID ARE THE SAME `null` — and the foreign business is shown to
 * be readable by its own org in the same test, so the `null` is not vacuous.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { readBusinessDetail, readBusinessList } from '@/server/queries/businesses';
import { readReviewQueue } from '@/server/queries/review-queue';
import { decideCandidate } from '@/server/actions/_merge-decisions';
import { actAs, actAsOwner, seedTwoOrgs } from './_fixtures';
import { asPg, closeDrizzleTx, withTxRollback } from './_drizzle-tx';
import {
  CLAIMS_A,
  CLAIMS_B,
  seedCandidate,
  seedComptrollerSide,
  seedMergePair,
  seedOvertureSide,
} from './_merge-fixtures';

vi.mock('server-only', () => ({}));

afterAll(async () => {
  await closeDrizzleTx();
});

const CANARY = 'INTERNAL-CANARY-03-15';

/** Every spelling of the internal columns a view could carry. */
const INTERNAL_KEYS = [
  'internal_notes',
  'internalNotes',
  'name_norm',
  'nameNorm',
  'street_norm',
  'streetNorm',
  'phone_blockable',
  'phoneBlockable',
  'chain_key',
  'chainKey',
];

/** Every key at every depth, as `Object.keys` reports it — not a value scan. */
function allKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, out);
  } else if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    for (const key of Object.keys(value)) {
      out.add(key);
      allKeys((value as Record<string, unknown>)[key], out);
    }
  }
  return out;
}

describe('business detail provenance', () => {
  it('provenance render', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const { a } = await seedTwoOrgs(c);

      // A Comptroller business located by its Census Exact record (legal_name → Comptroller,
      // location → census_geocoder), and an Overture record for the same place.
      const comptroller = await seedComptrollerSide(c, a, {
        name: 'RIVERSIDE STONE, INC.',
        address: '900 E BUSINESS 83 STE 4',
        zip: '78501',
        city: 'MCALLEN',
        lat: 26.18,
        lng: -98.21,
      });
      const overture = await seedOvertureSide(c, a, {
        name: 'Riverside Stone',
        street: '900 E Business 83',
        zip: '78501',
        city: 'McAllen',
        lat: 26.1802,
        lng: -98.21,
      });
      // display_name cites the Overture record; the phone carries a value NO record cites;
      // closed_at stays unset.
      await c.query(
        `update businesses
            set display_name = 'Riverside Stone', display_name_source_id = $2,
                phone_e164 = '+19566822400', phone_source_id = null,
                closed_at = null, closed_at_source_id = null
          where id = $1`,
        [comptroller.businessId, overture.sourceRecordId],
      );

      await actAs(c, CLAIMS_A);
      const detail = await readBusinessDetail(tx, comptroller.businessId);
      if (!detail) throw new Error('provenance render: the business is not readable as its org');
      const f = detail.fields;

      expect(f.displayName).toEqual({
        value: 'Riverside Stone',
        provenance: 'cited',
        source: 'overture',
        sourceRecordId: overture.sourceRecordId,
      });
      expect(f.legalName).toEqual({
        value: 'RIVERSIDE STONE, INC.',
        provenance: 'cited',
        source: 'tx_comptroller',
        sourceRecordId: comptroller.sourceRecordId,
      });
      expect(f.location.provenance).toBe('cited');
      expect(f.location.source).toBe('census_geocoder');
      expect(f.location.sourceRecordId).toBe(comptroller.censusRecordId);
      expect(f.location.value).toMatchObject({ lat: 26.18, lng: -98.21, matchType: 'census_exact' });

      // closed_at: no value AND no source — "Not stored" / "No durable source".
      expect(f.closedOn).toEqual({
        value: null,
        provenance: 'none',
        source: null,
        sourceRecordId: null,
      });
      // The phone: a value with NO source id. Distinguishable from the row above only because
      // value and source are independent fields.
      expect(f.phone.value).toBe('+19566822400');
      expect(f.phone.sourceRecordId).toBeNull();
      expect(f.phone.provenance).toBe('none');

      // The source records that built it, with their own source tags.
      const recordIds = detail.sourceRecords.map((r) => r.id);
      expect(recordIds).toEqual(
        expect.arrayContaining([comptroller.sourceRecordId, comptroller.censusRecordId]),
      );
      expect(detail.sourceRecords.find((r) => r.id === comptroller.censusRecordId)?.sourceKey).toBe(
        'census_geocoder',
      );
      expect(detail.externalKey).toBe(comptroller.externalKey);
      expect(detail.status).toBe('active');
      expect(detail.merges).toEqual([]);
    }));

  it('provenance never leaks the internal columns', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const { a } = await seedTwoOrgs(c);
      const pair = await seedMergePair(c, a, 'LEAKCHECK');
      // Every internal column populated with something findable: the operator annotation,
      // the match keys the ingest wrote, the blockability flag, and a chain key.
      await c.query(
        `update businesses
            set internal_notes = $2, chain_key = coalesce(name_norm, 'leakcheck'),
                phone_blockable = true
          where id = $1 or id = $3`,
        [pair.comptroller.businessId, `${CANARY} owner is hostile`, pair.overture.businessId],
      );
      const nn = await c.query<{ n: number }>(
        `select count(*)::int as n from businesses
          where (id = $1 or id = $2) and name_norm is not null and street_norm is not null`,
        [pair.comptroller.businessId, pair.overture.businessId],
      );
      expect(nn.rows[0]?.n).toBe(2); // the columns exist and are populated — the test bites

      await actAs(c, CLAIMS_A);
      const detail = await readBusinessDetail(tx, pair.comptroller.businessId);
      const list = await readBusinessList(tx, { query: 'leakcheck' });
      const queue = await readReviewQueue(tx);
      expect(detail).not.toBeNull();
      expect(list.rows.length).toBeGreaterThan(0);
      expect(queue.top).not.toBeNull();

      for (const [what, view] of [
        ['detail', detail],
        ['list', list],
        ['queue', queue],
      ] as const) {
        const keys = allKeys(view);
        for (const internal of INTERNAL_KEYS) {
          expect(keys.has(internal), `${what} carries the key ${internal}`).toBe(false);
        }
        expect(JSON.stringify(view)).not.toContain(CANARY);
      }
      // The top level of the detail, spelled out with Object.keys as the plan asks.
      for (const internal of INTERNAL_KEYS) {
        expect(Object.keys(detail ?? {})).not.toContain(internal);
        expect(Object.keys(detail?.fields ?? {})).not.toContain(internal);
      }
      // The chain flag renders a COUNT, never the key; no statewide run exists here, so the
      // count is local and must not claim "in Texas".
      expect(detail?.chain?.statewide).toBe(false);
      expect(detail?.chain?.members).toBeGreaterThanOrEqual(1);
      expect(Object.keys(detail?.chain ?? {}).sort()).toEqual(['members', 'statewide']);
    }));

  it('a foreign business id answers the same as an unknown one', () =>
    withTxRollback(async (tx) => {
      const c = asPg(tx);
      const { a, b } = await seedTwoOrgs(c);
      const mine = await seedComptrollerSide(c, a, {
        name: 'ALPHA ONLY LLC',
        address: '1 N MAIN ST',
        zip: '78501',
        city: 'MCALLEN',
        lat: 26.2,
        lng: -98.2,
      });
      const theirs = await seedComptrollerSide(c, b, {
        name: 'BRAVO ONLY LLC',
        address: '2 N MAIN ST',
        zip: '78501',
        city: 'MCALLEN',
        lat: 26.2,
        lng: -98.2,
      });
      // A pending pair in org B too, so the queue read below has something foreign to hide.
      const theirsToo = await seedOvertureSide(c, b, {
        name: 'Bravo Only',
        street: '2 N Main St',
        zip: '78501',
        city: 'McAllen',
        lat: 26.2,
        lng: -98.2,
      });
      await seedCandidate(c, b, theirs.businessId, theirsToo.businessId, 90);

      await actAs(c, CLAIMS_A);
      expect(await readBusinessDetail(tx, mine.businessId)).not.toBeNull();
      expect(await readBusinessDetail(tx, theirs.businessId)).toBeNull();
      expect(await readBusinessDetail(tx, randomUUID())).toBeNull();
      expect(await readBusinessDetail(tx, 'SL-7F3K2A')).toBeNull(); // a lead key is not an id
      expect((await readReviewQueue(tx)).top).toBeNull();

      // The null above is RLS, not a broken read: org B sees its own business.
      await actAsOwner(c);
      await actAs(c, CLAIMS_B);
      expect((await readBusinessDetail(tx, theirs.businessId))?.id).toBe(theirs.businessId);
    }));

  it('merge history names each side by lead key and primary source', () =>
    withTxRollback(async (tx) => {
      // 03-22: after survivorship the two display names are often equal, so the merge row names
      // each side by its lead key AND its source. Both must come from the query, per side.
      const c = asPg(tx);
      const { a } = await seedTwoOrgs(c);
      const pair = await seedMergePair(c, a); // the Comptroller side is older, so it wins
      await actAs(c, CLAIMS_A);
      const outcome = await decideCandidate(tx, { candidateId: pair.candidateId, decision: 'merged' });
      expect(outcome.kind).toBe('recorded');

      const detail = await readBusinessDetail(tx, pair.comptroller.businessId);
      expect(detail?.merges).toHaveLength(1);
      const m = detail!.merges[0]!;
      expect(m.winnerId).toBe(pair.comptroller.businessId);
      expect(m.loserId).toBe(pair.overture.businessId);
      expect({ winnerSource: m.winnerSource, loserSource: m.loserSource }).toEqual({
        winnerSource: 'tx_comptroller',
        loserSource: 'overture',
      });
      expect(m.winnerKey).toMatch(/^SL-/);
      expect(m.loserKey).toMatch(/^SL-/);
      expect(m.loserKey).not.toBe(m.winnerKey);
    }));
});
