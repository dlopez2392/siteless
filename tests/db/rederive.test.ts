/**
 * scripts/rederive.ts — A-WR-06 and the normalizer-propagation mechanism (review 03).
 *
 * The ingests' payload-hash gate writes NOTHING for an unchanged payload (DATA-04), so a change
 * to an input that lives outside the payload — a normalizer (name_norm), the category map or
 * NAICS ranges (cluster_key), the city fold — never reached a stored row, not even through a
 * full re-ingest. D-02 promises that adding a cluster is "a mapping change, not a re-ingest".
 * The rederive pass recomputes every business from its stored payloads through the SAME
 * derivation functions the ingests and survivorship use, and writes only what differs.
 *
 * Each test simulates "the rule changed" the only way a test can: it puts a stored row out of
 * date by hand (as the owner, a test lever) and proves the pass brings it back — and that a
 * row already current is never written.
 *
 * Desk-tier connection shape: owner connection, no actAs; the pass installs `etl:rederive` and
 * the org claim in every transaction (`rederiveTransactions(..., { nested: true })`).
 */
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { resolveEtlOrg, setEtlActor } from '@/lib/ingest/etl-actor';
import { mergePair } from '@/lib/resolve/merge';
import { upsertSourceRecord } from '@/lib/ingest/upsert';
import {
  parseRederiveArgs,
  rederiveTransactions,
  RederiveOrgRequiredError,
  runRederivePass,
} from '../../scripts/rederive';
import { seedTwoOrgs, withRollback } from './_fixtures';
import {
  asEtlExecutor,
  COMPTROLLER_FIXTURE,
  fixtureDerivationContext,
  OVERTURE_FIXTURE,
  seedComptrollerFixture,
  seedOvertureFixture,
} from './_ingest-fixtures';
import { seedMergePair, survivorshipColumns } from './_merge-fixtures';

const businessEvents = async (c: Client, orgId: string): Promise<number> =>
  Number(
    (
      await c.query<{ n: string }>(
        "select count(*) as n from events where entity_type = 'businesses' and org_id = $1",
        [orgId],
      )
    ).rows[0]?.n,
  );

const col = async (c: Client, id: string, column: 'name_norm' | 'cluster_key' | 'city') =>
  (await c.query(`select ${column} as v from businesses where id = $1`, [id])).rows[0]?.v as
    | string
    | null;

/** A small spine seeded exactly as the ingests derive it (the LIVE city fold and map). */
async function seedSpine(c: Client, orgId: string) {
  const permits = await seedComptrollerFixture(
    c,
    orgId,
    COMPTROLLER_FIXTURE.slice(0, 4),
    await fixtureDerivationContext(c),
  );
  const { seeded: places } = await seedOvertureFixture(c, orgId, OVERTURE_FIXTURE.slice(0, 4));
  return { permits, places };
}

describe('the rederive pass (A-WR-06)', () => {
  it('rederive refuses to start without an org', () => {
    expect(() => parseRederiveArgs(['--dry-run'])).toThrow(RederiveOrgRequiredError);
    expect(() => parseRederiveArgs(['--org=org_A', '--orgs=typo'])).toThrow(/unknown argument/);
    expect(parseRederiveArgs(['--org=org_A', '--dry-run'])).toEqual({
      clerkOrgId: 'org_A',
      target: 'test',
      dryRun: true,
    });
  });

  it('an up-to-date spine: the pass writes no businesses row and no businesses event', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await seedSpine(c, a);
      const before = await businessEvents(c, a);
      const r = await runRederivePass(rederiveTransactions(asEtlExecutor(c), 'org_A', { nested: true }));
      // Positive control: the pass really visited the spine.
      expect(r.stats.businesses).toBe(8);
      expect(r.stats.roots).toBe(8);
      expect(r.stats).toMatchObject({ name_norm_written: 0, survivorship_written: 0 });
      // The run report is the ONE new businesses-typed event (entity_id null).
      expect(await businessEvents(c, a)).toBe(before + 1);
      expect(r.eventId).toMatch(/^\d+$/);
    }));

  it('a changed derivation reaches stored rows: name_norm, cluster_key and city come back, only there', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { permits, places } = await seedSpine(c, a);
      const [p0, p1, p2] = permits;
      const [o0] = places;
      if (!p0 || !p1 || !p2 || !o0) throw new Error('spine seeded too few rows');
      const truth = {
        p0: await col(c, p0.businessId, 'name_norm'),
        p1: await col(c, p1.businessId, 'cluster_key'),
        p2: await col(c, p2.businessId, 'city'),
        o0: await col(c, o0.businessId, 'cluster_key'),
      };
      // Positive control: the rules really produce values to lose.
      expect(truth).toEqual({
        p0: 'tacos guero',
        p1: 'food_hospitality',
        p2: 'Edinburg',
        // 'taco_restaurant' is not in the seeded map: the truth is NULL, and a stale cluster on
        // an unmapped place must come back to NULL (complete mode), not be kept.
        o0: null,
      });
      // "The rule changed after these rows were written": four stale derived values.
      await c.query("update businesses set name_norm = 'stale' where id = $1", [p0.businessId]);
      await c.query('update businesses set cluster_key = null where id = $1', [p1.businessId]);
      await c.query("update businesses set city = 'EDINBURG' where id = $1", [p2.businessId]);
      await c.query("update businesses set cluster_key = 'auto_retail' where id = $1", [o0.businessId]);
      const before = await businessEvents(c, a);

      const r = await runRederivePass(rederiveTransactions(asEtlExecutor(c), 'org_A', { nested: true }));
      expect(r.stats).toMatchObject({ name_norm_written: 1, survivorship_written: 3 });
      expect({
        p0: await col(c, p0.businessId, 'name_norm'),
        p1: await col(c, p1.businessId, 'cluster_key'),
        p2: await col(c, p2.businessId, 'city'),
        o0: await col(c, o0.businessId, 'cluster_key'),
      }).toEqual(truth);
      // Exactly the four rows moved (one event each), plus the run report.
      expect(await businessEvents(c, a)).toBe(before + 4 + 1);
    }));

  it('a clustered business is re-derived through survivorship, not from its own record', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { comptroller, overture, candidateId } = await seedMergePair(c, a);
      const x = asEtlExecutor(c);
      await setEtlActor(x, 'resolve');
      await resolveEtlOrg(x, 'org_A');
      await mergePair(x, {
        candidateId,
        leftId: comptroller.businessId,
        rightId: overture.businessId,
        reason: 'auto',
        score: 95,
        features: {},
      });
      const merged = await survivorshipColumns(c, comptroller.businessId);
      // A stale winner: the single-record values a pre-fix re-ingest would have left.
      await c.query(
        `update businesses set display_name = legal_name, display_name_source_id = $2
          where id = $1`,
        [comptroller.businessId, comptroller.sourceRecordId],
      );
      const r = await runRederivePass(rederiveTransactions(x, 'org_A', { nested: true }));
      expect(r.stats.survivorship_written).toBe(1);
      expect(await survivorshipColumns(c, comptroller.businessId)).toEqual(merged);
      expect(merged.display_name_source_id).toBe(overture.sourceRecordId);
    }));

  it('a census point for an address the permit no longer has is not restored', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const [p] = await seedComptrollerFixture(
        c,
        a,
        COMPTROLLER_FIXTURE.slice(0, 1),
        await fixtureDerivationContext(c),
      );
      if (!p) throw new Error('no permit seeded');
      // A census record that answered an OLD address, still cited by the business.
      const census = await upsertSourceRecord(asEtlExecutor(c), {
        orgId: a,
        sourceKey: 'census_geocoder',
        externalId: p.externalId,
        payload: {
          input: { street: '1 OLD RD', city: 'MCALLEN', state: 'TX', zip: '78501' },
          match_type: 'Exact',
          matched_address: '1 OLD RD, MCALLEN, TX, 78501',
          lat: 26.1,
          lng: -98.1,
        },
        sourceVersion: 'Public_AR_Current',
        seenAt: new Date(),
      });
      await c.query(
        `update businesses set lat = 26.1, lng = -98.1, location_match_type = 'census_exact',
                location_source_id = $2 where id = $1`,
        [p.businessId, census.id],
      );
      const r = await runRederivePass(rederiveTransactions(asEtlExecutor(c), 'org_A', { nested: true }));
      expect(r.stats.survivorship_written).toBe(1);
      const w = await survivorshipColumns(c, p.businessId);
      expect({ lat: w.lat, lng: w.lng, src: w.location_source_id }).toEqual({
        lat: null,
        lng: null,
        src: null,
      });
    }));

  it('a dry run measures the same writes and leaves every row and event as it was', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const { permits } = await seedSpine(c, a);
      const p0 = permits[0]!;
      await c.query("update businesses set name_norm = 'stale' where id = $1", [p0.businessId]);
      const before = await businessEvents(c, a);
      const r = await runRederivePass(
        rederiveTransactions(asEtlExecutor(c), 'org_A', { nested: true }),
        { dryRun: true },
      );
      expect(r.stats).toMatchObject({ dry_run: true, name_norm_written: 1 });
      expect(r.eventId).toBeNull();
      expect(await col(c, p0.businessId, 'name_norm')).toBe('stale');
      expect(await businessEvents(c, a)).toBe(before);
    }));
});
