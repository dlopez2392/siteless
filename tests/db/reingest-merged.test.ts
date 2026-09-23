/**
 * A-CR-02 (review 03): an ordinary re-ingest must not revert D-14 survivorship on a merged
 * business.
 *
 * `upsertBusinessFromSource` resolved "the business" as the one the source record originally
 * CREATED, and wrote that single record's derived columns straight onto it whenever the payload
 * hash moved — never asking whether that business had since won or lost a merge:
 *   - the creator is the WINNER: a changed permit rewrote display_name (and its provenance) back
 *     to the Comptroller outlet_name, and the address back to the Comptroller's, over the
 *     Overture values survivorship chose. D-14 says the Comptroller name is used ONLY when no
 *     Overture parent exists. The Census pass (`WRITE_LOCATION`) did the same to the location.
 *   - the creator is a merged-away LOSER: the update landed on the dead row, and the winner kept
 *     the old phone while still citing the record whose payload now said something else — a
 *     provenance the detail page's source tag asserts falsely (D-18).
 * No concurrency needed: an ordinary monthly re-run. And the next merge's snapshot captured the
 * corrupted state, so an unmerge "restored" it.
 *
 * Now a changed record whose business belongs to a cluster re-derives the cluster ROOT from
 * every member's parents through the same survive() a merge uses, write-gated
 * (app.apply_survivorship_if_changed). An unchanged re-run still writes nothing (DATA-04).
 *
 * Desk-tier connection shape throughout: owner connection, NO actAs, setEtlActor +
 * resolveEtlOrg — the claim the re-derivation reads its org from.
 */
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { resolveEtlOrg, setEtlActor } from '@/lib/ingest/etl-actor';
import { upsertBusinessFromSource, upsertSourceRecord } from '@/lib/ingest/upsert';
import { mergePair } from '@/lib/resolve/merge';
import { rederiveRoot } from '@/lib/resolve/rederive';
import type { BatchOutcome } from '@/lib/geocode/census-batch';
import { etlTransactions, runGeocodePass, type Geocoder } from '../../scripts/ingest-comptroller';
import { seedTwoOrgs, withRollback } from './_fixtures';
import {
  asEtlExecutor,
  comptrollerIngestInput,
  fixtureDerivationContext,
  overtureIngestInput,
  type ComptrollerFixtureRow,
  type OvertureFixtureRow,
} from './_ingest-fixtures';
import { seedMergePair, survivorshipColumns } from './_merge-fixtures';

const FEATURES = { name: 45, address: 30, distance: 15, cluster: 5 };

async function asDeskTier(c: Client, script: 'ingest-comptroller' | 'ingest-overture' | 'resolve') {
  const x = asEtlExecutor(c);
  await setEtlActor(x, script);
  await resolveEtlOrg(x, 'org_A');
}

const businessEvents = async (c: Client, orgId: string): Promise<number> =>
  Number(
    (
      await c.query<{ n: string }>(
        "select count(*) as n from events where entity_type = 'businesses' and org_id = $1",
        [orgId],
      )
    ).rows[0]?.n,
  );

/** The stored payload of a source record, as the re-ingest would re-read it. */
const payloadOf = async (c: Client, sourceRecordId: string) =>
  (
    await c.query<{ payload: Record<string, unknown> }>(
      'select payload from source_records where id = $1',
      [sourceRecordId],
    )
  ).rows[0]!.payload;

/** A merged pair: the Comptroller business wins (older), the Overture business is the loser. */
async function mergedPair(c: Client, orgId: string) {
  const pair = await seedMergePair(c, orgId);
  await asDeskTier(c, 'resolve');
  const r = await mergePair(asEtlExecutor(c), {
    candidateId: pair.candidateId,
    leftId: pair.comptroller.businessId,
    rightId: pair.overture.businessId,
    reason: 'auto',
    score: 95,
    features: FEATURES,
  });
  expect(r.winnerId).toBe(pair.comptroller.businessId);
  return pair;
}

describe('A-CR-02: a re-ingest of a merged business goes through survivorship', () => {
  it('a changed Comptroller payload on a merge winner keeps the Overture display_name', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { comptroller, overture } = await mergedPair(c, a);
      const merged = await survivorshipColumns(c, comptroller.businessId);
      // Positive control: the merge gave the winner Overture's name and address.
      expect(merged.display_name).toBe('Riverside Stone');
      expect(merged.display_name_source_id).toBe(overture.sourceRecordId);
      expect(merged.address_source_id).toBe(overture.sourceRecordId);

      // The monthly re-run: the permit's DBA string moved.
      await asDeskTier(c, 'ingest-comptroller');
      const row = {
        ...(await payloadOf(c, comptroller.sourceRecordId)),
        outlet_name: 'RIVERSIDE STONE & TILE, INC.',
      } as unknown as ComptrollerFixtureRow;
      const input = comptrollerIngestInput(row, await fixtureDerivationContext(c));
      const x = asEtlExecutor(c);
      const sr = await upsertSourceRecord(x, {
        orgId: a,
        sourceKey: 'tx_comptroller',
        externalId: input.externalId,
        payload: input.payload,
        sourceVersion: '2026-10-20T00:00:00.000Z',
        seenAt: new Date(),
      });
      expect(sr).toMatchObject({ id: comptroller.sourceRecordId, changed: true });
      await upsertBusinessFromSource(x, sr.id, input.derived, { orgId: a, changed: sr.changed });

      const w = await survivorshipColumns(c, comptroller.businessId);
      // D-14: the display name stays Overture's, and still cites the Overture record...
      expect(w.display_name).toBe('Riverside Stone');
      expect(w.display_name_source_id).toBe(overture.sourceRecordId);
      expect(w.address_source_id).toBe(overture.sourceRecordId);
      expect(w.street).toBe(merged.street);
      // ...while legal_name, which D-14 gives the Comptroller, DOES take the new filing.
      expect(w.legal_name).toBe('RIVERSIDE STONE & TILE, INC.');
      expect(w.legal_name_source_id).toBe(comptroller.sourceRecordId);
    }));

  it('a changed Overture payload of a merge loser updates the winner', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { comptroller, overture } = await mergedPair(c, a);
      const loserBefore = await survivorshipColumns(c, overture.businessId);
      expect((await survivorshipColumns(c, comptroller.businessId)).phone_e164).toBe('+19566822400');

      await asDeskTier(c, 'ingest-overture');
      const stored = await payloadOf(c, overture.sourceRecordId);
      const row: OvertureFixtureRow = {
        id: String(stored.id),
        name: String(stored.name_primary),
        country: 'US',
        region: 'TX',
        locality: String(stored.locality),
        lat: Number(stored.lat),
        lng: Number(stored.lon),
        basic_category: String(stored.basic_category),
        phone: '(956) 682-9999', // the place changed its number
        street: String(stored.street),
        postcode: String(stored.postcode),
      };
      const input = overtureIngestInput(row, (await fixtureDerivationContext(c)).categoryMap);
      if (input === null) throw new Error('the transform skipped the re-ingested row');
      const x = asEtlExecutor(c);
      const sr = await upsertSourceRecord(x, {
        orgId: a,
        sourceKey: 'overture',
        externalId: input.externalId,
        payload: input.payload,
        sourceVersion: '2026-09-23.0',
        seenAt: new Date(),
      });
      expect(sr).toMatchObject({ id: overture.sourceRecordId, changed: true });
      await upsertBusinessFromSource(x, sr.id, input.derived, { orgId: a, changed: sr.changed });

      const w = await survivorshipColumns(c, comptroller.businessId);
      expect(w.phone_e164).toBe('+19566829999');
      expect(w.phone_source_id).toBe(overture.sourceRecordId);
      // The dead loser row is left alone: an unmerge re-derives it from its own records.
      expect(await survivorshipColumns(c, overture.businessId)).toEqual(loserBefore);
    }));

  it('a changed Census answer on a merge winner keeps the Overture location', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { comptroller, overture } = await mergedPair(c, a);
      const merged = await survivorshipColumns(c, comptroller.businessId);
      expect(merged.location_source_id).toBe(overture.sourceRecordId);

      await asDeskTier(c, 'ingest-comptroller');
      const x = asEtlExecutor(c);
      const permit = await payloadOf(c, comptroller.sourceRecordId);
      const externalId = `${String(permit.taxpayer_number)}-${String(permit.outlet_number)}`;
      // The Census reference data moved the point between benchmarks.
      const moved: Geocoder = async (rows) =>
        new Map(
          rows.map((r): [string, BatchOutcome] => [
            r.id,
            { kind: 'Match', matchType: 'Exact', matchedAddress: 'SYNTHETIC', lat: 26.19, lng: -98.22 },
          ]),
        );
      const db = etlTransactions(x, 'org_A', { nested: true });
      const out = await runGeocodePass(
        db,
        [
          {
            externalId,
            businessId: comptroller.businessId,
            geocodeInput: {
              street: String(permit.outlet_address),
              city: String(permit.outlet_city),
              zip: String(permit.outlet_zip_code),
            },
          },
        ],
        moved,
      );
      expect(out.tally).toMatchObject({ changed: 1 });

      const w = await survivorshipColumns(c, comptroller.businessId);
      expect({ lat: w.lat, lng: w.lng, src: w.location_source_id, type: w.location_match_type }).toEqual({
        lat: merged.lat,
        lng: merged.lng,
        src: overture.sourceRecordId,
        type: 'overture',
      });
    }));

  it('re-deriving an unchanged cluster writes nothing', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { comptroller } = await mergedPair(c, a);
      await asDeskTier(c, 'ingest-comptroller');
      const before = await businessEvents(c, a);
      const snapshot = await survivorshipColumns(c, comptroller.businessId);
      // The merge already wrote exactly what survive() yields, so the gate in
      // app.apply_survivorship_if_changed must find no difference.
      expect(await rederiveRoot(asEtlExecutor(c), a, comptroller.businessId, { caller: 'test' })).toBe(
        false,
      );
      expect(await businessEvents(c, a)).toBe(before);
      expect(await survivorshipColumns(c, comptroller.businessId)).toEqual(snapshot);
    }));

  it('an unchanged re-ingest of a merged pair writes no businesses event', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { comptroller } = await mergedPair(c, a);
      await asDeskTier(c, 'ingest-comptroller');
      const before = await businessEvents(c, a);
      const row = (await payloadOf(c, comptroller.sourceRecordId)) as unknown as ComptrollerFixtureRow;
      const input = comptrollerIngestInput(row, await fixtureDerivationContext(c));
      const x = asEtlExecutor(c);
      const sr = await upsertSourceRecord(x, {
        orgId: a,
        sourceKey: 'tx_comptroller',
        externalId: input.externalId,
        payload: input.payload,
        sourceVersion: '2026-10-20T00:00:00.000Z',
        seenAt: new Date(),
      });
      expect(sr.changed).toBe(false);
      const biz = await upsertBusinessFromSource(x, sr.id, input.derived, { orgId: a, changed: sr.changed });
      expect(biz.wrote).toBe(false);
      expect(await businessEvents(c, a)).toBe(before);
    }));
});
