/**
 * DEDUP-01 — the grep gate over the GENERATED blocking SQL (src/lib/resolve/block.ts).
 *
 * The shape this exists to keep out: an inner join whose join predicate carries the trigram
 * similarity operator. Measured at 269,647 ms — the planner drives from the ZIP btree and
 * applies the operator as a post-index Filter, 85 million similarity() evaluations. The
 * `cross join lateral … order by <-> … limit 5` form makes `businesses_name_trgm` the driver
 * and finishes in 101,807 ms. tests/db/blocking.test.ts proves the plan on the live database;
 * this proves the TEXT, with no database, on every unit run.
 *
 * Hygiene: the forbidden pattern is built from a constructed string, so this file is never its
 * own violation. It deliberately does NOT re-check the accent-folding call: that gate is
 * tests/unit/sql-never-normalizes.test.ts alone, so mutation M24 reds exactly one test.
 */
import { describe, expect, it } from 'vitest';
import {
  addressBlockSql,
  distanceGateSql,
  MAX_BLOCK_PAIRS,
  phoneBlockSql,
  similarityThresholdSql,
  trigramLateralSql,
} from '@/lib/resolve/block';
import { BLOCK_SIMILARITY_THRESHOLD } from '@/lib/resolve/score';

const ORG = '00000000-0000-4000-8000-000000000001';

/** `on` … the similarity operator, before the statement ends: the 269-second join shape. */
const JOIN_ON_SIMILARITY = new RegExp('\\bon\\b[^;]*' + '%', 'i');

describe('candidate blocking SQL', () => {
  it('lateral blocker', () => {
    const b3 = trigramLateralSql(ORG);

    // The driver shape.
    expect(b3.text).toContain('cross join lateral');
    expect(b3.text).toMatch(/order by\s+o\.name_norm\s*<->\s*c\.name_norm/i);
    expect(b3.text).toMatch(/\blimit 5\b/i);
    // The similarity operator is present — inside the lateral, never in a join predicate.
    expect(b3.text).toContain('%');
    expect(b3.text).not.toMatch(JOIN_ON_SIMILARITY);
    // The gate itself can see the forbidden form (two-sided: a regex that matches nothing is green).
    expect('select 1 from ov join cm on ov.zip5 = cm.zip5 and ov.name_norm ' + '%' + ' cm.name_norm').toMatch(
      JOIN_ON_SIMILARITY,
    );

    // Org-scoped and bound, both sides (T-3-09, T-3-03).
    expect(b3.text).toContain('o.org_id = c.org_id');
    expect(b3.values).toEqual([ORG]);
    expect(b3.text).not.toContain(ORG);
    // A merged-away row is not a candidate, on either side.
    expect(b3.text).toContain('c.merged_into_id is null');
    expect(b3.text).toContain('o.merged_into_id is null');
    // least/greatest satisfies mc_pair_ordered.
    expect(b3.text).toContain('least(c.id, k.id)');
    expect(b3.text).toContain('greatest(c.id, k.id)');

    // Every shape sets the threshold from the committed constant (T-3-04).
    for (const s of [phoneBlockSql(ORG), addressBlockSql(ORG), b3]) {
      expect(s.setup).toBe(`set local pg_trgm.similarity_threshold = ${BLOCK_SIMILARITY_THRESHOLD}`);
      expect(s.text).toContain('on conflict (org_id, left_id, right_id) do nothing');
    }
    expect(() => similarityThresholdSql(Number.NaN)).toThrow();
    expect(() => similarityThresholdSql(0)).toThrow();

    // B1 keys on the normalizer's verdict, not a re-derived NPA list.
    const b1 = phoneBlockSql(ORG);
    expect(b1.text).toContain('phone_blockable = true');
    expect(b1.values).toEqual([ORG, MAX_BLOCK_PAIRS]);

    // B2′ is never ungated.
    const b2 = addressBlockSql(ORG);
    expect(b2.text).toMatch(/similarity\(x\.name_norm, y\.name_norm\) >= \$3::real/);
    expect(b2.values).toEqual([ORG, MAX_BLOCK_PAIRS, 0.3]);

    expect(MAX_BLOCK_PAIRS).toBe(500);

    // The D-10 gate uses the one distance function and the 25 km constant.
    const gate = distanceGateSql(ORG);
    expect(gate.text).toContain('app.distance_m(a.lat, a.lng, b.lat, b.lng)');
    expect(gate.text).toContain("'over_25km'");
    expect(gate.values).toEqual([ORG, 25_000]);

    // No shape runs without an org.
    expect(() => trigramLateralSql('')).toThrow();
    expect(() => phoneBlockSql('')).toThrow();
    expect(() => addressBlockSql('')).toThrow();
    expect(() => distanceGateSql('')).toThrow();
  });
});
