/**
 * The resolve pass END TO END (scripts/resolve.ts, plan 03-14): block → score → auto-merge →
 * enqueue, composed. `blocking.test.ts` (03-10) and `merge-unmerge.test.ts` (03-11) prove the
 * parts; this file proves the COMPOSITION — the three bands land where they should, chains are
 * skipped, `distinct` sticks, a cluster resolves to one winner, the pass is deterministic and
 * org-scoped, the block cap is reported, and the whole thing runs on the desk connection.
 *
 * 🔴 THE STAGES RUN IN `nested` MODE: every stage transaction is a SAVEPOINT inside
 * `withRollback`, so nothing is ever committed to the shared database. Tens of rows per test.
 *
 * 🔴 TWO CONNECTION SHAPES, ON PURPOSE.
 *   - Tests 1–5 (and the cluster test) run under `withPermissiveClaims`: an owner connection
 *     that ALSO carries an `actAs` org claim, the shape every `actAs`-tier fixture has. It is
 *     more permissive than the desk connection, which is exactly why test 6 exists.
 *   - `the pass runs from an owner connection with no claims` carries NO claim anywhere and
 *     drives the stages exactly as `pnpm resolve` connects. Watched red against a
 *     `resolveEtlOrg` that installs no claim: `42501 record_merge: no current org`, while every
 *     permissive-claim test stayed green (03-14-SUMMARY.md has the output).
 *
 * The fixture businesses are owner-inserted with every column the scorer reads set explicitly,
 * so each pair's score is an exact integer this file can pin. The name pairs were chosen by
 * their MEASURED pg_trgm similarity (the scorer takes it from SQL, never from TypeScript):
 *   'la estrella bakery' ~ 'estrella bakery'        0.8889 → name 37
 *   'la estrella bakery' ~ 'la estrella panaderia'  0.3929 → name 0 (B2′ gate is 0.3)
 *   'edinburg ac repair' ~ 'edinburg ac'            0.6316 → name 17 (R3 bar is 0.6)
 */
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  EtlOrgNotFoundError,
  EtlOrgRequiredError,
  type EtlExecutor,
} from '@/lib/ingest/etl-actor';
import { recordCandidateDecision, unmergeBusinesses } from '@/lib/resolve/merge';
import { REVIEW_SCORE, type LocationMatchType } from '@/lib/resolve/score';
import {
  assertTrigramPlan,
  planUsesTrigramIndex,
  preflight,
  resolveTransactions,
  runResolvePass,
  stageBlock,
  stageChains,
  stageDistanceGate,
  mergeCandidate,
  stageMerge,
  stageScore,
  TrigramPlanError,
  type ResolveDb,
  type ResolveReport,
} from '../../scripts/resolve';
import { actAs, actAsOwner, SQL_FRESH_EXTERNAL_KEY, seedTwoOrgs, withRollback } from './_fixtures';
import { asEtlExecutor } from './_ingest-fixtures';
import { CLAIMS_A } from './_merge-fixtures';
import tripleJson from '../unit/fixtures/merge-triple.json';

// ---------------------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------------------

interface Biz {
  name: string;
  phone?: string | null;
  blockable?: boolean;
  streetNum?: string | null;
  streetNorm?: string | null;
  postal?: string | null;
  lat?: number | null;
  lng?: number | null;
  match?: LocationMatchType | null;
  cluster?: string | null;
  source?: 'tx_comptroller' | 'overture';
  /** Back-dates created_at, which decides the merge winner (older wins). */
  ageHours?: number;
}

/** One owner-inserted business. `name` is written straight into `name_norm` (already normal). */
async function biz(c: Client, orgId: string, b: Biz): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into businesses (org_id, external_key, display_name, name_norm, phone_e164,
                             phone_blockable, street_num, street_norm, postal, lat, lng,
                             location_match_type, cluster_key, primary_source, created_at)
     values ($1, ${SQL_FRESH_EXTERNAL_KEY}, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             now() - make_interval(hours => $13::int))
     returning id`,
    [
      orgId,
      b.name,
      b.phone ?? null,
      b.blockable ?? false,
      b.streetNum ?? null,
      b.streetNorm ?? null,
      b.postal ?? null,
      b.lat ?? null,
      b.lng ?? null,
      b.match ?? null,
      b.cluster ?? null,
      b.source ?? 'tx_comptroller',
      b.ageHours ?? 0,
    ],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error('biz: insert returned no row');
  return id;
}

/** P95: same name, full address, 22 m apart, same cluster → 45 + 30 + 15 + 5 = 95. */
async function seedPair95(c: Client, orgId: string, name = 'riverside stone') {
  const addr = { streetNum: '900', streetNorm: 'e business 83', postal: '78501', cluster: 'home_services' };
  const older = await biz(c, orgId, { name, ...addr, lat: 26.18, lng: -98.21, match: 'census_exact', ageHours: 24 });
  const newer = await biz(c, orgId, { name, ...addr, lat: 26.1802, lng: -98.21, match: 'overture', source: 'overture' });
  return { older, newer };
}

/** P87: name 37 (sim 0.8889) + address 30 + distance 15 + cluster 5 = 87. */
async function seedPair87(c: Client, orgId: string) {
  const addr = { streetNum: '201', streetNorm: 's closner blvd', postal: '78539', cluster: 'food_hospitality' };
  const a = await biz(c, orgId, { name: 'la estrella bakery', ...addr, lat: 26.3, lng: -98.16, match: 'census_exact' });
  const b = await biz(c, orgId, { name: 'estrella bakery', ...addr, lat: 26.3003, lng: -98.16, match: 'overture', source: 'overture' });
  return { a, b };
}

/** P35: name 0 (sim 0.3929) + address 30 + no locations + cluster 5 = 35. Blocked by B2′ only. */
async function seedPair35(c: Client, orgId: string) {
  const addr = { streetNum: '900', streetNorm: 'e expressway 83', postal: '78596', cluster: 'food_hospitality' };
  const a = await biz(c, orgId, { name: 'la estrella bakery', ...addr });
  const b = await biz(c, orgId, { name: 'la estrella panaderia', ...addr, source: 'overture' });
  return { a, b };
}

/**
 * 🔴 WORD-PERMUTED NAMES. The triple's three records share ONE `name_norm`, and three live
 * businesses with one name ARE a chain under D-11's local count — so on identical names every
 * edge is capped at 94 and nothing auto-merges (pinned below by 'three identical names read as a
 * chain and wait for review'). pg_trgm builds its trigram set per word, so a permutation of the
 * same words has similarity exactly 1.0 (measured) while being three different names.
 */
const PERMUTED = ['synthetic riverside stone', 'riverside stone synthetic', 'stone synthetic riverside'];

/** Three businesses from the SYNTHETIC ≥95 triple (tests/unit/fixtures/merge-triple.json). */
async function seedTriple(c: Client, orgId: string, opts: { identicalNames?: boolean } = {}) {
  const ids: string[] = [];
  for (const [i, r] of tripleJson.records.entries()) {
    ids.push(
      await biz(c, orgId, {
        name: opts.identicalNames ? r.nameNorm : PERMUTED[i]!,
        streetNum: r.streetNum,
        streetNorm: r.streetNorm,
        postal: r.postal,
        lat: r.lat,
        lng: r.lng,
        match: r.locationMatchType as LocationMatchType,
        cluster: r.clusterKey,
        source: r.source as 'tx_comptroller' | 'overture',
        ageHours: 3 - i, // T01-a oldest
      }),
    );
  }
  return ids;
}

const pairOf = (x: string, y: string) => (x < y ? [x, y] : [y, x]) as [string, string];

async function candidate(c: Client, orgId: string, x: string, y: string) {
  const [l, r] = pairOf(x, y);
  const res = await c.query<{
    id: string;
    decision: string;
    score: number;
    features: Record<string, unknown>;
  }>(
    `select id, decision, score, features from merge_candidates
      where org_id = $1 and left_id = $2 and right_id = $3`,
    [orgId, l, r],
  );
  return res.rows[0];
}

async function mergedInto(c: Client, ids: string[]) {
  const r = await c.query<{ id: string; merged_into_id: string | null }>(
    'select id, merged_into_id from businesses where id = any($1::uuid[]) order by id',
    [ids],
  );
  return Object.fromEntries(r.rows.map((x) => [x.id, x.merged_into_id]));
}

/** The desk transaction runner over the test's connection, as savepoints. */
const deskDb = (c: Client, clerkOrgId = 'org_A'): ResolveDb =>
  resolveTransactions(asEtlExecutor(c), clerkOrgId, { nested: true });

/**
 * 🔴 THE PERMISSIVE FIXTURE: an `actAs` org claim left installed, then back to the owner role
 * (the pass writes tables `authenticated` holds SELECT-only on). This is the shape of every
 * `actAs`-tier test, and it hides a desk tier that installs no org claim of its own.
 */
async function withPermissiveClaims(c: Client): Promise<void> {
  await actAs(c, CLAIMS_A);
  await actAsOwner(c);
}

const runPass = (c: Client, opts: { dryRun?: boolean } = {}): Promise<ResolveReport> =>
  runResolvePass(deskDb(c), opts);

// ---------------------------------------------------------------------------------------

describe('the resolve pass (DEDUP-01, DEDUP-02)', () => {
  it('a resolve pass merges at 95 and enqueues at 80', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const p95 = await seedPair95(c, a);
      const p87 = await seedPair87(c, a);
      const p35 = await seedPair35(c, a);
      await withPermissiveClaims(c);

      const report = await runPass(c);

      // The blockers found exactly the three pairs (B2′ ∪ B3; no cross pairs).
      const all = await c.query('select 1 from merge_candidates where org_id = $1', [a]);
      expect(all.rows).toHaveLength(3);

      const c95 = await candidate(c, a, p95.older, p95.newer);
      expect(c95).toMatchObject({ decision: 'merged', score: 95 });
      const m = await c.query<{ winner_id: string; loser_id: string; reason: string; score: number }>(
        'select winner_id, loser_id, reason, score from business_merges where candidate_id = $1',
        [c95!.id],
      );
      expect(m.rows).toEqual([{ winner_id: p95.older, loser_id: p95.newer, reason: 'auto', score: 95 }]);

      const c87 = await candidate(c, a, p87.a, p87.b);
      expect(c87).toMatchObject({ decision: 'pending', score: 87 });
      expect(c87!.features).toMatchObject({
        name: 37,
        phone: 0,
        address: 30,
        distance: 15,
        cluster: 5,
        signals: ['name', 'address', 'distance'],
      });

      const c35 = await candidate(c, a, p35.a, p35.b);
      expect(c35).toMatchObject({ decision: 'pending', score: 35 });

      // The review queue is the pending rows at or above the floor: the 87 only.
      const queue = await c.query<{ id: string }>(
        `select id from merge_candidates
          where org_id = $1 and decision = 'pending' and score >= $2 order by score desc`,
        [a, REVIEW_SCORE],
      );
      expect(queue.rows.map((r) => r.id)).toEqual([c87!.id]);

      expect(report.stats.bands).toEqual({ merge: 1, review: 1, ignore: 1, distinct: 0 });
      expect(report.stats.merges).toMatchObject({ considered: 1, merged: 1 });
      // The run report is one event carrying the band counts. (Its ATTRIBUTION is asserted on
      // the no-claims tier only — 'a block over the cap…' — because this test's permissive
      // claim carries a `sub` of its own.)
      const ev = await c.query<{ action: string; entity_type: string; after: { bands: unknown } }>(
        'select action, entity_type, after from events where id = $1',
        [report.eventId],
      );
      expect(ev.rows).toEqual([
        { action: 'resolve', entity_type: 'businesses', after: expect.objectContaining({ bands: report.stats.bands }) },
      ]);
    }));

  it('a chain-flagged pair is never auto-merged', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      // (i) A DIRECT chain pair: raw 17 + 30 + 30 + 15 + 5 = 97, R3 keeps it at 97, R2 caps it.
      const shared = {
        phone: '+19563801234',
        blockable: true,
        streetNum: '315',
        streetNorm: 'e freddy gonzalez dr',
        postal: '78539',
        cluster: 'home_services',
      };
      const k1 = await biz(c, a, { name: 'edinburg ac repair', ...shared, lat: 26.3, lng: -98.16, match: 'census_exact' });
      const k1b = await biz(c, a, { name: 'edinburg ac', ...shared, lat: 26.3002, lng: -98.16, match: 'overture', source: 'overture' });
      // Two more live members make 'edinburg ac repair' a chain (D-11: >= 3).
      await biz(c, a, { name: 'edinburg ac repair', postal: '78572' });
      const k3 = await biz(c, a, { name: 'edinburg ac repair', postal: '78577' });

      // (ii) A chain reached THROUGH A CLUSTER: B was merged into the chain member K3 earlier
      // (test lever: the owner writes the merged state), so B's own row carries no flag. B–C is a
      // 95 pair left pending from an earlier pass. Only the root K3 carries the chain.
      const tri = { streetNum: '900', streetNorm: 'e synthetic business 83', postal: '78577', cluster: 'home_services' };
      const bId = await biz(c, a, { name: 'synthetic riverside stone', ...tri, lat: 26.1948, lng: -98.1836, match: 'overture', source: 'overture' });
      const cId = await biz(c, a, { name: 'synthetic riverside stone', ...tri, lat: 26.1949, lng: -98.1836, match: 'census_exact' });
      await c.query(`update businesses set status = 'merged', merged_into_id = $2 where id = $1`, [bId, k3]);
      const [l, r] = pairOf(bId, cId);
      await c.query(
        `insert into merge_candidates (org_id, left_id, right_id, block_key) values ($1, $2, $3, 'trgm_zip')`,
        [a, l, r],
      );
      await withPermissiveClaims(c);

      const report = await runPass(c);

      // Positive control: the flag landed, and the features sum to the raw 97.
      const flags = await c.query<{ id: string; chain_key: string | null }>(
        'select id, chain_key from businesses where id = any($1::uuid[])',
        [[k1, k3, bId]],
      );
      const flagOf = Object.fromEntries(flags.rows.map((x) => [x.id, x.chain_key]));
      expect(flagOf[k1]).toBe('edinburg ac repair');
      expect(flagOf[k3]).toBe('edinburg ac repair');
      expect(flagOf[bId]).toBeNull();

      const direct = await candidate(c, a, k1, k1b);
      const f = direct!.features as Record<string, number>;
      expect(f.name! + f.phone! + f.address! + f.distance! + f.cluster!).toBe(97);
      // 🔴 Two guards, two assertions: the CAP (score 94) and the SKIP (decision pending).
      expect(direct).toMatchObject({ decision: 'pending', score: 94 });

      const viaCluster = await candidate(c, a, bId, cId);
      expect(viaCluster).toMatchObject({ decision: 'pending', score: 95 });
      const merges = await c.query('select 1 from business_merges where org_id = $1', [a]);
      expect(merges.rows).toEqual([]);
      expect(report.stats.merges).toMatchObject({ considered: 1, merged: 0, skipped_chain: 1 });
    }));

  it('an unmerged pair is never re-proposed', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const p = await seedPair95(c, a);
      await withPermissiveClaims(c);

      await runPass(c);
      const first = await candidate(c, a, p.older, p.newer);
      expect(first!.decision).toBe('merged');
      const merge = await c.query<{ id: string }>('select id from business_merges where org_id = $1', [a]);
      expect(merge.rows).toHaveLength(1);

      // The reviewer undoes it — D-20: the unmerge IS the "different" decision.
      await deskDb(c).run(({ tx }) => unmergeBusinesses(tx, { mergeId: merge.rows[0]!.id }));
      expect((await candidate(c, a, p.older, p.newer))!.decision).toBe('distinct');

      // The next pass meets the same pair at the same 95 and must leave it alone.
      const second = await runPass(c);
      expect((await candidate(c, a, p.older, p.newer))!.decision).toBe('distinct');
      const after = await c.query<{ id: string; undone: boolean }>(
        'select id, undone_at is not null as undone from business_merges where org_id = $1',
        [a],
      );
      expect(after.rows).toEqual([{ id: merge.rows[0]!.id, undone: true }]);
      expect(await mergedInto(c, [p.older, p.newer])).toEqual({ [p.older]: null, [p.newer]: null });
      expect(second.stats.merges).toMatchObject({ considered: 0, merged: 0 });
    }));

  it('the pass is deterministic', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      // All three edges score 95. The two outer businesses were already judged different, so
      // exactly ONE of the two remaining (tied) edges may merge — which one depends only on the
      // order the pass takes equal scores in.
      const ids = await seedTriple(c, a);
      const [x, , z] = [...ids].sort();
      const [l, r] = pairOf(x!, z!);
      const seeded = await c.query<{ id: string }>(
        `insert into merge_candidates (org_id, left_id, right_id, block_key) values ($1, $2, $3, 'trgm_zip') returning id`,
        [a, l, r],
      );
      await withPermissiveClaims(c);
      await deskDb(c).run(({ tx }) =>
        recordCandidateDecision(tx, { candidateId: seeded.rows[0]!.id, decision: 'distinct' }),
      );

      // Eight runs over the identical fixture. Every run REGENERATES the candidates (new random
      // ids), so an order that leaned on the candidate id would flip about half the time.
      await c.query('savepoint determinism');
      const outcomes: string[] = [];
      for (let run = 0; run < 8; run++) {
        const report = await runPass(c);
        expect(report.stats.merges).toMatchObject({ merged: 1, skipped_distinct: 1 });
        outcomes.push(JSON.stringify(await mergedInto(c, ids)));
        await c.query('rollback to savepoint determinism');
      }
      expect(new Set(outcomes).size).toBe(1);
    }));

  it('the pass is org-scoped', () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoOrgs(c);
      const inA = await seedPair95(c, a);
      const inB = await seedPair95(c, b);
      const chainB: string[] = [];
      for (const postal of ['78501', '78539', '78572']) {
        chainB.push(await biz(c, b, { name: 'valley feed store', postal }));
      }
      const [l, r] = pairOf(inB.older, inB.newer);
      const cb = await c.query<{ id: string }>(
        `insert into merge_candidates (org_id, left_id, right_id, block_key) values ($1, $2, $3, 'trgm_zip') returning id`,
        [b, l, r],
      );
      await withPermissiveClaims(c);

      const report = await runPass(c);

      expect((await candidate(c, a, inA.older, inA.newer))!.decision).toBe('merged'); // positive control
      // The pass never even READ org B's candidate: the scorer saw org A's one pair. (The write
      // is org-bound too, so without this line a scorer reading every tenant would pass green.)
      expect(report.stats.scored).toBe(1);
      expect(report.stats.bands).toEqual({ merge: 1, review: 0, ignore: 0, distinct: 0 });
      const candB = await c.query('select id, decision, score, features from merge_candidates where org_id = $1', [b]);
      expect(candB.rows).toEqual([{ id: cb.rows[0]!.id, decision: 'pending', score: 0, features: {} }]);
      const bizB = await c.query<{ n: number }>(
        `select count(*)::int as n from businesses
          where org_id = $1 and (merged_into_id is not null or chain_key is not null)`,
        [b],
      );
      expect(bizB.rows[0]!.n).toBe(0);
      const mergesB = await c.query('select 1 from business_merges where org_id = $1', [b]);
      expect(mergesB.rows).toEqual([]);
    }));

  it('the pass runs from an owner connection with no claims', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const p = await seedPair95(c, a);
      // The shape this test depends on: no claims anywhere, and not the authenticated role.
      const shape = await c.query<{ claims: string | null; who: string }>(
        "select nullif(current_setting('request.jwt.claims', true), '') as claims, current_user as who",
      );
      expect(shape.rows[0]!.claims).toBeNull();
      expect(shape.rows[0]!.who).not.toBe('authenticated');

      // The stages, driven exactly as the desk script drives them.
      const db = deskDb(c);
      await stageChains(db);
      await stageBlock(db);
      await stageDistanceGate(db);
      await stageScore(db);
      const merged = await stageMerge(db);
      expect(merged).toMatchObject({ considered: 1, merged: 1 });

      const m = await c.query<{ merged_by: string; reason: string; winner_id: string }>(
        'select merged_by, reason, winner_id from business_merges where org_id = $1',
        [a],
      );
      expect(m.rows).toEqual([{ merged_by: 'etl:resolve', reason: 'auto', winner_id: p.older }]);
    }));

  it('stage 0 preflight resolves the org before any stage', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      // No claims on the connection: the preflight's org comes from resolveEtlOrg alone.
      expect(await preflight(deskDb(c))).toBe(a);
      await expect(preflight(deskDb(c, 'org_nope'))).rejects.toBeInstanceOf(EtlOrgNotFoundError);
      await expect(preflight(deskDb(c, ''))).rejects.toBeInstanceOf(EtlOrgRequiredError);
      // Nothing the refusals touched was written.
      const cands = await c.query('select 1 from merge_candidates where org_id = $1', [a]);
      expect(cands.rows).toEqual([]);
    }));

  it('a three-way cluster merges to one winner through the pass', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const ids = await seedTriple(c, a);
      const winner = ids[0]!; // T01-a, the oldest
      await withPermissiveClaims(c);

      const report = await runPass(c);

      expect(report.stats.bands.merge).toBe(3); // every edge scored 95 by the committed scorer
      expect(report.stats.merges).toMatchObject({ considered: 3, merged: 2, already_one: 1 });
      expect(await mergedInto(c, ids)).toEqual({
        [ids[0]!]: null,
        [ids[1]!]: winner,
        [ids[2]!]: winner,
      });
      // M25's target: no merged_into_id anywhere in the org points at a merged row.
      const chains = await c.query(
        `select l.id from businesses l join businesses w on w.id = l.merged_into_id
          where l.org_id = $1 and w.merged_into_id is not null`,
        [a],
      );
      expect(chains.rows).toEqual([]);
      const decisions = await c.query<{ decision: string }>(
        'select decision from merge_candidates where org_id = $1',
        [a],
      );
      expect(decisions.rows.map((r) => r.decision)).toEqual(['merged', 'merged', 'merged']);
    }));

  it('three identical names read as a chain and wait for review', () =>
    withRollback(async (c) => {
      // The finding behind PERMUTED: the SAME synthetic triple, names left identical. D-11 counts
      // live rows per name BEFORE any merge, so an unresolved three-way duplicate is a "chain":
      // every edge is capped at 94 and lands in review, never in auto-merge. Safe (review, not a
      // wrong merge), but it is recall the desk run (03-20) should measure.
      const { a } = await seedTwoOrgs(c);
      const ids = await seedTriple(c, a, { identicalNames: true });
      await withPermissiveClaims(c);

      const report = await runPass(c);

      expect(report.stats.chains).toMatchObject({ names: 1, rows: 3 });
      expect(report.stats.bands).toEqual({ merge: 0, review: 3, ignore: 0, distinct: 0 });
      expect(await mergedInto(c, ids)).toEqual(Object.fromEntries(ids.map((id) => [id, null])));
    }));

  it('a block over the cap is named in the run report', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      // 33 places sharing one blockable number = 528 pairs > 500. Each in its own ZIP, so no
      // other shape pairs them.
      for (let i = 0; i < 33; i++) {
        await biz(c, a, {
          name: `shared line shop ${i}`,
          phone: '+19566300000',
          blockable: true,
          postal: String(77000 + i),
        });
      }
      const report = await runPass(c);

      expect(report.stats.skipped_blocks).toEqual([{ block_key: 'phone:+19566300000', size: 528 }]);
      const cands = await c.query('select 1 from merge_candidates where org_id = $1', [a]);
      expect(cands.rows).toEqual([]); // refused whole, never truncated
      const ev = await c.query<{ actor_id: string; after: { skipped_blocks: unknown } }>(
        'select actor_id, after from events where id = $1',
        [report.eventId],
      );
      expect(ev.rows[0]!.actor_id).toBe('etl:resolve');
      expect(ev.rows[0]!.after.skipped_blocks).toEqual([{ block_key: 'phone:+19566300000', size: 528 }]);
    }));

  it('the trigram plan guard refuses a plan without the GIN index', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await seedPair95(c, a);
      const db = deskDb(c);
      // Positive controls: the matcher, and the small-org exemption.
      expect(planUsesTrigramIndex('->  Bitmap Index Scan on businesses_name_trgm  (cost=0.00..8.00)')).toBe(true);
      expect(planUsesTrigramIndex('->  Seq Scan on businesses o  (cost=0.00..2.60)')).toBe(false);
      expect(await db.run(({ tx, orgId }) => assertTrigramPlan(tx, orgId))).toBe('unchecked_small');

      // Force the O(n²) plan and make the guard look at it (floor 0).
      await c.query('set local enable_indexscan = off');
      await c.query('set local enable_bitmapscan = off');
      const check = (tx: EtlExecutor, orgId: string) => assertTrigramPlan(tx, orgId, 0);
      await expect(db.run(({ tx, orgId }) => check(tx, orgId))).rejects.toBeInstanceOf(TrigramPlanError);
    }));
});

/**
 * A-WR-03 (review 03). The pass settled "both sides are one root" only for the >= 95 queue, and
 * left a distinct-blocked >= 95 pair pending forever — so the review queue asked about pairs
 * that were already one business, and ranked FIRST a pair between two clusters a person had
 * just ruled apart. The pass now settles every pending pair of either kind.
 */
describe('the pass settles stale pending pairs (A-WR-03)', () => {
  it('a pending pair inside one cluster is marked merged, and one across a distinct ruling distinct', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      const far = { streetNum: '1', streetNorm: 'far rd', postal: '78599', cluster: null };
      // Cluster one: x absorbs y and z by hand (the merges happened through other edges).
      const x = await biz(c, a, { name: 'alpha one', ...far, ageHours: 3 });
      const y = await biz(c, a, { name: 'bravo two', ...far });
      const z = await biz(c, a, { name: 'charlie three', ...far });
      // Two clusters a person ruled apart: p | q, with r merged into q.
      const p = await biz(c, a, { name: 'delta four', ...far });
      const q = await biz(c, a, { name: 'echo five', ...far, ageHours: 3 });
      const r = await biz(c, a, { name: 'foxtrot six', ...far });
      await c.query('update businesses set merged_into_id = $1, status = $2 where id = any($3::uuid[])', [
        x,
        'merged',
        [y, z],
      ]);
      await c.query("update businesses set merged_into_id = $1, status = 'merged' where id = $2", [q, r]);
      const cand = async (u: string, v: string, score: number, decision = 'pending') => {
        const [l, rr] = pairOf(u, v);
        const res = await c.query<{ id: string }>(
          `insert into merge_candidates (org_id, left_id, right_id, block_key, score, features, decision)
           values ($1, $2, $3, 'test', $4, '{}'::jsonb, $5) returning id`,
          [a, l, rr, score, decision],
        );
        return res.rows[0]!.id;
      };
      const inside = await cand(y, z, 88); // both sides are x now
      const ruled = await cand(p, q, 90, 'distinct'); // the person's "Different"
      const across = await cand(p, r, 96); // r is q's now: the same two clusters
      const live = await cand(p, x, 85); // an honest open question — must stay pending
      await withPermissiveClaims(c);

      const report = await runPass(c);
      expect(report.stats.tidy).toEqual({ already_one: 1, spanned_distinct: 1 });
      const d = await c.query<{ id: string; decision: string; decided_by: string | null }>(
        'select id, decision, decided_by from merge_candidates where id = any($1::uuid[])',
        [[inside, ruled, across, live]],
      );
      const byId = Object.fromEntries(d.rows.map((row) => [row.id, row.decision]));
      expect(byId).toEqual({
        [inside]: 'merged',
        [ruled]: 'distinct',
        [across]: 'distinct',
        [live]: 'pending',
      });
      // Nothing was merged by the settling: the >= 95 pair across the ruling stayed apart.
      expect((await mergedInto(c, [p, r]))[p]).toBeNull();
    }));
});

/**
 * A-WR-10 (review 03). Stage 5 retried 40001 only. A 55000 from a reviewer deciding the same
 * pair mid-pass (now also the refusals A-CR-01 added), or a 40P01 deadlock between
 * record_merge and undo_merge, killed the rest of the merge loop after minutes of blocking and
 * scoring — and the run report, emitted after stage 5, was never written. The refusals are
 * injected through stage 5's `mergeOne` seam: a real race cannot be staged on one connection.
 */
const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });

describe('stage 5 survives the refusals a live queue produces (A-WR-10)', () => {
  it('a 55000 mid-pass is counted not_pending and the loop merges the rest', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await seedPair95(c, a, 'riverside stone');
      await seedPair95(c, a, 'harlingen granite');
      const db = deskDb(c);
      await stageBlock(db);
      await stageScore(db);
      let first = true;
      const out = await stageMerge(db, {
        mergeOne: async (t, candidateId) => {
          if (first) {
            first = false;
            throw pgError('55000', 'record_merge: candidate already decided');
          }
          return mergeCandidate(t, candidateId);
        },
      });
      expect(out).toMatchObject({ considered: 2, not_pending: 1, merged: 1 });
    }));

  it('a 40P01 deadlock is retried like a serialization failure', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await seedPair95(c, a);
      const db = deskDb(c);
      await stageBlock(db);
      await stageScore(db);
      let deadlocks = 1;
      const out = await stageMerge(db, {
        mergeOne: async (t, candidateId) => {
          if (deadlocks > 0) {
            deadlocks -= 1;
            throw pgError('40P01', 'deadlock detected');
          }
          return mergeCandidate(t, candidateId);
        },
      });
      expect(out).toMatchObject({ considered: 1, merged: 1, retries: 1 });
    }));

  it('a pass that fails in stage 5 still writes its partial run report, then rethrows', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await seedPair95(c, a);
      await expect(
        runResolvePass(deskDb(c), {
          mergeOne: async () => {
            throw new Error('boom: something no stage expects');
          },
        }),
      ).rejects.toThrow('boom: something no stage expects');
      const ev = await c.query<{ after: Record<string, unknown> }>(
        `select after from events
          where org_id = $1 and entity_type = 'businesses' and action = 'resolve'`,
        [a],
      );
      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0]!.after).toMatchObject({
        failed: { stage: 'merge', error: 'Error: boom: something no stage expects' },
        scored: 1,
      });
    }));
});
