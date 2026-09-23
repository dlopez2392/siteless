/**
 * DATA-02 / D-02. The committed Overture `basic_category` -> cluster mapping, pinned as a
 * drift alarm the way tests/unit/outlet-counts.test.ts pins the outlet counts: on the RIGHT
 * values, with the numbers asserted rather than a feeling.
 *
 * WHY THE COVERAGE FLOOR IS 55 % AND NOT THE PLAN'S 70 %. Measured on `2026-08-19.0`
 * (56,944 Texas-side RGV rows), the top 60 categories do cover ~80 % of the slice, but ~42 %
 * of the slice is finance, real estate, worship, schools, government and parks, which belong
 * to NO cluster. Mapping every category that clearly belongs to one cluster covers 57.8 %.
 * The only way to 70 % is to map `financial_service` or `christian_place_of_worship` into a
 * trade cluster, which D-02 forbids: an unmapped row stays in the spine and is REPORTED; a
 * mis-mapped one enters the lead funnel as a wrong lead. So the honest number is the floor,
 * and a second assertion proves the head of the distribution was DECIDED (mapped, or judged
 * unmapped with a reason) rather than skipped.
 */
import { describe, expect, it } from 'vitest';
import clustersJson from '@/seed/data/clusters.json';
import overtureCategoriesJson from '@/seed/data/overture-categories.json';
import {
  CLUSTER_KEYS,
  overtureCategoryMeta,
  overtureCategorySeeds,
  type ClustersFile,
  type OvertureCategoriesFile,
} from '@/seed/types';

// The assignment IS the compile-time structural check (src/seed/types.ts).
const clusters: ClustersFile = clustersJson;
const file: OvertureCategoriesFile = overtureCategoriesJson;

const seeds = overtureCategorySeeds(file);
const meta = overtureCategoryMeta(file);

/** Stated here independently of the file it checks. */
const MEASURED_RELEASE = '2026-08-19.0';
const MEASURED_TOTAL_ROWS = 56944;
const MEASURED_NULL_ROWS = 1223;
const MEASURED_DISTINCT = 244;
const MIN_MAPPED_ENTRIES = 60;
const MIN_MAPPED_SHARE = 0.55;
const MIN_DECIDED_SHARE = 0.9;

const sum = (xs: Array<{ rows: number }>): number => xs.reduce((s, x) => s + x.rows, 0);

describe('overture category map', () => {
  it('overture category map covers the top categories', () => {
    expect(meta.release).toBe(MEASURED_RELEASE);
    expect(meta.totalRows).toBe(MEASURED_TOTAL_ROWS);
    expect(meta.nullRows).toBe(MEASURED_NULL_ROWS);
    expect(meta.distinctCategories).toBe(MEASURED_DISTINCT);

    expect(seeds.length).toBeGreaterThanOrEqual(MIN_MAPPED_ENTRIES);
    const mappedRows = sum(seeds);
    // 32,890 / 56,944 = 57.8 % measured. See the header for why the floor is not 70 %.
    expect(mappedRows / meta.totalRows).toBeGreaterThanOrEqual(MIN_MAPPED_SHARE);

    // Every category at or above `decidedAboveRows` is either mapped or judged unmapped with
    // a reason — 94.8 % of all rows including NULL. A dropped mapping that was not moved to
    // decidedUnmapped breaks the bookkeeping test below; this one fails if the head of the
    // distribution simply stops being looked at.
    const decidedRows = mappedRows + sum(meta.decidedUnmapped) + meta.nullRows;
    expect(decidedRows / meta.totalRows).toBeGreaterThanOrEqual(MIN_DECIDED_SHARE);

    // The biggest category is mapped, and to the cluster its NAICS (7225) puts it in.
    expect(seeds.find((s) => s.basic_category === 'restaurant')?.cluster_key).toBe(
      'food_hospitality',
    );
  });

  it('overture category map uses only seeded cluster keys', () => {
    const seeded = new Set(clusters.clusters.map((c) => c.key));
    // The seed file and the code constant agree, so checking against either is checking both.
    expect([...seeded].sort()).toEqual([...CLUSTER_KEYS].sort());
    const strays = seeds.filter((s) => !seeded.has(s.cluster_key)).map((s) => s.cluster_key);
    expect(strays).toEqual([]);
    // Every cluster is reachable from Overture; a cluster no category maps to would make
    // every Overture row in that trade invisible to the funnel.
    expect(new Set(seeds.map((s) => s.cluster_key))).toEqual(seeded);
  });

  it('overture category map has no duplicate category', () => {
    const cats = seeds.map((s) => s.basic_category);
    expect(new Set(cats).size).toBe(cats.length);
    // Mapped and decided-unmapped are disjoint: one category, one verdict.
    const decided = new Set(meta.decidedUnmapped.map((d) => d.basic_category));
    expect(cats.filter((c) => decided.has(c))).toEqual([]);
    // A NULL basic_category is not a category and must never be mapped.
    expect(cats.every((c) => typeof c === 'string' && c.length > 0)).toBe(true);
  });

  it('overture category map closes its own arithmetic', () => {
    expect(meta.mappedCategories).toBe(seeds.length);
    expect(meta.mappedRows).toBe(sum(seeds));
    expect(
      meta.mappedRows + sum(meta.decidedUnmapped) + meta.undecidedTail.rows + meta.nullRows,
    ).toBe(meta.totalRows);
    expect(seeds.length + meta.decidedUnmapped.length + meta.undecidedTail.categories).toBe(
      meta.distinctCategories,
    );
    // Everything in the undecided tail is below the threshold by definition, so every decided
    // entry must be at or above it — otherwise the threshold claim in _meta is false.
    expect(meta.decidedUnmapped.every((d) => d.rows >= meta.decidedAboveRows)).toBe(true);
    expect(meta.decidedUnmapped.every((d) => d.reason.length > 0)).toBe(true);
  });

  it('overture category map confirms the merge fixture auto_retail assumption', () => {
    // tests/unit/fixtures/merge-pairs.json ASSUMES the Overture side of P01 and P04 (and both
    // sides of P03) lands in auto_retail. Read live from 2026-08-19.0 during 03-08:
    //   P01 Zorba, 516 S Main St, McAllen            -> fashion_and_apparel_store
    //   P04 Firestone Complete Auto Care, 118 N 12th -> automotive_service
    //   P03 La Colmena Meat Martket & Food Store     -> food_and_beverage_store
    const cluster = (c: string) => seeds.find((s) => s.basic_category === c)?.cluster_key;
    expect(cluster('fashion_and_apparel_store')).toBe('auto_retail');
    expect(cluster('automotive_service')).toBe('auto_retail');
    expect(cluster('food_and_beverage_store')).toBe('auto_retail');
  });
});
