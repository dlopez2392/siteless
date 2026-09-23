/**
 * Migration 0021: the two contrib extensions the whole of Phase 3 rests on, and the
 * pure-SQL distance function that replaces PostGIS.
 *
 * Why the versions are NAMED rather than counted: dev (PostgreSQL 18.6), CI (`postgres:18`)
 * and production Supabase (PostgreSQL 17.6) must end byte-identical inside the dedupe
 * predicates — that drift is exactly what Phase 1 D-05a exists to prevent, and it is the
 * reason PostGIS was rejected (3.6.2 / 3.6.x / 3.3.7 across the three). `pg_trgm 1.6` and
 * `unaccent 1.1` were both read from `pg_available_extensions` on local 18.6 and on
 * production 17.6. A count of two would stay green through a version drift.
 *
 * Why three distance pairs: longitude is negative and latitude positive in the RGV, so a
 * lat/lon swap in the function body or at a call site moves every distance by hundreds of
 * kilometres at once — the one defect a `toBeDefined` or a `> 0` sails past. The identical
 * point is pinned with an exact `toBe(0)`: a floating-point residue there would let a
 * "distance < N" rule drift at the boundary.
 *
 * Coordinates: Brownsville 25.9017, -97.4975; Rio Grande City 26.3795, -98.8203; McAllen
 * 26.2034, -98.2300; Edinburg 26.3017, -98.1633. The function body is the contract, the
 * town coordinates are not. Measured on local PostgreSQL 18.6: 142,330 m and 12,795 m
 * (03-RESEARCH quotes 142,343 m for the first pair; the ±100 m tolerance absorbs the
 * difference in the research coordinates).
 *
 * 🔴 `pg_trgm.similarity_threshold` is a GUC and vitest.db.config.ts runs
 * `fileParallelism:false` with `isolate:false`, which makes a leaked threshold
 * DETERMINISTIC and therefore invisible. Every transaction that uses `%` sets it with
 * `set local` first. withRollback's transaction is what scopes it.
 *
 * Mutation 1: `drop extension unaccent` — 'extensions are installed at the pinned versions'
 * goes red, and only that one.
 * Mutation 2: `create or replace function app.distance_m` with lat and lon swapped in the
 * body — 'app.distance_m matches the measured RGV distances' goes red, and only that one.
 * Mutation 3: `drop extension pg_trgm` — the version test AND
 * 'pg_trgm similarity is available to the blocker' go red (the blocker genuinely depends on
 * the extension existing; the version test is the one that names which).
 */
import { describe, expect, it } from 'vitest';
import { withRollback } from './_fixtures';

const DISTANCE =
  'select app.distance_m($1::double precision, $2::double precision, $3::double precision, $4::double precision) as d';

describe('0021 extensions and app.distance_m', () => {
  it('extensions are installed at the pinned versions', () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ extname: string; extversion: string }>(
        "select extname, extversion from pg_extension where extname in ('pg_trgm','unaccent') order by 1",
      );
      expect(rows).toEqual([
        { extname: 'pg_trgm', extversion: '1.6' },
        { extname: 'unaccent', extversion: '1.1' },
      ]);
    }));

  it('app.distance_m matches the measured RGV distances', () =>
    withRollback(async (c) => {
      const distance = async (
        lat1: number,
        lon1: number,
        lat2: number,
        lon2: number,
      ): Promise<number> => {
        const { rows } = await c.query<{ d: number }>(DISTANCE, [lat1, lon1, lat2, lon2]);
        const d = rows[0]?.d;
        if (typeof d !== 'number') throw new Error('app.distance_m returned ' + String(d));
        return d;
      };

      // Brownsville <-> Rio Grande City: the long axis of the Valley.
      const broRgc = await distance(25.9017, -97.4975, 26.3795, -98.8203);
      expect(Math.abs(broRgc - 142343)).toBeLessThanOrEqual(100);

      // McAllen <-> Edinburg: the scale a 25 km dedupe hard rule actually operates at.
      const mcaEdi = await distance(26.2034, -98.23, 26.3017, -98.1633);
      expect(Math.abs(mcaEdi - 12795)).toBeLessThanOrEqual(100);

      // Identical point: exactly zero, not "small".
      const same = await distance(26.2034, -98.23, 26.2034, -98.23);
      expect(same).toBe(0);
    }));

  it('pg_trgm similarity is available to the blocker', () =>
    withRollback(async (c) => {
      // set local: dies with withRollback's transaction, so no later file inherits it.
      await c.query('set local pg_trgm.similarity_threshold = 0.45');

      const sim = await c.query<{ ok: boolean }>(
        "select similarity('zorba','zorba, inc.') > 0 as ok",
      );
      expect(sim.rows[0]?.ok).toBe(true);

      const match = await c.query<{ m: boolean }>("select 'zorba' % 'zorba inc' as m");
      expect(match.rows[0]?.m).toBe(true);
    }));
});
