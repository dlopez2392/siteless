/**
 * Phase 4 plan 15. The result writers of drizzle/0029 as DATABASE FACTS.
 *
 *   * D-05 / D-06 / D-08 / D-10 / PLACE-02 — app.record_places_page is the one writer of tile
 *     membership, run outcomes, attachments, observations and coordinates. A rejected pair and
 *     a confirmed attachment are sticky (M40); ties write two tentative rows naming each other;
 *     one observation per (run, business, place); coordinates expire exactly 30 days later.
 *   * T-3-11 / T-4-05 / M36 — pa_features_numeric refuses Places text in features at the TABLE,
 *     even through the writer, even when the application's own refusal is bypassed.
 *   * D-16 — app.record_change_check inserts new members, marks gone ones (never deletes) and
 *     flags the tile changed.
 *   * D-05 — app.decide_place_attachment confirms / rejects / detaches, pending-only (55000).
 *   * T-4-06 — every caller-supplied id re-read under the caller's org (42501).
 *
 * 🔴 PRODUCER→CONSUMER CONTRACT. Every record handed to the writer is built by the real
 * producer chain — `toPlaceForMatch` → `decide` → `toPageRecord` — never by hand-typed JSON, so a
 * drift between page-record.ts and the definer's key reads is a red test here. The two tests
 * that must get text or a malformed id past `toPageRecord` start from its output and mutate it,
 * once, deliberately.
 *
 * Seeds go in as the OWNER before `actAs` (the Places tables are SELECT-only for authenticated
 * and place_coordinates grants it nothing, drizzle/0027); reads of place_coordinates and events
 * go back to the owner. Every refusal is its own `withRollback` (the next statement would report
 * 25P02), pinned by SQLSTATE and message.
 *
 * Mutations (live DB, each reverted and re-read from the catalog; 04-15-SUMMARY lists the reds):
 *   M40  the attachment upsert without its `where … <> 'rejected' and … <> 'confirmed'` guard →
 *        "a rejected pair never re-attaches" red.
 *   M36  `alter table place_attachments drop constraint pa_features_numeric` → both
 *        "refuse text in features" tests red.
 */
import { describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import type { HostClass } from '@/lib/places/host-class';
import {
  decide,
  toPlaceForMatch,
  type PlaceFeatures,
  type ScoredCandidate,
} from '@/lib/places/match';
import { toPageRecord, type PageRecord, type PageRecordItem } from '@/lib/places/page-record';

import { actAs, actAsOwner, seedTwoOrgs, withRollback } from './_fixtures';
import {
  CLAIMS_A,
  CLAIMS_B,
  seedPlacesRun,
  seedPlacesSpine,
  seedRunSearch,
  type SpineKey,
} from './_places-fixtures';

const TILE = 'city:48215/McAllen|plumber|r';
const CTX = { clusterKey: 'home_services', queriedCity: 'McAllen' };

/** A realistic located-match feature set: numbers, the signal array, nothing else. */
const FEATURES: PlaceFeatures = {
  name: 30,
  phone: 40,
  address: 25,
  distance: 0,
  cluster: 5,
  nameSim: 1,
  distanceM: 12,
  signals: ['name', 'phone', 'address'],
  listingPhone: 1,
  listingLocation: 1,
};

/** What `place_attachments.features` holds of FEATURES: toPageRecord drops the two continuous,
 *  Google-derived inputs (memory-only since 2026-09-23). */
const PERSISTED_FEATURES = {
  name: 30,
  phone: 40,
  address: 25,
  distance: 0,
  cluster: 5,
  signals: ['name', 'phone', 'address'],
  listingPhone: 1,
  listingLocation: 1,
};

type Spine = Record<SpineKey, string>;

type Setup = {
  a: string;
  b: string;
  spine: Spine;
  runId: string;
  tileId: string;
  searchId: string;
};

/** Two orgs, the spine in A, one running full sweep in A and one enterprise search on TILE. */
async function setup(c: Client): Promise<Setup> {
  const { a, b } = await seedTwoOrgs(c);
  const spine = await seedPlacesSpine(c, a);
  const run = await seedPlacesRun(c, a);
  const rs = await seedRunSearch(c, a, run.runId, { tileKey: TILE, placesType: 'plumber' });
  return { a, b, spine, runId: run.runId, tileId: rs.tileId, searchId: rs.runSearchId };
}

function cand(businessId: string, score: number): ScoredCandidate {
  return { businessId, score, features: FEATURES };
}

/**
 * One listing through the real producer chain: a Places-shaped result → `toPlaceForMatch` →
 * `decide` over the given scored candidates → a `PageRecordItem`. The address string exists
 * only here, in memory, exactly as in the step.
 */
function listing(
  placeId: string,
  cands: ScoredCandidate[],
  opts: { outside?: boolean; pureSab?: boolean; host?: HostClass; pin?: boolean } = {},
): PageRecordItem {
  const pfm = toPlaceForMatch(
    {
      id: placeId,
      formattedAddress: opts.outside
        ? 'Calle 1, Reynosa, Tamps., Mexico'
        : 'McAllen, TX 78501, USA',
      location: opts.pin === false ? undefined : { latitude: 26.2159, longitude: -98.2336 },
      pureServiceAreaBusiness: opts.pureSab === true,
    },
    CTX,
  );
  const host = opts.host ?? 'none';
  return {
    decision: decide(pfm, cands),
    pureSab: pfm.pureSab,
    hadWebsiteUri: host !== 'none',
    hostClass: host,
    lat: pfm.lat,
    lng: pfm.lng,
  };
}

function page(n: 1 | 2 | 3, items: PageRecordItem[], resultsSoFar = items.length): PageRecord {
  return toPageRecord({ page: n, sku: 'ts_enterprise', resultsSoFar, items });
}

type Counts = { attached: number; tentative: number; unmatched: number; outside: number };

async function writePage(c: Client, searchId: string, record: unknown): Promise<Counts> {
  const r = await c.query<{ r: Counts }>('select app.record_places_page($1, $2::jsonb) as r', [
    searchId,
    JSON.stringify(record),
  ]);
  return r.rows[0]!.r;
}

type AttRow = {
  id: string;
  business_id: string;
  status: string;
  reason: string;
  score: number;
  features: unknown;
  tie_business_id: string | null;
};

async function attachments(c: Client, orgId: string, placeId: string): Promise<AttRow[]> {
  const r = await c.query<AttRow>(
    `select id, business_id, status, reason, score, features, tie_business_id
       from place_attachments where org_id = $1 and place_id = $2 order by business_id`,
    [orgId, placeId],
  );
  return r.rows;
}

async function count(c: Client, sql: string, params: unknown[]): Promise<number> {
  const r = await c.query<{ n: string }>(sql, params);
  return Number(r.rows[0]!.n);
}

const observationsOf = (c: Client, placeId: string) =>
  count(c, 'select count(*)::text as n from place_observations where place_id = $1', [placeId]);

const membersOf = (c: Client, tileId: string, placeId: string) =>
  count(
    c,
    'select count(*)::text as n from place_tile_members where tile_id = $1 and place_id = $2',
    [tileId, placeId],
  );

async function outcomeOf(c: Client, runId: string, placeId: string): Promise<string | undefined> {
  const r = await c.query<{ outcome: string }>(
    `select outcome from run_place_outcomes
      where run_id = $1 and place_id = $2 and cluster_key = 'home_services'`,
    [runId, placeId],
  );
  expect(r.rows.length).toBeLessThanOrEqual(1);
  return r.rows[0]?.outcome;
}

/** As the owner: an attachment in a given state, for the sticky and decision tests. */
async function seedAttachment(
  c: Client,
  orgId: string,
  businessId: string,
  placeId: string,
  status: 'attached' | 'tentative' | 'rejected',
  reason: 'score' | 'tie' | 'confirmed' | 'rejected' | 'detached',
  score: number,
): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into place_attachments (org_id, business_id, place_id, status, reason, score, features)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb) returning id`,
    [orgId, businessId, placeId, status, reason, score, JSON.stringify({ name: 45 })],
  );
  return r.rows[0]!.id;
}

describe('app.record_places_page (D-05, D-06, D-08, D-10, PLACE-02)', () => {
  it('record_places_page attaches, observes and records outcomes', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      // A durable cursor from the page's reservation: the settled page must clear it.
      await c.query(`update run_searches set inflight_request_id = 'req-p1' where id = $1`, [
        s.searchId,
      ]);
      await actAs(c, CLAIMS_A);

      const counts = await writePage(
        c,
        s.searchId,
        page(1, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 97)])]),
      );
      expect(counts).toEqual({ attached: 1, tentative: 0, unmatched: 0, outside: 0 });

      const att = await attachments(c, s.a, 'ChIJ-ortiz');
      expect(att).toHaveLength(1);
      expect(att[0]).toMatchObject({
        business_id: s.spine.ortiz,
        status: 'attached',
        reason: 'score',
        score: 97,
        tie_business_id: null,
      });
      expect(att[0]!.features).toEqual(PERSISTED_FEATURES);
      // Read back from the table, not from the record: neither continuous input was written.
      expect(att[0]!.features).not.toHaveProperty('nameSim');
      expect(att[0]!.features).not.toHaveProperty('distanceM');

      const obs = await c.query<{
        attachment_id: string;
        had_website_uri: boolean;
        host_class: string;
        sku: string;
        pure_sab: boolean;
        run_id: string;
      }>(
        `select attachment_id, had_website_uri, host_class, sku, pure_sab, run_id
           from place_observations where place_id = 'ChIJ-ortiz'`,
      );
      expect(obs.rows).toEqual([
        {
          attachment_id: att[0]!.id,
          had_website_uri: false,
          host_class: 'none',
          sku: 'ts_enterprise',
          pure_sab: false,
          run_id: s.runId,
        },
      ]);
      expect(await membersOf(c, s.tileId, 'ChIJ-ortiz')).toBe(1);
      expect(await outcomeOf(c, s.runId, 'ChIJ-ortiz')).toBe('attached');

      const rs = await c.query<{
        pages_done: number;
        results_count: number;
        status: string;
        inflight_request_id: string | null;
      }>(
        'select pages_done, results_count, status, inflight_request_id from run_searches where id = $1',
        [s.searchId],
      );
      expect(rs.rows[0]).toEqual({
        pages_done: 1,
        results_count: 1,
        status: 'searching',
        inflight_request_id: null,
      });

      // D-10 / T-4-04: coordinates are not readable by a tenant at all — read as the owner.
      await actAsOwner(c);
      const co = await c.query<{ lat: number; lng: number; ttl: string }>(
        `select pc.lat, pc.lng, extract(epoch from pc.expires_at - pc.observed_at)::text as ttl
           from place_coordinates pc
           join place_observations po on po.id = pc.observation_id
          where po.place_id = 'ChIJ-ortiz'`,
      );
      expect(co.rows).toHaveLength(1);
      expect(co.rows[0]).toMatchObject({ lat: 26.2159, lng: -98.2336 });
      expect(Number(co.rows[0]!.ttl)).toBe(2_592_000);
    }));

  it('a second page for the same place does not duplicate its observation', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      await actAs(c, CLAIMS_A);
      await writePage(c, s.searchId, page(1, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 97)])]));
      await writePage(
        c,
        s.searchId,
        page(2, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 97)])], 2),
      );

      expect(await observationsOf(c, 'ChIJ-ortiz')).toBe(1);
      expect(await membersOf(c, s.tileId, 'ChIJ-ortiz')).toBe(1);
      expect(await attachments(c, s.a, 'ChIJ-ortiz')).toHaveLength(1);
      const rs = await c.query<{ pages_done: number; results_count: number }>(
        'select pages_done, results_count from run_searches where id = $1',
        [s.searchId],
      );
      expect(rs.rows[0]).toEqual({ pages_done: 2, results_count: 2 });
      await actAsOwner(c);
      expect(
        await count(
          c,
          `select count(*)::text as n from place_coordinates pc
             join place_observations po on po.id = pc.observation_id where po.place_id = $1`,
          ['ChIJ-ortiz'],
        ),
      ).toBe(1);
    }));

  it('record_places_page keeps the higher outcome rank across pages', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      await actAs(c, CLAIMS_A);
      await writePage(c, s.searchId, page(1, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 97)])]));
      // The same place on a later page, now scoring below review: 'unmatched' ranks lower.
      const later = await writePage(
        c,
        s.searchId,
        page(2, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 50)])], 2),
      );
      expect(later).toEqual({ attached: 0, tentative: 0, unmatched: 1, outside: 0 });
      expect(await outcomeOf(c, s.runId, 'ChIJ-ortiz')).toBe('attached');
    }));

  it('a rejected pair never re-attaches', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      await seedAttachment(c, s.a, s.spine.ortiz, 'ChIJ-ortiz', 'rejected', 'rejected', 90);
      await actAs(c, CLAIMS_A);

      const counts = await writePage(
        c,
        s.searchId,
        page(1, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 97)])]),
      );

      // M40: a 97 that would attach anywhere else leaves the rejected pair exactly as it was.
      expect(await attachments(c, s.a, 'ChIJ-ortiz')).toEqual([
        expect.objectContaining({ status: 'rejected', reason: 'rejected', score: 90 }),
      ]);
      expect(await observationsOf(c, 'ChIJ-ortiz')).toBe(0);
      expect(await outcomeOf(c, s.runId, 'ChIJ-ortiz')).toBe('unmatched');
      expect(counts).toEqual({ attached: 0, tentative: 0, unmatched: 1, outside: 0 });
      // The place id is still kept as a member (D-06).
      expect(await membersOf(c, s.tileId, 'ChIJ-ortiz')).toBe(1);
    }));

  // A-WR-01. The scorer's cluster feature compares the business's cluster with the SEARCH's,
  // so one (business, place) pair scores differently in two clusters' searches. The upsert
  // must never let the lower one downgrade an auto-attached listing: the status would depend
  // on step order, each flip would write an events row, and the listing would leave
  // business_place_signal (a false "no website" if it was the one with a site).
  for (const order of ['attached first', 'tentative first'] as const) {
    it(`the same place seen by two cluster searches ends attached (${order})`, () =>
      withRollback(async (c) => {
        const s = await setup(c);
        const other = await seedRunSearch(c, s.a, s.runId, {
          tileKey: 'city:48215/McAllen|car_repair|r',
          placesType: 'car_repair',
          clusterKey: 'auto_retail',
        });
        await actAs(c, CLAIMS_A);
        const hi = page(1, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 96)], { host: 'social' })]);
        const lo = page(1, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 91)], { host: 'social' })]);
        if (order === 'attached first') {
          await writePage(c, s.searchId, hi);
          await writePage(c, other.runSearchId, lo);
        } else {
          await writePage(c, other.runSearchId, lo);
          await writePage(c, s.searchId, hi);
        }

        const att = await attachments(c, s.a, 'ChIJ-ortiz');
        expect(att).toEqual([
          expect.objectContaining({ status: 'attached', reason: 'score', score: 96 }),
        ]);
        // Still a verdict input, whichever search wrote last.
        const sig = await c.query<{ business_id: string }>(
          'select business_id from business_place_signal where business_id = $1',
          [s.spine.ortiz],
        );
        expect(sig.rows).toEqual([{ business_id: s.spine.ortiz }]);
        await actAsOwner(c);
        // No attached → tentative flip was written: at most the one upgrade.
        const ev = await c.query<{ before: string; after: string }>(
          `select before->>'status' as before, after->>'status' as after from events
            where entity_type = 'place_attachments' and entity_id = $1 order by id`,
          [att[0]!.id],
        );
        expect(ev.rows).toEqual(
          order === 'attached first' ? [] : [{ before: 'tentative', after: 'attached' }],
        );
      }));
  }

  it('a confirmed attachment is not re-scored by a later run', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      await seedAttachment(c, s.a, s.spine.ortiz, 'ChIJ-ortiz', 'attached', 'confirmed', 97);
      await actAs(c, CLAIMS_A);

      await writePage(c, s.searchId, page(1, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 85)])]));

      const att = await attachments(c, s.a, 'ChIJ-ortiz');
      expect(att).toEqual([
        expect.objectContaining({ status: 'attached', reason: 'confirmed', score: 97 }),
      ]);
      expect(att[0]!.features).toEqual({ name: 45 });
      // Still the business's listing: this run observed it, and the place is attached.
      expect(await observationsOf(c, 'ChIJ-ortiz')).toBe(1);
      expect(await outcomeOf(c, s.runId, 'ChIJ-ortiz')).toBe('attached');
    }));

  it('a tie writes two tentative rows naming each other', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      await actAs(c, CLAIMS_A);

      const counts = await writePage(
        c,
        s.searchId,
        page(1, [listing('ChIJ-rio', [cand(s.spine.rio, 97), cand(s.spine.rioCo, 96)])]),
      );

      const att = await attachments(c, s.a, 'ChIJ-rio');
      expect(att).toHaveLength(2);
      const byBiz = new Map(att.map((r) => [r.business_id, r]));
      expect(byBiz.get(s.spine.rio)).toMatchObject({
        status: 'tentative',
        reason: 'tie',
        score: 97,
        tie_business_id: s.spine.rioCo,
      });
      expect(byBiz.get(s.spine.rioCo)).toMatchObject({
        status: 'tentative',
        reason: 'tie',
        score: 96,
        tie_business_id: s.spine.rio,
      });
      expect(counts).toEqual({ attached: 0, tentative: 1, unmatched: 0, outside: 0 });
      expect(await outcomeOf(c, s.runId, 'ChIJ-rio')).toBe('tentative');
    }));

  it('a tentative match is observed but not a signal', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      await actAs(c, CLAIMS_A);

      await writePage(
        c,
        s.searchId,
        page(1, [
          listing('ChIJ-ortiz', [cand(s.spine.ortiz, 85)], { host: 'social' }),
          // The positive control: an ATTACHED listing on the same page does reach the view.
          listing('ChIJ-valley', [cand(s.spine.valley, 97)], { host: 'directory' }),
        ]),
      );

      expect(await observationsOf(c, 'ChIJ-ortiz')).toBe(1);
      const sig = await c.query<{ business_id: string; had_website_uri: boolean }>(
        'select business_id, had_website_uri from business_place_signal where business_id = any($1::uuid[])',
        [[s.spine.ortiz, s.spine.valley]],
      );
      expect(sig.rows).toEqual([{ business_id: s.spine.valley, had_website_uri: true }]);
    }));

  it('an outside listing is a member and an outcome, never an attachment', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      await actAs(c, CLAIMS_A);

      const counts = await writePage(
        c,
        s.searchId,
        page(1, [listing('ChIJ-mexico', [cand(s.spine.ortiz, 97)], { outside: true })]),
      );

      expect(counts).toEqual({ attached: 0, tentative: 0, unmatched: 0, outside: 1 });
      expect(await membersOf(c, s.tileId, 'ChIJ-mexico')).toBe(1);
      expect(await outcomeOf(c, s.runId, 'ChIJ-mexico')).toBe('outside');
      expect(await attachments(c, s.a, 'ChIJ-mexico')).toEqual([]);
      expect(await observationsOf(c, 'ChIJ-mexico')).toBe(0);
    }));

  it('an unmatched listing keeps only its place id', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      await actAs(c, CLAIMS_A);

      const counts = await writePage(
        c,
        s.searchId,
        page(1, [listing('ChIJ-nothing', [cand(s.spine.ortiz, 50)])]),
      );

      expect(counts).toEqual({ attached: 0, tentative: 0, unmatched: 1, outside: 0 });
      expect(await membersOf(c, s.tileId, 'ChIJ-nothing')).toBe(1);
      expect(await outcomeOf(c, s.runId, 'ChIJ-nothing')).toBe('unmatched');
      expect(await attachments(c, s.a, 'ChIJ-nothing')).toEqual([]);
      expect(await observationsOf(c, 'ChIJ-nothing')).toBe(0);
    }));

  it('a merged business is never attached', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      await c.query(`update businesses set merged_into_id = $1, status = 'merged' where id = $2`, [
        s.spine.garza,
        s.spine.ortiz,
      ]);
      await actAs(c, CLAIMS_A);

      const counts = await writePage(
        c,
        s.searchId,
        page(1, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 97)])]),
      );

      expect(await attachments(c, s.a, 'ChIJ-ortiz')).toEqual([]);
      expect(await observationsOf(c, 'ChIJ-ortiz')).toBe(0);
      expect(counts).toEqual({ attached: 0, tentative: 0, unmatched: 1, outside: 0 });
      expect(await outcomeOf(c, s.runId, 'ChIJ-ortiz')).toBe('unmatched');
    }));

  it("record_places_page refuses another org's search", () =>
    withRollback(async (c) => {
      const s = await setup(c);
      const runB = await seedPlacesRun(c, s.b);
      const rsB = await seedRunSearch(c, s.b, runB.runId, { tileKey: TILE, placesType: 'plumber' });
      await actAs(c, CLAIMS_A);
      // The positive control is the first test: the same call on the caller's own search writes.
      const attempt = writePage(
        c,
        rsB.runSearchId,
        page(1, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 97)])]),
      );
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(
        /record_places_page: search belongs to another org or does not exist/,
      );
    }));

  it('record_places_page refuses a business of another org', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      const spineB = await seedPlacesSpine(c, s.b);
      await actAs(c, CLAIMS_A);
      const attempt = writePage(
        c,
        s.searchId,
        page(1, [listing('ChIJ-ortiz', [cand(spineB.ortiz, 97)])]),
      );
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(
        /record_places_page: business belongs to another org or does not exist/,
      );
    }));

  it('record_places_page refuses a tie naming a business of another org', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      const spineB = await seedPlacesSpine(c, s.b);
      await actAs(c, CLAIMS_A);
      const record = page(1, [
        listing('ChIJ-rio', [cand(s.spine.rio, 97), cand(s.spine.rioCo, 96)]),
      ]);
      // toPageRecord does not know org boundaries; the definer must.
      record.places[0]!.matches[0]!.tieBusinessId = spineB.rio;
      const attempt = writePage(c, s.searchId, record);
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(
        /record_places_page: tie business belongs to another org or does not exist/,
      );
    }));

  it('record_places_page refuses an ids_only search', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const spine = await seedPlacesSpine(c, a);
      const run = await seedPlacesRun(c, a, { kind: 'change_check' });
      const rs = await seedRunSearch(c, a, run.runId, {
        tileKey: TILE,
        placesType: 'plumber',
        kind: 'ids_only',
      });
      await actAs(c, CLAIMS_A);
      const attempt = writePage(
        c,
        rs.runSearchId,
        page(1, [listing('ChIJ-ortiz', [cand(spine.ortiz, 97)])]),
      );
      await expect(attempt).rejects.toMatchObject({ code: '22023' });
      await expect(attempt).rejects.toThrow(
        /record_places_page: search is not an enterprise search/,
      );
    }));

  // A-WR-07. An Essentials (IDs-only) page carries no websiteUri, so every observation written
  // from one would be a false had_website_uri=false in an append-only table. An enterprise
  // search records ts_enterprise pages only. Positive control: every page() above is
  // ts_enterprise and writes.
  it('record_places_page refuses an essentials page on an enterprise search', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      await actAs(c, CLAIMS_A);
      const record = toPageRecord({
        page: 1,
        sku: 'ts_essentials',
        resultsSoFar: 1,
        items: [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 97)])],
      });
      const attempt = writePage(c, s.searchId, record);
      await expect(attempt).rejects.toMatchObject({ code: '22023' });
      await expect(attempt).rejects.toThrow(
        /record_places_page: an enterprise search records ts_enterprise pages only/,
      );
    }));

  it('record_places_page refuses a place id that is not a place id', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      await actAs(c, CLAIMS_A);
      const record = page(1, [listing('ChIJ-nothing', [cand(s.spine.ortiz, 50)])]);
      // Deliberately past toPageRecord: the one Google value kept forever must look like an id.
      record.places[0]!.placeId = 'Ortiz Plumbing';
      const attempt = writePage(c, s.searchId, record);
      await expect(attempt).rejects.toMatchObject({ code: '22023' });
      await expect(attempt).rejects.toThrow(/record_places_page: placeId is not a place id/);
    }));
});

describe('pa_features_numeric (T-3-11 / T-4-05, M36)', () => {
  it('place attachments refuse text in features', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      // Positive control: the owner can insert a numbers-only features value.
      await seedAttachment(c, s.a, s.spine.garza, 'ChIJ-garza', 'tentative', 'score', 85);
      const attempt = c.query(
        `insert into place_attachments (org_id, business_id, place_id, status, reason, score, features)
         values ($1, $2, 'ChIJ-ortiz', 'tentative', 'score', 85, '{"displayName":"x"}'::jsonb)`,
        [s.a, s.spine.ortiz],
      );
      await expect(attempt).rejects.toMatchObject({
        code: '23514',
        constraint: 'pa_features_numeric',
      });
    }));

  it('record_places_page refuses Places text in features', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      await actAs(c, CLAIMS_A);
      const record = page(1, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 97)])]);
      // 🔴 THE ONE DELIBERATE BYPASS of toPageRecord (which throws on exactly this): the
      // application regressed, and the table is the last wall.
      (record.places[0]!.matches[0]!.features as unknown as Record<string, unknown>).name =
        'Ortiz Plumbing';
      const attempt = writePage(c, s.searchId, record);
      await expect(attempt).rejects.toMatchObject({
        code: '23514',
        constraint: 'pa_features_numeric',
      });
    }));

  // A-WR-06. The legal line is the 11 persisted keys (page-record.ts FEATURE_KEYS) with INTEGER
  // points; the continuous nameSim / distanceM are memory-only. The CHECK is the wall behind
  // toPageRecord, so each is refused at the table, through the writer, as the user. The
  // positive control is "record_places_page attaches, observes and records outcomes" (the same
  // record without the mutation writes).
  it('features carrying nameSim is 23514', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      await actAs(c, CLAIMS_A);
      const record = page(1, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 97)])]);
      (record.places[0]!.matches[0]!.features as unknown as Record<string, unknown>).nameSim = 0.93;
      const attempt = writePage(c, s.searchId, record);
      await expect(attempt).rejects.toMatchObject({
        code: '23514',
        constraint: 'pa_features_numeric',
      });
    }));

  it('features carrying distanceM is 23514', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      await actAs(c, CLAIMS_A);
      const record = page(1, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 97)])]);
      (record.places[0]!.matches[0]!.features as unknown as Record<string, unknown>).distanceM =
        12;
      const attempt = writePage(c, s.searchId, record);
      await expect(attempt).rejects.toMatchObject({
        code: '23514',
        constraint: 'pa_features_numeric',
      });
    }));

  it('a non-integer point value is 23514', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      await actAs(c, CLAIMS_A);
      const record = page(1, [listing('ChIJ-ortiz', [cand(s.spine.ortiz, 97)])]);
      // A continuous similarity smuggled in under an allow-listed points key.
      (record.places[0]!.matches[0]!.features as unknown as Record<string, unknown>).name = 29.7;
      const attempt = writePage(c, s.searchId, record);
      await expect(attempt).rejects.toMatchObject({
        code: '23514',
        constraint: 'pa_features_numeric',
      });
    }));
});

describe('app.record_change_check (D-16)', () => {
  async function changeSetup(c: Client) {
    const { a, b } = await seedTwoOrgs(c);
    const run = await seedPlacesRun(c, a, { kind: 'change_check' });
    const rs = await seedRunSearch(c, a, run.runId, {
      tileKey: TILE,
      placesType: 'plumber',
      kind: 'ids_only',
    });
    for (const id of ['ChIJ-keep', 'ChIJ-gone1']) {
      await c.query(
        'insert into place_tile_members (org_id, tile_id, place_id) values ($1, $2, $3)',
        [a, rs.tileId, id],
      );
    }
    return { a, b, runId: run.runId, tileId: rs.tileId, searchId: rs.runSearchId };
  }

  async function check(
    c: Client,
    searchId: string,
    added: string[],
    gone: string[],
    verdict: string,
    seen: number,
  ): Promise<void> {
    await c.query('select app.record_change_check($1, $2::jsonb, $3::jsonb, $4, $5)', [
      searchId,
      JSON.stringify(added),
      JSON.stringify(gone),
      verdict,
      seen,
    ]);
  }

  type Member = { place_id: string; gone: boolean };
  async function members(c: Client, tileId: string): Promise<Member[]> {
    const r = await c.query<Member>(
      `select place_id, gone_at is not null as gone from place_tile_members
        where tile_id = $1 order by place_id`,
      [tileId],
    );
    return r.rows;
  }

  it('record_change_check inserts new members and marks gone ones', () =>
    withRollback(async (c) => {
      const s = await changeSetup(c);
      await actAs(c, CLAIMS_A);
      await check(c, s.searchId, ['ChIJ-new1', 'ChIJ-new2'], ['ChIJ-gone1'], 'both', 3);

      expect(await members(c, s.tileId)).toEqual([
        { place_id: 'ChIJ-gone1', gone: true },
        { place_id: 'ChIJ-keep', gone: false },
        { place_id: 'ChIJ-new1', gone: false },
        { place_id: 'ChIJ-new2', gone: false },
      ]);
      const tile = await c.query<{ changed: boolean; checked: boolean }>(
        `select changed_at is not null as changed, last_checked_at is not null as checked
           from place_tiles where id = $1`,
        [s.tileId],
      );
      expect(tile.rows[0]).toEqual({ changed: true, checked: true });
      const rs = await c.query(
        `select change_verdict, new_ids, gone_ids, results_count, pages_done
           from run_searches where id = $1`,
        [s.searchId],
      );
      expect(rs.rows[0]).toEqual({
        change_verdict: 'both',
        new_ids: 2,
        gone_ids: 1,
        results_count: 3,
        pages_done: 1,
      });
    }));

  it('record_change_check never deletes a member', () =>
    withRollback(async (c) => {
      const s = await changeSetup(c);
      await actAs(c, CLAIMS_A);
      await check(c, s.searchId, [], ['ChIJ-gone1', 'ChIJ-keep'], 'gone', 0);
      // Both rows survive as history.
      expect(await members(c, s.tileId)).toEqual([
        { place_id: 'ChIJ-gone1', gone: true },
        { place_id: 'ChIJ-keep', gone: true },
      ]);
      // A returning id is revived, not duplicated; an unchanged verdict leaves changed_at alone.
      await actAsOwner(c);
      await c.query('update place_tiles set changed_at = null where id = $1', [s.tileId]);
      await actAs(c, CLAIMS_A);
      await check(c, s.searchId, ['ChIJ-keep'], [], 'unchanged', 1);
      expect(await members(c, s.tileId)).toEqual([
        { place_id: 'ChIJ-gone1', gone: true },
        { place_id: 'ChIJ-keep', gone: false },
      ]);
      const tile = await c.query<{ changed: boolean }>(
        'select changed_at is not null as changed from place_tiles where id = $1',
        [s.tileId],
      );
      expect(tile.rows[0]).toEqual({ changed: false });
    }));

  it("record_change_check refuses another org's search", () =>
    withRollback(async (c) => {
      const s = await changeSetup(c);
      await actAs(c, CLAIMS_B);
      const attempt = check(c, s.searchId, ['ChIJ-x'], [], 'new', 1);
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(
        /record_change_check: search belongs to another org or does not exist/,
      );
    }));

  it('record_change_check refuses an unknown verdict', () =>
    withRollback(async (c) => {
      const s = await changeSetup(c);
      await actAs(c, CLAIMS_A);
      const attempt = check(c, s.searchId, [], [], 'changed', 0);
      await expect(attempt).rejects.toMatchObject({ code: '22023' });
      await expect(attempt).rejects.toThrow(/record_change_check: unknown verdict/);
    }));

  it('record_change_check refuses an enterprise search', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      await actAs(c, CLAIMS_A);
      const attempt = check(c, s.searchId, [], [], 'unchanged', 0);
      await expect(attempt).rejects.toMatchObject({ code: '22023' });
      await expect(attempt).rejects.toThrow(
        /record_change_check: search is not an ids_only change check/,
      );
    }));
});

describe('app.decide_place_attachment (D-05)', () => {
  type Decided = { business_id: string; place_id: string; status: string };

  async function decideAs(c: Client, id: string, decision: string): Promise<Decided[]> {
    const r = await c.query<Decided>(
      'select business_id, place_id, status from app.decide_place_attachment($1, $2)',
      [id, decision],
    );
    return r.rows;
  }

  async function row(c: Client, id: string) {
    const r = await c.query<{
      status: string;
      reason: string;
      decided_by: string | null;
      decided: boolean;
    }>(
      `select status, reason, decided_by, decided_at is not null as decided
         from place_attachments where id = $1`,
      [id],
    );
    return r.rows[0];
  }

  it('decide_place_attachment confirms a tentative listing', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      const id = await seedAttachment(
        c,
        s.a,
        s.spine.ortiz,
        'ChIJ-ortiz',
        'tentative',
        'score',
        85,
      );
      await actAs(c, CLAIMS_A);
      expect(await decideAs(c, id, 'confirm')).toEqual([
        { business_id: s.spine.ortiz, place_id: 'ChIJ-ortiz', status: 'attached' },
      ]);
      expect(await row(c, id)).toEqual({
        status: 'attached',
        reason: 'confirmed',
        decided_by: 'user_reviewer_A',
        decided: true,
      });
    }));

  it('decide_place_attachment rejects a tentative listing', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      const id = await seedAttachment(c, s.a, s.spine.ortiz, 'ChIJ-ortiz', 'tentative', 'tie', 96);
      await actAs(c, CLAIMS_A);
      expect(await decideAs(c, id, 'reject')).toEqual([
        { business_id: s.spine.ortiz, place_id: 'ChIJ-ortiz', status: 'rejected' },
      ]);
      expect(await row(c, id)).toEqual({
        status: 'rejected',
        reason: 'rejected',
        decided_by: 'user_reviewer_A',
        decided: true,
      });
    }));

  it('decide_place_attachment detaches an attached listing', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      const id = await seedAttachment(c, s.a, s.spine.ortiz, 'ChIJ-ortiz', 'attached', 'score', 97);
      await actAs(c, CLAIMS_A);
      expect(await decideAs(c, id, 'detach')).toEqual([
        { business_id: s.spine.ortiz, place_id: 'ChIJ-ortiz', status: 'rejected' },
      ]);
      expect(await row(c, id)).toEqual({
        status: 'rejected',
        reason: 'detached',
        decided_by: 'user_reviewer_A',
        decided: true,
      });
    }));

  it('decide_place_attachment refuses a decided listing', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      // Already confirmed: confirm is pending-only (the positive control is the confirm test).
      const id = await seedAttachment(
        c,
        s.a,
        s.spine.ortiz,
        'ChIJ-ortiz',
        'attached',
        'confirmed',
        97,
      );
      await actAs(c, CLAIMS_A);
      const attempt = decideAs(c, id, 'confirm');
      await expect(attempt).rejects.toMatchObject({ code: '55000' });
      await expect(attempt).rejects.toThrow(/decide_place_attachment: already decided/);
    }));

  // Each branch's from-state guard is its own statement, so each gets its own refusal: a
  // detach is for an ATTACHED listing, a reject for a TENTATIVE one.
  it('decide_place_attachment will not detach a tentative listing', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      const id = await seedAttachment(
        c,
        s.a,
        s.spine.ortiz,
        'ChIJ-ortiz',
        'tentative',
        'score',
        85,
      );
      await actAs(c, CLAIMS_A);
      const attempt = decideAs(c, id, 'detach');
      await expect(attempt).rejects.toMatchObject({ code: '55000' });
      await expect(attempt).rejects.toThrow(/decide_place_attachment: already decided/);
    }));

  it('decide_place_attachment will not reject an attached listing', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      const id = await seedAttachment(c, s.a, s.spine.ortiz, 'ChIJ-ortiz', 'attached', 'score', 97);
      await actAs(c, CLAIMS_A);
      const attempt = decideAs(c, id, 'reject');
      await expect(attempt).rejects.toMatchObject({ code: '55000' });
      await expect(attempt).rejects.toThrow(/decide_place_attachment: already decided/);
    }));

  it("decide_place_attachment refuses another org's attachment", () =>
    withRollback(async (c) => {
      const s = await setup(c);
      const spineB = await seedPlacesSpine(c, s.b);
      const idB = await seedAttachment(
        c,
        s.b,
        spineB.ortiz,
        'ChIJ-ortiz',
        'tentative',
        'score',
        85,
      );
      await actAs(c, CLAIMS_A);
      const attempt = decideAs(c, idB, 'confirm');
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(
        /decide_place_attachment: attachment belongs to another org or does not exist/,
      );
    }));

  it('decide_place_attachment refuses an unknown decision', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      const id = await seedAttachment(
        c,
        s.a,
        s.spine.ortiz,
        'ChIJ-ortiz',
        'tentative',
        'score',
        85,
      );
      await actAs(c, CLAIMS_A);
      const attempt = decideAs(c, id, 'skip');
      await expect(attempt).rejects.toMatchObject({ code: '22023' });
      await expect(attempt).rejects.toThrow(
        /decide_place_attachment: decision must be confirm, reject or detach/,
      );
    }));

  it('a listing decision writes one event', () =>
    withRollback(async (c) => {
      const s = await setup(c);
      const id = await seedAttachment(
        c,
        s.a,
        s.spine.ortiz,
        'ChIJ-ortiz',
        'tentative',
        'score',
        85,
      );
      await actAs(c, CLAIMS_A);
      await decideAs(c, id, 'confirm');
      await actAsOwner(c);
      const ev = await c.query<{ action: string; actor_id: string; before: string; after: string }>(
        `select action, actor_id, before->>'status' as before, after->>'status' as after
           from events where entity_type = 'place_attachments' and entity_id = $1`,
        [id],
      );
      expect(ev.rows).toEqual([
        { action: 'update', actor_id: 'user_reviewer_A', before: 'tentative', after: 'attached' },
      ]);
    }));
});

describe('writer grants', () => {
  it('only authenticated may execute the Places writers', () =>
    withRollback(async (c) => {
      const r = await c.query<{ fn: string; role: string; can: boolean }>(
        `select f.fn, r.role, has_function_privilege(r.role, f.fn, 'EXECUTE') as can
           from unnest(array['app.record_places_page(uuid,jsonb)',
                             'app.record_change_check(uuid,jsonb,jsonb,text,integer)',
                             'app.decide_place_attachment(uuid,text)',
                             'app.places_features_ok(jsonb)']) as f(fn)
          cross join unnest(array['authenticated','anon','service_role','public']) as r(role)
          where r.role <> 'public'
          order by 1, 2`,
      );
      expect(r.rows).toHaveLength(12);
      for (const x of r.rows) {
        expect({ fn: x.fn, role: x.role, can: x.can }).toEqual({
          fn: x.fn,
          role: x.role,
          can: x.role === 'authenticated',
        });
      }
      // PUBLIC, read off the ACL: no `=X/` entry (an empty grantee) on any of the four.
      const acl = await c.query<{ fn: string; acl: string | null }>(
        `select p.oid::regprocedure::text as fn, p.proacl::text as acl
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app'
            and p.proname in ('record_places_page','record_change_check','decide_place_attachment','places_features_ok')`,
      );
      expect(acl.rows).toHaveLength(4);
      for (const x of acl.rows) {
        // A NULL proacl means the DEFAULT privileges — which include PUBLIC execute.
        expect(x.acl).not.toBeNull();
        expect(x.acl).not.toMatch(/[{,]=X/);
      }
    }));
});
