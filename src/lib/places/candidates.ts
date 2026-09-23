/**
 * PLACE-05 / D-05: the candidate businesses for ONE page of Places results.
 *
 * One statement per page, never per result, never org-wide (03 deferred-items: the B3 lateral
 * took 6–12 min org-wide).
 *
 * This module BUILDS a drizzle `SQL`; it executes nothing. The caller (04-18) runs
 * `similarityThresholdSql()` (src/lib/resolve/block.ts) FIRST, in the same transaction — the
 * trigram operator's cut-off is that session GUC — and then this statement.
 *
 * 🔴 THE PROBES ARE ONE PARAMETER. A JS array interpolated into a `sql` template becomes N
 * placeholders (src/db/drizzle-executor.ts header). The ≤ 20 normalized probes are bound as ONE
 * `JSON.stringify(...)` value, cast `::jsonb` and unpacked by `jsonb_to_recordset`. The JSON's
 * keys are the recordset's column names (snake_case): a camelCase key would unpack as NULL and
 * every arm would silently find nothing.
 *
 * Four bounded arms per probe, each a `cross join lateral` driven by an index, each filtered by
 * `b.org_id = (select app.current_org_id())` (in addition to RLS, T-4-06) and by
 * `b.merged_into_id is null`:
 *   B1 phone      — exact blockable E.164                     → businesses_phone_idx      limit 10
 *   B2 address    — (postal, street_num), located probes only → businesses_addr_idx       limit 10
 *   B3 trigram    — name_norm % within the postal (located), and within the queried city (SAB)
 *                   → businesses_name_trgm as the driver, ordered by <->                  limit 5
 *                   The SAB half is omitted entirely when there is no queried city (a county or
 *                   radius unit), so it is its own lateral arm.
 *   B4 proximity  — a ±150 m lat/lng box, located probes only → businesses_latlng_idx     limit 10
 *
 * Every row carries `similarity(p.name_norm, b.name_norm)` as `name_sim`: the scorer's contract
 * is that nameSim comes from the database, never a TypeScript trigram.
 *
 * 🔴 SQL NEVER NORMALIZES (tests/unit/sql-never-normalizes.test.ts). The city comparison is
 * `lower(b.city)` against a city the CALLER folded in TypeScript; nothing here folds accents.
 */
import { sql, type SQL } from 'drizzle-orm';

export type CandidateProbe = {
  idx: number;
  nameNorm: string | null;
  phone: string | null;
  postal: string | null;
  streetNum: string | null;
  lat: number | null;
  lng: number | null;
  sab: boolean;
};

export type CandidateRow = {
  idx: number;
  business_id: string;
  name_sim: number;
  name_norm: string | null;
  phone_e164: string | null;
  phone_blockable: boolean;
  street_num: string | null;
  street_norm: string | null;
  unit: string | null;
  postal: string | null;
  lat: number | null;
  lng: number | null;
  location_match_type: string | null;
  cluster_key: string | null;
  city: string | null;
};

export const PROXIMITY_DEG_LAT = 0.00135; // ±150 m
export const PROXIMITY_DEG_LNG = 0.0015; // ±150 m at RGV latitudes (cos 26° ≈ 0.899)

/** A Text Search page holds at most 20 places (T-4-02: the fetch is bounded by construction). */
const MAX_PROBES = 20;

/** The columns every arm returns, `name_sim` computed against the probe inside the lateral. */
const COLUMNS = sql.raw(`b.id as business_id,
         coalesce(similarity(p.name_norm, b.name_norm), 0)::float8 as name_sim,
         b.name_norm, b.phone_e164, b.phone_blockable, b.street_num, b.street_norm, b.unit,
         b.postal, b.lat, b.lng, b.location_match_type, b.cluster_key, b.city`);

/** The two filters every arm carries. Spelled once so no arm can drop one. */
const SCOPE = sql.raw(`b.org_id = (select app.current_org_id())
       and b.merged_into_id is null`);

function arm(where: SQL, tail: SQL): SQL {
  return sql`select p.idx, c.* from p cross join lateral (
      select ${COLUMNS}
        from businesses b
       where ${SCOPE}
         and ${where}
       ${tail}
    ) c`;
}

function probeJson(probes: CandidateProbe[]): string {
  return JSON.stringify(
    probes.map((p) => {
      if (!Number.isInteger(p.idx))
        throw new Error(`placeCandidatesQuery: probe idx must be an integer: ${p.idx}`);
      return {
        idx: p.idx,
        name_norm: p.nameNorm,
        phone: p.phone,
        postal: p.postal,
        street_num: p.streetNum,
        lat: p.lat,
        lng: p.lng,
        sab: p.sab,
      };
    }),
  );
}

export function placeCandidatesQuery(
  probes: CandidateProbe[],
  queriedCityLower: string | null,
): SQL {
  if (probes.length > MAX_PROBES) {
    throw new Error(
      `placeCandidatesQuery: ${probes.length} probes — one page is at most ${MAX_PROBES} (never the org-wide scan)`,
    );
  }

  const latBox = sql.raw(String(PROXIMITY_DEG_LAT));
  const lngBox = sql.raw(String(PROXIMITY_DEG_LNG));

  const arms: SQL[] = [
    // B1 phone.
    arm(sql`p.phone is not null and b.phone_e164 = p.phone and b.phone_blockable`, sql`limit 10`),
    // B2 address (located only).
    arm(
      sql`not p.sab and p.postal is not null and p.street_num is not null
         and b.postal = p.postal and b.street_num = p.street_num`,
      sql`limit 10`,
    ),
    // B3 trigram within the postal (located only).
    arm(
      sql`not p.sab and p.name_norm is not null and p.postal is not null
         and b.postal = p.postal and b.name_norm % p.name_norm`,
      sql`order by b.name_norm <-> p.name_norm limit 5`,
    ),
  ];

  // B3 trigram within the queried city (SAB only) — omitted without a city unit.
  if (queriedCityLower !== null) {
    arms.push(
      arm(
        sql`p.sab and p.name_norm is not null
         and lower(b.city) = ${queriedCityLower} and b.name_norm % p.name_norm`,
        sql`order by b.name_norm <-> p.name_norm limit 5`,
      ),
    );
  }

  // B4 proximity (located only).
  arms.push(
    arm(
      sql`not p.sab and p.lat is not null and p.lng is not null
         and b.lat between p.lat - ${latBox} and p.lat + ${latBox}
         and b.lng between p.lng - ${lngBox} and p.lng + ${lngBox}`,
      sql`limit 10`,
    ),
  );

  return sql`with p as (
  select * from jsonb_to_recordset(${probeJson(probes)}::jsonb)
    as p(idx int, name_norm text, phone text, postal text, street_num text, lat float8, lng float8, sab boolean)
)
select distinct on (u.idx, u.business_id) u.*
  from (
    ${sql.join(arms, sql`\n    union all\n    `)}
  ) u
 order by u.idx, u.business_id`;
}
