/**
 * Criterion 5 — "a city, county or radius search never returns a Mexican-side result" —
 * proven against a naive RGV bounding box, as a DB test, because the assertion is about what
 * a query returns, not what a transform produces (03-RESEARCH § Criterion 5).
 *
 * Measured basis: the naive bbox (lon −99.30…−97.10, lat 25.80…26.75) holds 98,960 Overture
 * places, of which 41,532 (42.0 %) are `country='MX'`. `region='TX' AND country='US'` admits
 * ZERO of them, including the 3 rows carrying `country='MX' AND region='TX'`.
 *
 * The radius is deliberately 60 km from downtown McAllen — wide enough to swallow Reynosa,
 * 12 km away. A radius that could not reach Mexico would prove nothing, and the second test
 * below proves the fixture's Mexican rows really are inside it.
 *
 * M23 (replace `country==='US' && region==='TX'` with `region==='TX'`) must red this test.
 * The filter it mutates is the production one, `overtureRowToSourceRecord` in
 * src/lib/overture/transform.ts: `seedOvertureFixture` runs every row through it (03-13;
 * executed there against this test and the unit `texas side filter`).
 */
import { describe, expect, it } from 'vitest';
import { actAs, seedTwoOrgs, withRollback } from './_fixtures';
import { NAIVE_RGV_BBOX, OVERTURE_FIXTURE, seedOvertureFixture } from './_ingest-fixtures';

const ORG_A_CLAIMS = { o: { id: 'org_A' }, sub: 'user_danlo', role: 'authenticated' } as const;

/** Downtown McAllen — the radius centre. */
const MCALLEN = { lat: 26.2034, lng: -98.23 } as const;

const MEXICAN_LOCALITIES = [
  'Reynosa',
  'Matamoros',
  'Río Bravo',
  'Rio Bravo',
  'Heroica Matamoros',
  'Ciudad Miguel Alemán',
  'Gustavo Díaz Ordaz',
  'Ciudad Camargo',
  'Camargo',
  'Mier',
  'Guerrero',
  'Municipio de Reynosa',
  'Miguel Alemán',
];

describe('criterion 5: the Texas side', () => {
  it('a naive-RGV-bbox radius search returns no Mexican-side row', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      // ~40 TX/US rows PLUS real Reynosa / Matamoros / Río Bravo rows, every one of them
      // INSIDE the naive bbox — through the Texas-side filter and the shipped write path.
      const { skipped } = await seedOvertureFixture(c, a);
      // The filter SAW Mexican rows and turned them away — not merely "none came out".
      expect(skipped).toBe(OVERTURE_FIXTURE.filter((r) => r.country === 'MX').length);

      const { rows } = await c.query<{ display_name: string; city: string }>(
        `select display_name, city from businesses
          where org_id = $1 and app.distance_m(lat, lng, $2, $3) <= 60000`,
        [a, MCALLEN.lat, MCALLEN.lng],
      );

      // 🔴 POSITIVE CONTROL FIRST. A filter bug that admits nothing passes an "expect zero
      // Mexican rows" assertion perfectly, and the difference between proving criterion 5 and
      // proving that the seed failed is this line.
      expect(rows.length).toBeGreaterThan(20);

      const mexican = rows.filter((r) => MEXICAN_LOCALITIES.includes(r.city));
      expect(mexican).toEqual([]);
    }));

  it('the fixture puts Mexican-side places inside the bbox and inside the radius', () =>
    withRollback(async (c) => {
      const mx = OVERTURE_FIXTURE.filter((r) => r.country === 'MX');
      expect(mx.length).toBeGreaterThanOrEqual(5);
      for (const r of mx) {
        expect(r.lng).toBeGreaterThanOrEqual(NAIVE_RGV_BBOX.lonMin);
        expect(r.lng).toBeLessThanOrEqual(NAIVE_RGV_BBOX.lonMax);
        expect(r.lat).toBeGreaterThanOrEqual(NAIVE_RGV_BBOX.latMin);
        expect(r.lat).toBeLessThanOrEqual(NAIVE_RGV_BBOX.latMax);
        expect(MEXICAN_LOCALITIES).toContain(r.locality);
      }
      // Through the SAME distance function the search uses. The coordinates are bound as ONE
      // array parameter each (node-postgres serialises a JS array to a single array literal),
      // never spread into N placeholders.
      const within = await c.query<{ n: number; pathological: number }>(
        `select count(*)::int as n,
                count(*) filter (where region = 'TX')::int as pathological
           from unnest($1::float8[], $2::float8[], $3::text[]) as t(lat, lng, region)
          where app.distance_m(lat, lng, $4, $5) <= 60000`,
        [mx.map((r) => r.lat), mx.map((r) => r.lng), mx.map((r) => r.region), MCALLEN.lat, MCALLEN.lng],
      );
      // Reynosa ×4, Río Bravo ×2, Gustavo Díaz Ordaz, and the country=MX/region=TX row.
      expect(within.rows[0]!.n).toBeGreaterThanOrEqual(5);
      expect(within.rows[0]!.pathological).toBe(1);
    }));
});
