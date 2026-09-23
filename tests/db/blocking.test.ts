/**
 * DEDUP-01 candidate generation against the live local database (src/lib/resolve/block.ts).
 *
 * 🔴 DESK-SCRIPT CONNECTION SHAPE. Like tests/db/ingest-idempotency.test.ts, every test here is
 * the owner connection with `setEtlActor` + `resolveEtlOrg` and NO `actAs`: the resolve pass is
 * a desk script (03-14), and `actAs` would hand the statements a Clerk claim and a role the pass
 * never has.
 *
 * 🔴 THE THRESHOLD IS SET IN EVERY TRANSACTION THAT USES THE SIMILARITY OPERATOR. `runBlock`
 * issues `set local pg_trgm.similarity_threshold` itself and reads it back; the tests that
 * reach the operator directly (the EXPLAIN) set it explicitly too. `fileParallelism:false`
 * makes a leaked threshold deterministic, and a deterministic leak is invisible.
 *
 * Tens of rows, all inside `withRollback`; nothing is committed.
 */
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { resolveEtlOrg, setEtlActor } from '@/lib/ingest/etl-actor';
import {
  addressBlockSql,
  MAX_BLOCK_PAIRS,
  phoneBlockSql,
  runBlock,
  runDistanceGate,
  trigramLateralSql,
} from '@/lib/resolve/block';
import { BLOCK_SIMILARITY_THRESHOLD } from '@/lib/resolve/score';
import { SQL_FRESH_EXTERNAL_KEY, seedTwoOrgs, withRollback } from './_fixtures';
import { asEtlExecutor } from './_ingest-fixtures';

interface Biz {
  name: string;
  phone?: string | null;
  blockable?: boolean;
  postal?: string | null;
  streetNum?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/** One business, owner-inserted. `name` is written straight into `name_norm` (already normal). */
async function biz(c: Client, orgId: string, b: Biz): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into businesses (org_id, external_key, display_name, name_norm, phone_e164,
                             phone_blockable, postal, street_num, lat, lng)
     values ($1, ${SQL_FRESH_EXTERNAL_KEY}, $2, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      orgId,
      b.name,
      b.phone ?? null,
      b.blockable ?? false,
      b.postal ?? null,
      b.streetNum ?? null,
      b.lat ?? null,
      b.lng ?? null,
    ],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error('biz: insert returned no row');
  return id;
}

/** The desk-script preamble for the resolve pass: the actor GUC, then the org claim. */
async function asResolvePass(c: Client): Promise<{ a: string; b: string }> {
  const orgs = await seedTwoOrgs(c);
  const x = asEtlExecutor(c);
  await setEtlActor(x, 'resolve');
  expect(await resolveEtlOrg(x, 'org_A')).toBe(orgs.a);
  return orgs;
}

interface Cand {
  left_id: string;
  right_id: string;
  block_key: string;
  block_size: number | null;
  decision: string;
  features: Record<string, unknown>;
}

const candidates = async (c: Client, orgId: string): Promise<Cand[]> =>
  (
    await c.query<Cand>(
      `select left_id, right_id, block_key, block_size, decision, features
         from merge_candidates where org_id = $1 order by block_key, left_id`,
      [orgId],
    )
  ).rows;

const pairOf = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

describe('candidate blocking', () => {
  it('the lateral blocker uses the trigram index', async () => {
    await withRollback(async (c) => {
      const { a } = await asResolvePass(c);
      const names = [
        'taqueria jalisco', 'taqueria jalisco 2', 'taqueria jalisco express', 'taqueria el jalisco',
        'garcia ac heating', 'garcia ac and heating', 'garcias air conditioning',
        'la estrella bakery', 'estrella bakery', 'panaderia la estrella',
        'valley auto glass', 'valley glass auto', 'rio plumbing', 'rio grande plumbing',
      ];
      const ids = new Map<string, string>();
      for (const [i, name] of names.entries()) {
        ids.set(name, await biz(c, a, { name, postal: '78501', streetNum: String(100 + i) }));
      }

      // 1. THE STATEMENT, EXECUTED, on the named rows: it writes the trigram neighbours.
      const r = await runBlock(asEtlExecutor(c), trigramLateralSql(a));
      expect(r.skippedBlocks).toEqual([]);
      expect(r.inserted).toBeGreaterThan(0);
      const written = await candidates(c, a);
      expect(written.length).toBe(r.inserted);
      expect(written.every((w) => w.block_key === 'trgm_zip' && w.block_size === null)).toBe(true);
      const [jl, jr] = pairOf(ids.get('taqueria jalisco')!, ids.get('taqueria jalisco 2')!);
      expect(written.some((w) => w.left_id === jl && w.right_id === jr)).toBe(true);

      // 2. THE PLAN, at the scale the desk pass runs at.
      //
      // 🔴 WHY THIS HALF IS NOT "TENS OF ROWS". Measured while writing this test (PostgreSQL 18,
      // 2026-09-22), the planner's choice for the lateral probe depends on the TABLE, not on the
      // statement:
      //    14 rows ............................ Index Scan on businesses_addr_idx, the similarity
      //                                          operator a post-index Filter
      //    1,500 rows, one ZIP ................ Seq Scan, operator a Filter — 13.4 s for 1,514 probes
      //    1,500 rows, enable_seqscan off ..... businesses_org_idx, operator a Filter — 22 s
      //    20,000 rows / 15 ZIPs .............. addr_idx + Filter on one run, the GIN on another
      //    30,000 rows / 20 ZIPs (×3) ......... BitmapAnd(addr_idx, businesses_name_trgm) —
      //                                          `Index Cond: (name_norm % c.name_norm)`
      //    45,000 / 60,000 / 90,000 rows ...... the same BitmapAnd, every run
      // So at fixture scale the post-index-Filter plan is the planner being RIGHT (scanning
      // fourteen rows is cheaper than any index), and neither the plan's "sequential scan"
      // fallback nor `enable_seqscan = off` makes the GIN appear. A plan assertion is only
      // meaningful at production density: ~1,500 businesses per ZIP (92k over ~60 ZIPs). This
      // builds 30,000 rows over 20 ZIPs — the smallest measured size with a stable plan, and one
      // ANALYZE reads WHOLE (its default sample is 30,000 rows), so the statistics are
      // deterministic. EXPLAIN without ANALYZE: executing 30,000 GIN probes is the ~100 s desk
      // pass, not a unit of the suite. One INSERT, rolled back with everything else.
      // Keys prefixed `Z`: SQL_FRESH_EXTERNAL_KEY draws [0-9A-F] only, so they never collide.
      const SPINE_ROWS = 30_000;
      const ZIPS = 20;
      await c.query(
        `insert into businesses (org_id, external_key, display_name, name_norm, postal, street_num)
         select $1, 'SL-Z' || lpad(upper(to_hex(g)), 5, '0'), 'filler ' || g,
                substr(md5(g::text), 1, 7) || ' ' || substr(md5((g * 7)::text), 1, 9),
                (78500 + (g % $3::int))::text, (1000 + g)::text
           from generate_series(1, $2::int) g`,
        [a, SPINE_ROWS, ZIPS],
      );
      await c.query('analyze businesses');

      // Explicit, in this transaction, from the committed constant (the `%` reads this GUC).
      await c.query(`set local pg_trgm.similarity_threshold = ${BLOCK_SIMILARITY_THRESHOLD}`);
      const b3 = trigramLateralSql(a);
      const plan = (await c.query<{ 'QUERY PLAN': string }>(`explain ${b3.text}`, b3.values)).rows
        .map((row) => row['QUERY PLAN'])
        .join('\n');

      expect(plan, plan).toContain('Bitmap Index Scan on businesses_name_trgm');
      // The similarity operator is an INDEX condition — never a post-index Filter.
      expect(plan, plan).toMatch(/Index Cond: \((\w+\.)?name_norm % \w+\.name_norm\)/);
      for (const line of plan.split('\n').filter((l) => l.includes('Filter:'))) {
        expect(line, plan).not.toMatch(/name_norm % /);
      }
    });
  }, 120_000);

  it('a toll-free phone forms no block', async () => {
    await withRollback(async (c) => {
      const { a } = await asResolvePass(c);
      const x = asEtlExecutor(c);
      // The normalizer's verdict: +1-800 is NOT blockable, a 956 number is.
      const free1 = await biz(c, a, { name: 'national tire chain', phone: '+18004879643', blockable: false });
      const free2 = await biz(c, a, { name: 'mesquite bbq', phone: '+18004879643', blockable: false });
      const loc1 = await biz(c, a, { name: 'taller garcia', phone: '+19566822400', blockable: true });
      const loc2 = await biz(c, a, { name: 'garcia auto repair', phone: '+19566822400', blockable: true });

      const r = await runBlock(x, phoneBlockSql(a));
      expect(r).toEqual({ shape: 'phone', inserted: 1, skippedBlocks: [] });

      const written = await candidates(c, a);
      expect(written).toHaveLength(1);
      const [l, rr] = pairOf(loc1, loc2);
      expect(written[0]).toMatchObject({
        left_id: l,
        right_id: rr,
        block_key: 'phone:+19566822400',
        block_size: 1,
        decision: 'pending',
      });
      const ids = new Set(written.flatMap((w) => [w.left_id, w.right_id]));
      expect(ids.has(free1)).toBe(false);
      expect(ids.has(free2)).toBe(false);
    });
  });

  it('a block over the cap is recorded, not truncated', async () => {
    await withRollback(async (c) => {
      const { a } = await asResolvePass(c);
      const x = asEtlExecutor(c);
      // A shopping centre: 33 live tenants at one (postal, street_num) → 33·32/2 = 528 pairs.
      // The names are deliberately SIMILAR (every pair passes B2′'s 0.3 gate), so the only thing
      // that can keep these pairs out is the cap — not the similarity gate.
      const MALL = 33;
      const mallIds: string[] = [];
      for (let i = 0; i < MALL; i++) {
        mallIds.push(await biz(c, a, { name: `plaza del valle suite ${i + 1}`, postal: '78503', streetNum: '2200' }));
      }
      // A small, legitimate block at another address — written, so the statement demonstrably ran.
      const s1 = await biz(c, a, { name: 'donna hardware', postal: '78537', streetNum: '301' });
      const s2 = await biz(c, a, { name: 'donna hardware store', postal: '78537', streetNum: '301' });

      const r = await runBlock(x, addressBlockSql(a));
      const mallPairs = (MALL * (MALL - 1)) / 2;
      expect(mallPairs).toBeGreaterThan(MAX_BLOCK_PAIRS);
      expect(r.skippedBlocks).toEqual([{ block_key: 'addr:78503:2200', size: mallPairs }]);
      expect(r.inserted).toBe(1);

      const written = await candidates(c, a);
      expect(written.filter((w) => w.block_key === 'addr:78503:2200')).toHaveLength(0);
      const mall = new Set(mallIds);
      expect(written.some((w) => mall.has(w.left_id) || mall.has(w.right_id))).toBe(false);
      const [l, rr] = pairOf(s1, s2);
      expect(written).toEqual([
        expect.objectContaining({ left_id: l, right_id: rr, block_key: 'addr:78537:301', block_size: 1 }),
      ]);

      // B1 carries the same cap: 33 places on one blockable number (the real worst is 32 → 496
      // pairs, which fits) is refused whole, named, and writes nothing.
      for (let i = 0; i < MALL; i++) {
        await biz(c, a, { name: `answering service client ${i + 1}`, phone: '+19566300000', blockable: true });
      }
      const p = await runBlock(x, phoneBlockSql(a));
      expect(p).toEqual({
        shape: 'phone',
        inserted: 0,
        skippedBlocks: [{ block_key: 'phone:+19566300000', size: mallPairs }],
      });
      expect((await candidates(c, a)).filter((w) => w.block_key.startsWith('phone:'))).toHaveLength(0);
    });
  });

  it('never merges across 25 km', async () => {
    await withRollback(async (c) => {
      const { a } = await asResolvePass(c);
      const x = asEtlExecutor(c);
      // Brownsville ↔ Rio Grande City: 03-01's app.distance_m coordinates, 142,343 m ± 100.
      // Identical name and phone, so B1 blocks them — and the gate must still call them distinct.
      const bro = await biz(c, a, {
        name: 'el pollo loco', phone: '+19565550142', blockable: true, lat: 25.9017, lng: -97.4975,
      });
      const rgc = await biz(c, a, {
        name: 'el pollo loco', phone: '+19565550142', blockable: true, lat: 26.3795, lng: -98.8203,
      });
      // Two controls that must stay pending: ~100 m apart, and one side unlocated.
      const near1 = await biz(c, a, {
        name: 'taller garcia', phone: '+19566822401', blockable: true, lat: 26.2034, lng: -98.23,
      });
      const near2 = await biz(c, a, {
        name: 'taller garcia', phone: '+19566822401', blockable: true, lat: 26.2043, lng: -98.23,
      });
      const unloc1 = await biz(c, a, {
        name: 'rio plumbing', phone: '+19566822402', blockable: true, lat: 26.2034, lng: -98.23,
      });
      const unloc2 = await biz(c, a, { name: 'rio plumbing', phone: '+19566822402', blockable: true });

      expect((await runBlock(x, phoneBlockSql(a))).inserted).toBe(3);
      expect(await runDistanceGate(x, a)).toBe(1);

      const byPair = new Map((await candidates(c, a)).map((w) => [`${w.left_id}|${w.right_id}`, w]));
      const far = byPair.get(pairOf(bro, rgc).join('|'));
      expect(far?.decision).toBe('distinct');
      expect(far?.features.rule).toBe('over_25km');
      expect(Math.abs(Number(far?.features.distanceM) - 142_343)).toBeLessThanOrEqual(100);

      expect(byPair.get(pairOf(near1, near2).join('|'))?.decision).toBe('pending');
      expect(byPair.get(pairOf(near1, near2).join('|'))?.features).toEqual({});
      expect(byPair.get(pairOf(unloc1, unloc2).join('|'))?.decision).toBe('pending');

      // Idempotent: a second pass has nothing pending over 25 km left to gate.
      expect(await runDistanceGate(x, a)).toBe(0);
    });
  });

  it('candidates are org-scoped', async () => {
    await withRollback(async (c) => {
      const { a, b } = await asResolvePass(c);
      const x = asEtlExecutor(c);
      // The same business in both orgs: same name, phone and address. A blocker that joined
      // across orgs would pair every A row with its B twin.
      const spec: Biz = {
        name: 'la estrella bakery', phone: '+19563830000', blockable: true, postal: '78539', streetNum: '201',
      };
      const aIds = [await biz(c, a, spec), await biz(c, a, { ...spec, name: 'la estrella bakery 2' })];
      const bIds = [await biz(c, b, spec), await biz(c, b, { ...spec, name: 'la estrella bakery 2' })];

      await runBlock(x, phoneBlockSql(a));
      await runBlock(x, addressBlockSql(a));
      await runBlock(x, trigramLateralSql(a));

      const written = await candidates(c, a);
      // Non-vacuous: org A's own pair WAS found.
      const [l, r] = pairOf(aIds[0]!, aIds[1]!);
      expect(written.some((w) => w.left_id === l && w.right_id === r)).toBe(true);

      const bSet = new Set(bIds);
      const all = (
        await c.query<{ org_id: string; left_id: string; right_id: string }>(
          'select org_id, left_id, right_id from merge_candidates where left_id = any($1::uuid[]) or right_id = any($1::uuid[]) or org_id = $2',
          [[...aIds, ...bIds], b],
        )
      ).rows;
      expect(all.length).toBeGreaterThan(0);
      for (const row of all) {
        expect(row.org_id).toBe(a);
        expect(bSet.has(row.left_id)).toBe(false);
        expect(bSet.has(row.right_id)).toBe(false);
      }
    });
  });
});
