/**
 * SRCH-01 / SRCH-03 / T-2-11 / T-2-12. What makes a version a version.
 *
 * "A past run still points at the version that produced it" is not a rule anybody
 * remembers to follow — it is an FK with ON DELETE NO ACTION, a revoked grant, and a
 * column left out of a column grant. This file watches all three.
 *
 * 🔴 IMMUTABILITY IS A GRANT, NOT A POLICY, AND THE TWO ARE TOLD APART BY THE MESSAGE.
 * With only an RLS filter an UPDATE against an invisible row is silently filtered to zero
 * rows and reads to the caller as "nothing happened". With UPDATE revoked it is
 * `42501 permission denied for table search_versions` — impossible to mistake for an empty
 * result, and DIFFERENT WORDING from an RLS refusal's "new row violates row-level security
 * policy" (which tests/db/reference-rows.test.ts pins). Both share SQLSTATE 42501, so only
 * the message discriminates: pinning the code alone would let a policy silently replace
 * the grant and keep this file green.
 *
 * Each refusal below rests on a DIFFERENT invariant — the UPDATE grant, the DELETE grant,
 * the unique key, the runs column grant, the geo_kind CHECK — so one mutation reds exactly
 * one test. Two tests sharing a refusal is how a mutation check stops telling you which
 * guard you broke.
 *
 * Mutations executed against the LIVE database during plan 02-06, each reverted and each
 * verified back from information_schema rather than from the fact that a script ran:
 *   M12 `grant update on public.search_versions to authenticated`
 *     -> 'versions immutable: UPDATE as authenticated is refused' red, alone.
 *   `grant update (search_version_id) on public.runs to authenticated`
 *     -> 'a run cannot be re-pointed at a different version' red, alone.
 */
import { describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { actAs, actAsOwner, seedTwoOrgs, withRollback } from './_fixtures';

const ORG_A_CLAIMS = { o: { id: 'org_A' }, sub: 'user_danlo', role: 'authenticated' } as const;
const ORG_B_CLAIMS = { o: { id: 'org_B' }, sub: 'user_bravo', role: 'authenticated' } as const;

const INSERT_VERSION = `
  insert into search_versions (org_id, search_id, version, cluster_ids, geo_kind, geo_payload)
  values ($1, $2, $3, $4::uuid[], $5, $6::jsonb)
  returning id`;

/** A real McAllen address geocoded to Hidalgo County — the radius kind cannot be seeded,
 *  it is produced from a caller-supplied address, so the payload is spelled out here. */
const RADIUS_PAYLOAD = {
  lat: 26.2161,
  lng: -98.2278,
  radiusMiles: 10,
  countyFips: '48215',
  matchedAddress: '1400 N 10TH ST, MCALLEN, TX, 78501',
};

async function builtInClusterIds(c: Client): Promise<string[]> {
  const { rows } = await c.query<{ id: string }>(
    'select id from industry_clusters where org_id is null order by sort_order',
  );
  return rows.map((r) => r.id);
}

async function builtInIds(c: Client, table: string, limit: number): Promise<string[]> {
  const { rows } = await c.query<{ id: string }>(
    `select id from ${table} where org_id is null order by id limit ${limit}`,
  );
  return rows.map((r) => r.id);
}

/** A search owned by `orgId`. Inserted as the CALLER, never the owner: `searches` and
 *  `search_versions` both carry app.log_event, and the audit row is part of the subject. */
async function makeSearch(c: Client, orgId: string, label = 'RGV plumbers'): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    'insert into searches (org_id, name_internal, display_name) values ($1, $2, $3) returning id',
    [orgId, `${label} — internal`, label],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('makeSearch: no row returned');
  return id;
}

async function makeVersion(
  c: Client,
  args: {
    orgId: string;
    searchId: string;
    version: number;
    clusterIds: string[];
    geoKind: string;
    geoPayload: unknown;
  },
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(INSERT_VERSION, [
    args.orgId,
    args.searchId,
    args.version,
    args.clusterIds,
    args.geoKind,
    JSON.stringify(args.geoPayload),
  ]);
  const id = rows[0]?.id;
  if (!id) throw new Error('makeVersion: no row returned');
  return id;
}

/**
 * `status` defaults to the column default ('queued'). 🔴 Since drizzle/0027 an org holds at
 * most ONE queued/running run (`runs_one_active_per_org`, 23505), so a test seeding several
 * runs in one org seeds the extras as history ('complete').
 */
async function makeRun(
  c: Client,
  orgId: string,
  versionId: string,
  status: 'queued' | 'complete' = 'queued',
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    'insert into runs (org_id, search_version_id, status) values ($1, $2, $3) returning id',
    [orgId, versionId, status],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('makeRun: no row returned');
  return id;
}

describe('versioned search presets', () => {
  it('preset geo kind round-trips for cities, counties and radius', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const clusters = await builtInClusterIds(c);
      const cityIds = await builtInIds(c, 'cities', 3);
      const countyIds = await builtInIds(c, 'counties', 4);
      const search = await makeSearch(c, a);

      const kinds = [
        { version: 1, geoKind: 'cities', geoPayload: { cityIds } },
        { version: 2, geoKind: 'counties', geoPayload: { countyIds } },
        { version: 3, geoKind: 'radius', geoPayload: RADIUS_PAYLOAD },
      ];
      for (const k of kinds) {
        await makeVersion(c, { orgId: a, searchId: search, clusterIds: clusters, ...k });
      }

      const { rows } = await c.query<{
        version: number;
        geo_kind: string;
        geo_payload: Record<string, unknown>;
        cluster_ids: string[];
      }>(
        'select version, geo_kind, geo_payload, cluster_ids from search_versions where search_id = $1 order by version',
        [search],
      );
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.geo_kind)).toEqual(['cities', 'counties', 'radius']);
      // Byte-for-byte on the fields that matter. jsonb normalises key order and whitespace
      // but NOT values, so a truncated float or a county fips silently coerced to a number
      // shows up here — and a radius centre that moved is an estimate for a different city.
      expect(rows[0]?.geo_payload).toEqual({ cityIds });
      expect(rows[1]?.geo_payload).toEqual({ countyIds });
      expect(rows[2]?.geo_payload).toEqual(RADIUS_PAYLOAD);
      expect(rows[2]?.geo_payload.countyFips).toBe('48215');
      // cluster_ids survives as a uuid[], not as a stringified array.
      expect(rows[0]?.cluster_ids).toEqual(clusters);
    }));

  it('preset geo kind: a fourth kind is refused by sv_geo_kind_known', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const clusters = await builtInClusterIds(c);
      const search = await makeSearch(c, a);
      // Its own transaction: the refusal below aborts it, and the three accepted kinds are
      // proven by the test above rather than by a statement that would report 25P02 here.
      const attempt = c.query(INSERT_VERSION, [
        a,
        search,
        1,
        clusters,
        'zipcode',
        JSON.stringify({ zips: ['78501'] }),
      ]);
      await expect(attempt).rejects.toMatchObject({ code: '23514' });
      await expect(attempt).rejects.toThrow(/sv_geo_kind_known/);
    }));

  it('new version: saving an edit inserts a version and moves current_version_id', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const clusters = await builtInClusterIds(c);
      const countyIds = await builtInIds(c, 'counties', 4);
      const search = await makeSearch(c, a);

      const v1 = await makeVersion(c, {
        orgId: a,
        searchId: search,
        version: 1,
        clusterIds: clusters.slice(0, 1),
        geoKind: 'counties',
        geoPayload: { countyIds },
      });
      await c.query('update searches set current_version_id = $2 where id = $1', [search, v1]);

      const v2 = await makeVersion(c, {
        orgId: a,
        searchId: search,
        version: 2,
        clusterIds: clusters,
        geoKind: 'radius',
        geoPayload: RADIUS_PAYLOAD,
      });
      await c.query('update searches set current_version_id = $2 where id = $1', [search, v2]);

      const pointer = await c.query<{ current_version_id: string }>(
        'select current_version_id from searches where id = $1',
        [search],
      );
      expect(pointer.rows[0]?.current_version_id).toBe(v2);

      // TWO-SIDED, and that is the point. Asserting only that the pointer moved would pass
      // just as happily against an implementation that OVERWROTE version 1 in place, which
      // is exactly the implementation this table exists to forbid.
      const old = await c.query<{
        cluster_ids: string[];
        geo_kind: string;
        geo_payload: Record<string, unknown>;
      }>('select cluster_ids, geo_kind, geo_payload from search_versions where id = $1', [v1]);
      expect(old.rows).toHaveLength(1);
      expect(old.rows[0]?.cluster_ids).toEqual(clusters.slice(0, 1));
      expect(old.rows[0]?.geo_kind).toBe('counties');
      expect(old.rows[0]?.geo_payload).toEqual({ countyIds });
    }));

  it('run keeps its version after the preset moves on', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const clusters = await builtInClusterIds(c);
      const countyIds = await builtInIds(c, 'counties', 4);
      const search = await makeSearch(c, a);

      const v1 = await makeVersion(c, {
        orgId: a,
        searchId: search,
        version: 1,
        clusterIds: clusters.slice(0, 2),
        geoKind: 'counties',
        geoPayload: { countyIds },
      });
      const run = await makeRun(c, a, v1);

      const v2 = await makeVersion(c, {
        orgId: a,
        searchId: search,
        version: 2,
        clusterIds: clusters,
        geoKind: 'radius',
        geoPayload: RADIUS_PAYLOAD,
      });
      await c.query('update searches set current_version_id = $2 where id = $1', [search, v2]);

      const after = await c.query<{ search_version_id: string }>(
        'select search_version_id from runs where id = $1',
        [run],
      );
      // SRCH-03 in one assertion: the preset moved on, the run did not.
      expect(after.rows[0]?.search_version_id).toBe(v1);

      const cited = await c.query<{ cluster_ids: string[]; geo_kind: string }>(
        'select cluster_ids, geo_kind from search_versions where id = $1',
        [v1],
      );
      expect(cited.rows[0]?.cluster_ids).toEqual(clusters.slice(0, 2));
      expect(cited.rows[0]?.geo_kind).toBe('counties');
    }));

  it('versions immutable: UPDATE as authenticated is refused', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const clusters = await builtInClusterIds(c);
      const search = await makeSearch(c, a);
      const v1 = await makeVersion(c, {
        orgId: a,
        searchId: search,
        version: 1,
        clusterIds: clusters,
        geoKind: 'radius',
        geoPayload: RADIUS_PAYLOAD,
      });

      const attempt = c.query("update search_versions set geo_kind = 'cities' where id = $1", [v1]);
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      // 🔴 THE MESSAGE. This is a GRANT refusal. An RLS refusal reads "new row violates
      // row-level security policy" and would mean the grant had been replaced by a policy
      // that a later `for all` could silently re-open. Gate mutation M12
      // (`grant update on public.search_versions to authenticated`) reds this and only this.
      await expect(attempt).rejects.toThrow(/permission denied for table search_versions/);
    }));

  it('versions immutable: DELETE as authenticated is refused', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const clusters = await builtInClusterIds(c);
      const search = await makeSearch(c, a);
      const v1 = await makeVersion(c, {
        orgId: a,
        searchId: search,
        version: 1,
        clusterIds: clusters,
        geoKind: 'radius',
        geoPayload: RADIUS_PAYLOAD,
      });

      // A SEPARATE test from the UPDATE above, resting on a separate grant, so that one
      // narrow `grant delete` reds exactly one test.
      const attempt = c.query('delete from search_versions where id = $1', [v1]);
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(/permission denied for table search_versions/);
    }));

  it('versions immutable: INSERT is still allowed', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const clusters = await builtInClusterIds(c);
      const search = await makeSearch(c, a);

      // The positive control for both refusals above. Append-only means append is ALLOWED;
      // a file that only proved refusals could not tell a correctly narrowed grant from one
      // that had been revoked wholesale, and a revoked INSERT would make the product
      // unable to save a preset at all while every refusal test stayed green.
      const v1 = await makeVersion(c, {
        orgId: a,
        searchId: search,
        version: 1,
        clusterIds: clusters,
        geoKind: 'radius',
        geoPayload: RADIUS_PAYLOAD,
      });
      const { rows } = await c.query<{ n: number }>(
        'select count(*)::int as n from search_versions where id = $1',
        [v1],
      );
      expect(rows[0]?.n).toBe(1);
    }));

  it('save conflict: a concurrent save of the same version number raises 23505', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const clusters = await builtInClusterIds(c);
      const search = await makeSearch(c, a);

      await makeVersion(c, {
        orgId: a,
        searchId: search,
        version: 2,
        clusterIds: clusters,
        geoKind: 'radius',
        geoPayload: RADIUS_PAYLOAD,
      });
      // The edit form carries the version it loaded and inserts loaded + 1. If somebody
      // saved first, this is the collision — optimistic concurrency for free, with no
      // advisory lock and no extra column. It is what 02-UI-SPEC's "This preset changed
      // while you were editing" copy already exists for.
      const attempt = c.query(INSERT_VERSION, [
        a,
        search,
        2,
        clusters,
        'radius',
        JSON.stringify(RADIUS_PAYLOAD),
      ]);
      await expect(attempt).rejects.toMatchObject({ code: '23505' });
      await expect(attempt).rejects.toThrow(/search_versions_search_version_uniq/);
    }));

  it('tenancy: a version cannot be attached to another org\'s search', () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoOrgs(c);

      // B's preset, written as B so the log_event trigger has a tenant to attribute to.
      await actAs(c, ORG_B_CLAIMS);
      const foreign = await makeSearch(c, b, 'Bravo plumbers');
      await actAsOwner(c);

      await actAs(c, ORG_A_CLAIMS);
      const clusters = await builtInClusterIds(c);

      // 🔴 RLS CANNOT REFUSE THIS ONE AND NEVER COULD. `search_versions_insert` checks the
      // NEW ROW'S OWN org_id, which is A's and therefore correct; the row's PARENT is B's.
      // The FK to searches is a referential check and PostgreSQL evaluates those with the
      // referenced table owner's privileges — by design, so RLS does not apply to it. Before
      // `search_versions_search_org_fk` (migration 0017) this INSERT SUCCEEDED: it made any
      // real search id from any org an existence oracle (T-2-10), let an attacker squat the
      // victim's next version number behind the append-only grant, and left rows whose
      // org_id disagreed with their parent's. Only a COMPOSITE key can say "this parent is
      // mine", because only a composite key carries the org into the referential check.
      //
      // 23503, not 42501: this is the FK refusing, which is what makes the guard survive
      // hand-written SQL and a future action that forgets its ownership read.
      const attempt = c.query(INSERT_VERSION, [
        a,
        foreign,
        1,
        clusters,
        'radius',
        JSON.stringify(RADIUS_PAYLOAD),
      ]);
      await expect(attempt).rejects.toMatchObject({ code: '23503' });
      await expect(attempt).rejects.toThrow(/search_versions_search_org_fk/);
    }));

  it('tenancy: a version on the caller\'s OWN search is still accepted', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const clusters = await builtInClusterIds(c);
      const own = await makeSearch(c, a);

      // The positive control for the refusal above, and it is not redundant with the
      // append-only tests: a composite FK written against the wrong columns — or one that
      // compared org_id to a constant — would refuse EVERY version and red the product
      // while the cross-tenant test above stayed green for the wrong reason.
      const v1 = await makeVersion(c, {
        orgId: a,
        searchId: own,
        version: 1,
        clusterIds: clusters,
        geoKind: 'radius',
        geoPayload: RADIUS_PAYLOAD,
      });
      const { rows } = await c.query<{ n: number }>(
        'select count(*)::int as n from search_versions where id = $1',
        [v1],
      );
      expect(rows[0]?.n).toBe(1);
    }));

  it('a run cannot be re-pointed at a different version', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const clusters = await builtInClusterIds(c);
      const search = await makeSearch(c, a);
      const v1 = await makeVersion(c, {
        orgId: a,
        searchId: search,
        version: 1,
        clusterIds: clusters,
        geoKind: 'radius',
        geoPayload: RADIUS_PAYLOAD,
      });
      const v2 = await makeVersion(c, {
        orgId: a,
        searchId: search,
        version: 2,
        clusterIds: clusters,
        geoKind: 'radius',
        geoPayload: RADIUS_PAYLOAD,
      });
      const run = await makeRun(c, a, v1);

      // T-2-12. A policy's WITH CHECK sees the finished row and has no access to OLD, so it
      // can say "the row still belongs to me" but never "this column did not change".
      // PostgreSQL checks a COLUMN privilege against the statement's SET list before any
      // policy runs, and search_version_id is deliberately outside that list in
      // drizzle/0013 — which is what makes "this run searched for X" permanently answerable.
      const attempt = c.query('update runs set search_version_id = $2 where id = $1', [run, v2]);
      await expect(attempt).rejects.toMatchObject({ code: '42501' });
      await expect(attempt).rejects.toThrow(
        /permission denied for column|permission denied for table runs/,
      );
    }));

  it('a run can still be advanced through its status column', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const clusters = await builtInClusterIds(c);
      const search = await makeSearch(c, a);
      const v1 = await makeVersion(c, {
        orgId: a,
        searchId: search,
        version: 1,
        clusterIds: clusters,
        geoKind: 'radius',
        geoPayload: RADIUS_PAYLOAD,
      });
      const run = await makeRun(c, a, v1);

      // The positive control for the refusal above, in its OWN test so that the column
      // grant's two halves are separately observable: revoking UPDATE on runs wholesale
      // would keep the refusal test green while breaking every run the product executes.
      const upd = await c.query("update runs set status = 'complete' where id = $1", [run]);
      expect(upd.rowCount).toBe(1);
    }));

  it('used by N runs is a live count, not a stored counter', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const clusters = await builtInClusterIds(c);
      const search = await makeSearch(c, a);
      const v1 = await makeVersion(c, {
        orgId: a,
        searchId: search,
        version: 1,
        clusterIds: clusters,
        geoKind: 'radius',
        geoPayload: RADIUS_PAYLOAD,
      });
      const v2 = await makeVersion(c, {
        orgId: a,
        searchId: search,
        version: 2,
        clusterIds: clusters,
        geoKind: 'radius',
        geoPayload: RADIUS_PAYLOAD,
      });
      // Finished runs: three ACTIVE runs in one org would be refused by
      // runs_one_active_per_org (drizzle/0027). The count is over every run, whatever status.
      await makeRun(c, a, v1, 'complete');
      await makeRun(c, a, v1, 'complete');
      await makeRun(c, a, v2);

      const counts = await c.query<{ search_version_id: string; n: number }>(
        'select search_version_id, count(*)::int as n from runs group by search_version_id',
      );
      const byVersion = new Map(counts.rows.map((r) => [r.search_version_id, r.n]));
      expect(byVersion.get(v1)).toBe(2);
      expect(byVersion.get(v2)).toBe(1);
      // There is no denormalised column to drift, and this asserts its ABSENCE: a
      // `runs_count` added to search_versions later would have to be maintained by
      // something, and "used by N runs" would start disagreeing with the rows themselves.
      const cols = await c.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'search_versions'`,
      );
      expect(cols.rows.map((r) => r.column_name)).not.toContain('runs_count');
    }));

  it('timestamps: the epoch-ms cast the query module reads is exact and parseable', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const clusters = await builtInClusterIds(c);
      const search = await makeSearch(c, a);
      const v1 = await makeVersion(c, {
        orgId: a,
        searchId: search,
        version: 1,
        clusterIds: clusters,
        geoKind: 'radius',
        geoPayload: RADIUS_PAYLOAD,
      });

      // WR-07. `src/server/queries/presets.ts` typed these columns `Date` and selected them
      // bare. Through the RUNTIME driver — postgres.js with prepare:false, which the
      // transaction pooler requires — a timestamptz comes back as TEXT, because drizzle's
      // column mapper runs only for query-builder results and every read there is raw
      // `tx.execute`. Nothing fails at the boundary; it fails wherever `Intl` is first handed
      // the string, as `RangeError: Invalid time value`, with typecheck, lint and build green.
      //
      // 🔴 THIS SUITE CANNOT REPRODUCE THE STRING ITSELF, and pretending otherwise would be
      // the dishonest version of this test: tests/db connects with node-postgres, which DOES
      // parse oid 1184 into a Date. What it CAN execute is the expression the fix rests on,
      // which is the half that was never run.
      const r = await c.query<{ ms: string; iso: string; same: boolean }>(
        `select (extract(epoch from created_at) * 1000)::bigint::text as ms,
                to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as iso,
                (extract(epoch from created_at) * 1000)::bigint
                  = (extract(epoch from created_at) * 1000)::numeric::bigint as same
           from search_versions where id = $1`,
        [v1],
      );
      const ms = r.rows[0]?.ms ?? '';
      // Digits only: what `Number()` can parse without a format, a zone or a locale.
      expect(ms).toMatch(/^\d+$/);
      expect(Number.isFinite(Number(ms))).toBe(true);
      // The cast is lossy to the millisecond and no further — the bigint truncation matches
      // the numeric one, so it is not silently rounding a microsecond into another second.
      expect(r.rows[0]?.same).toBe(true);
      // And it is the SAME INSTANT, compared against the row's own rendering rather than
      // against `now()` in JavaScript: an epoch has no zone, so this discriminates a cast
      // that dropped the offset — which would land the row hours away and still look valid.
      const fromMs = new Date(Number(ms)).toISOString().slice(0, 19);
      expect(r.rows[0]?.iso.slice(0, 19)).toBe(fromMs);
    }));

  it('a version insert writes an events row with the actor', () =>
    withRollback(async (c) => {
      const { a } = await seedTwoOrgs(c);
      await actAs(c, ORG_A_CLAIMS);
      const clusters = await builtInClusterIds(c);
      const search = await makeSearch(c, a);

      // RAW SQL, no application code in the path — D-08's acceptance test is literally
      // "a direct write still produces an event", and a write helper in src/ could not pass
      // it. makeVersion above issues the INSERT itself for exactly that reason.
      const v1 = await makeVersion(c, {
        orgId: a,
        searchId: search,
        version: 1,
        clusterIds: clusters,
        geoKind: 'radius',
        geoPayload: RADIUS_PAYLOAD,
      });

      const { rows } = await c.query<{
        actor_id: string;
        entity_type: string;
        entity_id: string;
        action: string;
        age_seconds: string;
      }>(
        `select actor_id, entity_type, entity_id, action,
                extract(epoch from (now() - occurred_at))::text as age_seconds
           from events
          where entity_type = 'search_versions'
          order by id desc
          limit 1`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_id: 'user_danlo',
        entity_type: 'search_versions',
        action: 'insert',
      });
      expect(rows[0]?.entity_id).toBe(v1);
      // Compared IN SQL. A timestamptz handed back through pg becomes a JS Date and this
      // suite runs with TZ=UTC on an America/Chicago machine — the round trip is exactly
      // where a wrong comparison hides.
      expect(Number(rows[0]?.age_seconds)).toBeGreaterThanOrEqual(0);
      expect(Number(rows[0]?.age_seconds)).toBeLessThan(60);
    }));
});
