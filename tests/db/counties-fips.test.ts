/**
 * SRCH-02. The 254-county corpus, read from the LIVE database rather than from the JSON
 * that produced it — the same style as tests/db/schema-audit.test.ts, and for the same
 * reason: a test that re-reads its own fixture proves the fixture is self-consistent and
 * says nothing about what the seed loader actually wrote.
 *
 * Texas's 254 county FIPS codes are the contiguous odd integers 1, 3, 5 … 507, so
 * `county_fips = 2 * comptroller_code - 1` is an exact bijection. It is asserted over ALL
 * 254 rows, and the row count is asserted FIRST: an invariant checked over an empty result
 * set passes, so without the count this whole file would go green against an unseeded
 * database. (That is also why .github/workflows/ci.yml seeds between db:migrate and
 * test:db.)
 *
 * 🔴 Do NOT re-derive the Comptroller code by sorting county names. 15 of the 254 break
 * under every collation — El Paso/Ellis, La Salle/Lamar, and the whole `Mc*` block, which
 * FIPS orders before `Ma*`. Both numbering systems ship as columns; the CHECK is only the
 * guard.
 *
 * Mutation executed against the LIVE database during plan 02-06, reverted:
 *   `alter table counties drop constraint counties_fips_identity`
 *     -> 'counties_fips_identity refuses a row that breaks the bijection' red, alone.
 */
import { describe, expect, it } from 'vitest';
import { actAsOwner, seedTwoOrgs, withRollback } from './_fixtures';

const TEXAS_COUNTIES = 254;

/** Comptroller code, FIPS and the measured all-NAICS outlet total, from 02-RESEARCH.md
 *  § Seed Data (queried live 2026-09-22 and matching DATA-SOURCES.md to the row). */
const RGV = [
  { fips: '48061', comptroller: 31, name: 'Cameron', outlets: 12313 },
  { fips: '48215', comptroller: 108, name: 'Hidalgo', outlets: 21062 },
  { fips: '48427', comptroller: 214, name: 'Starr', outlets: 1226 },
  { fips: '48489', comptroller: 245, name: 'Willacy', outlets: 327 },
] as const;

type CountyRow = {
  fips: string;
  county_fips: number;
  comptroller_code: number;
  name: string;
  is_rgv: boolean;
  outlet_count: number;
};

const ALL_COUNTIES = `
  select fips, county_fips, comptroller_code, name, is_rgv, outlet_count
    from counties
   where org_id is null
   order by county_fips`;

describe('the 254-county corpus', () => {
  it('254 counties: the FIPS and Comptroller identity holds for every row', () =>
    withRollback(async (c) => {
      const { rows } = await c.query<CountyRow>(ALL_COUNTIES);
      // FIRST. A predicate that matches nothing is not a predicate that holds.
      expect(rows).toHaveLength(TEXAS_COUNTIES);

      const broken = rows.filter((r) => r.county_fips !== 2 * r.comptroller_code - 1);
      expect(broken).toEqual([]);
      // The bijection is onto as well as one-to-one: 254 DISTINCT Comptroller codes
      // covering exactly 1..254. A table with Hidalgo's code repeated on two rows would
      // satisfy the per-row identity above and still map permits to the wrong county.
      const codes = rows.map((r) => r.comptroller_code).sort((x, y) => x - y);
      expect(new Set(codes).size).toBe(TEXAS_COUNTIES);
      expect(codes[0]).toBe(1);
      expect(codes[TEXAS_COUNTIES - 1]).toBe(TEXAS_COUNTIES);
    }));

  it('254 counties: the four RGV counties carry their measured outlet totals', () =>
    withRollback(async (c) => {
      const { rows } = await c.query<CountyRow>(ALL_COUNTIES);
      expect(rows).toHaveLength(TEXAS_COUNTIES);
      const byFips = new Map(rows.map((r) => [r.fips, r]));

      for (const county of RGV) {
        const row = byFips.get(county.fips);
        expect(row, `county ${county.fips} (${county.name}) is missing`).toBeDefined();
        expect(row).toMatchObject({
          name: county.name,
          comptroller_code: county.comptroller,
          outlet_count: county.outlets,
          is_rgv: true,
        });
      }
      // Exactly four, in both directions. `is_rgv` drives the RGV geo preset and the
      // launch scope; a fifth county silently flagged would widen every RGV estimate.
      expect(rows.filter((r) => r.is_rgv).map((r) => r.fips)).toEqual(RGV.map((r) => r.fips));
    }));

  it('counties_fips_identity refuses a row that breaks the bijection', () =>
    withRollback(async (c) => {
      await seedTwoOrgs(c);
      // The OWNER: only the seed loader writes built-in counties, so the mistyped row this
      // CHECK exists to refuse is one the loader would write.
      await actAsOwner(c);

      // Positive control FIRST, in the same transaction — a refusal aborts the transaction
      // and everything after it reports 25P02 instead of its own reason. 999 = 2*500 - 1,
      // so this row satisfies the identity and is accepted.
      const ok = await c.query(
        "insert into counties (org_id, fips, county_fips, comptroller_code, name) values (null, '99999', 999, 500, 'Control')",
      );
      expect(ok.rowCount).toBe(1);

      // 100 != 2*100 - 1. This is the transposition the CHECK exists for: a hand-edited
      // seed row carrying the FIPS number in the Comptroller column maps every permit in
      // that county to a different county, silently, forever.
      const attempt = c.query(
        "insert into counties (org_id, fips, county_fips, comptroller_code, name) values (null, '99998', 100, 100, 'Broken')",
      );
      await expect(attempt).rejects.toMatchObject({ code: '23514' });
      await expect(attempt).rejects.toThrow(/counties_fips_identity/);
    }));
});
