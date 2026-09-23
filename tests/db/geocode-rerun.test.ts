/**
 * DATA-04 for the Census geocode pass (`runGeocodePass`, scripts/ingest-comptroller.ts), found by
 * the 03-20 desk run.
 *
 * On the real spine the SECOND identical Comptroller run reported every source row `unchanged`
 * and still wrote 908 `businesses` update events. Every one was a merge WINNER whose location
 * the merge's survivorship had set to the Overture point (survivorship.ts: lat/lng go Overture,
 * then Census Exact, then Census Non_Exact). `WRITE_LOCATION` ran for every Match on every run,
 * guarded only by `is distinct from`, so it wrote the Census point back over the survivor's
 * choice. That broke two things: the re-run-writes-nothing claim, and the committed survivorship
 * order.
 *
 * The Census pass now writes a location only when its source record is new or changed, which is
 * the same gate `upsertBusinessFromSource` applies to every other derived column.
 *
 * Desk-script connection shape: owner connection, NO `actAs`, only `setEtlActor` +
 * `resolveEtlOrg` (via `etlTransactions(..., { nested: true })`).
 */
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { resolveEtlOrg, setEtlActor } from '@/lib/ingest/etl-actor';
import type { BatchOutcome } from '@/lib/geocode/census-batch';
import {
  etlTransactions,
  runGeocodePass,
  type Geocoder,
  type PermitWritten,
} from '../../scripts/ingest-comptroller';
import { seedTwoOrgs, withRollback } from './_fixtures';
import {
  asEtlExecutor,
  COMPTROLLER_FIXTURE,
  OVERTURE_FIXTURE,
  seedComptrollerFixture,
  seedOvertureFixture,
} from './_ingest-fixtures';

const businessEvents = async (c: Client, orgId: string): Promise<number> =>
  Number(
    (
      await c.query<{ n: string }>(
        "select count(*) as n from events where entity_type='businesses' and org_id = $1",
        [orgId],
      )
    ).rows[0]?.n,
  );

const location = async (c: Client, id: string) =>
  (
    await c.query<{
      lat: number | null;
      lng: number | null;
      location_match_type: string | null;
      location_source_id: string | null;
    }>(
      'select lat, lng, location_match_type, location_source_id::text from businesses where id = $1',
      [id],
    )
  ).rows[0];

/** A fake Census batch: every row an Exact match at the given point (per row id). */
const exactAt =
  (points: Record<string, { lat: number; lng: number }>): Geocoder =>
  async (rows) =>
    new Map(
      rows.map((r): [string, BatchOutcome] => {
        const p = points[r.id] ?? { lat: 26.2, lng: -98.23 };
        return [r.id, { kind: 'Match', matchType: 'Exact', matchedAddress: 'SYNTHETIC', ...p }];
      }),
    );

describe('DATA-04: the Census geocode pass on a re-run', () => {
  it('a census re-run leaves a merge-chosen location alone and writes nothing', () =>
    withRollback(async (c) => {
      const orgs = await seedTwoOrgs(c); // owner connection; NO actAs
      const x = asEtlExecutor(c);
      await setEtlActor(x, 'ingest-comptroller');
      expect(await resolveEtlOrg(x, 'org_A')).toBe(orgs.a);

      const [a, b] = await seedComptrollerFixture(c, orgs.a, COMPTROLLER_FIXTURE.slice(0, 2));
      if (!a || !b) throw new Error('fixture seeded fewer than two businesses');
      const written: PermitWritten[] = [a, b].map((s) => ({
        externalId: s.externalId,
        businessId: s.businessId,
        geocodeInput: { street: '1200 N 10TH ST', city: 'MCALLEN', zip: '78501' },
      }));
      const points = {
        [a.externalId]: { lat: 26.21, lng: -98.231 },
        [b.externalId]: { lat: 26.22, lng: -98.232 },
      };
      const db = etlTransactions(x, 'org_A', { nested: true });

      // Run 1: both locations come from Census.
      const first = await runGeocodePass(db, written, exactAt(points));
      expect(first.tally).toMatchObject({ added: 2, changed: 0, unchanged: 0 });
      expect((await location(c, a.businessId))?.location_match_type).toBe('census_exact');

      // A merge's survivorship moves A's location to an Overture point (Overture outranks
      // Census Exact). Written as the definer would leave it: an Overture source record.
      const { seeded } = await seedOvertureFixture(c, orgs.a, OVERTURE_FIXTURE.slice(0, 1));
      const ov = seeded[0];
      if (!ov) throw new Error('overture fixture seeded no row');
      await c.query(
        `update businesses set lat = 26.2105, lng = -98.2312, location_match_type = 'overture',
                location_source_id = $2 where id = $1`,
        [a.businessId, ov.sourceRecordId],
      );
      const survivor = await location(c, a.businessId);
      const eventsBefore = await businessEvents(c, orgs.a);

      // Run 2: identical Census answers. Every record unchanged, and NOTHING written.
      const second = await runGeocodePass(db, written, exactAt(points));
      expect(second.tally).toMatchObject({ added: 0, changed: 0, unchanged: 2 });
      expect(second.stats.locations_written).toBe(0);
      expect(await businessEvents(c, orgs.a)).toBe(eventsBefore);
      expect(await location(c, a.businessId)).toEqual(survivor);

      // Positive control: a Census answer that CHANGED still writes its business's location.
      const moved = { ...points, [b.externalId]: { lat: 26.23, lng: -98.233 } };
      const third = await runGeocodePass(db, written, exactAt(moved));
      expect(third.tally).toMatchObject({ added: 0, changed: 1, unchanged: 1 });
      expect(third.stats.locations_written).toBe(1);
      expect((await location(c, b.businessId))?.lat).toBe(26.23);
      expect(await location(c, a.businessId)).toEqual(survivor);
    }));

  /**
   * A-WR-07 (review 03). "No_Match writes nothing" is right for a transient failure and wrong
   * when the permit's ADDRESS changed: the permits pass rewrites street/postal, the new address
   * comes back No_Match, and the business kept the OLD point, still citing a census record whose
   * `payload.input` names the old address — so the distance tiers, the geo gate and the 25 km
   * rule scored the new address at the old location. Now a No_Match or Tie whose stored census
   * input differs from the address just submitted clears the location. A ChunkFailed never
   * does, and neither does a No_Match for an address that did not move.
   */
  it('a No_Match after the address moved clears the stale location; a transient one does not', () =>
    withRollback(async (c) => {
      const orgs = await seedTwoOrgs(c);
      const x = asEtlExecutor(c);
      await setEtlActor(x, 'ingest-comptroller');
      expect(await resolveEtlOrg(x, 'org_A')).toBe(orgs.a);
      const [moved, stayed, failed] = await seedComptrollerFixture(
        c,
        orgs.a,
        COMPTROLLER_FIXTURE.slice(0, 3),
      );
      if (!moved || !stayed || !failed) throw new Error('fixture seeded fewer than three businesses');
      const input = (s: typeof moved, street: string) => ({
        externalId: s.externalId,
        businessId: s.businessId,
        geocodeInput: { street, city: 'MCALLEN', zip: '78501' },
      });
      const db = etlTransactions(x, 'org_A', { nested: true });

      // Run 1: all three located.
      const at = { lat: 26.21, lng: -98.231 };
      await runGeocodePass(
        db,
        [input(moved, '100 MAIN ST'), input(stayed, '200 MAIN ST'), input(failed, '300 MAIN ST')],
        exactAt({ [moved.externalId]: at, [stayed.externalId]: at, [failed.externalId]: at }),
      );
      for (const s of [moved, stayed, failed]) {
        expect((await location(c, s.businessId))?.location_match_type).toBe('census_exact');
      }

      // Run 2: `moved` has a new address that does not match; `stayed` did not move and does not
      // match this time (transient); `failed` lands in a failed chunk.
      const second = await runGeocodePass(
        db,
        [input(moved, '900 ELM ST'), input(stayed, '200 MAIN ST'), input(failed, '300 MAIN ST')],
        async (rows) =>
          new Map(
            rows.map((r): [string, BatchOutcome] => [
              r.id,
              r.id === failed.externalId
                ? { kind: 'ChunkFailed', reason: 'unreachable' }
                : { kind: 'No_Match' },
            ]),
          ),
      );
      expect(second.stats.location_cleared).toBe(1);
      expect(await location(c, moved.businessId)).toEqual({
        lat: null,
        lng: null,
        location_match_type: null,
        location_source_id: null,
      });
      expect((await location(c, stayed.businessId))?.location_match_type).toBe('census_exact');
      expect((await location(c, failed.businessId))?.location_match_type).toBe('census_exact');
    }));
});
