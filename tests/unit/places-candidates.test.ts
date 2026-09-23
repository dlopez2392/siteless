/**
 * The per-page Places candidate fetch (src/lib/places/candidates.ts), as TEXT and PARAMETERS.
 * No database: tests/db (04-18) proves the plan and the rows against real spine data.
 *
 * 🔴 The Drizzle trap this pins (src/db/drizzle-executor.ts header): a JS array interpolated
 * into a `sql` template becomes N placeholders. The ≤ 20 probes must reach Postgres as ONE
 * jsonb parameter, read back by `jsonb_to_recordset`, whose column list is the contract for the
 * JSON's keys.
 *
 * 🔴 Every arm is org-scoped and excludes merged businesses. "Every arm" is counted against the
 * number of `cross join lateral` arms the statement actually has, so an arm added without the
 * two filters reds here.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  PROXIMITY_DEG_LAT,
  PROXIMITY_DEG_LNG,
  placeCandidatesQuery,
  type CandidateProbe,
} from '@/lib/places/candidates';

const dialect = new PgDialect();

const LOCATED: CandidateProbe = {
  idx: 0,
  nameNorm: 'sentinelname plumbing',
  phone: '+19566310001',
  postal: '78577',
  streetNum: '4321',
  lat: 26.1911,
  lng: -98.1717,
  sab: false,
};

const SAB: CandidateProbe = {
  idx: 1,
  nameNorm: 'sentinelsab mobile',
  phone: '+19566310002',
  postal: null,
  streetNum: null,
  lat: null,
  lng: null,
  sab: true,
};

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('places candidate query', () => {
  it('places candidate query binds the probes as one jsonb parameter', () => {
    const { sql: text, params } = dialect.sqlToQuery(
      placeCandidatesQuery([LOCATED, SAB], 'pharrcity'),
    );

    // The probes: exactly one parameter, the first, cast to jsonb and unpacked in one place.
    expect(text).toContain('jsonb_to_recordset($1::jsonb)');
    const json = params.filter((v) => typeof v === 'string' && v.startsWith('['));
    expect(json).toHaveLength(1);
    expect(params[0]).toBe(json[0]);

    // The JSON's keys ARE the recordset's column names: a camelCase key would unpack as NULL.
    const decoded = JSON.parse(json[0] as string) as Record<string, unknown>[];
    expect(decoded).toEqual([
      {
        idx: 0,
        name_norm: 'sentinelname plumbing',
        phone: '+19566310001',
        postal: '78577',
        street_num: '4321',
        lat: 26.1911,
        lng: -98.1717,
        sab: false,
      },
      {
        idx: 1,
        name_norm: 'sentinelsab mobile',
        phone: '+19566310002',
        postal: null,
        street_num: null,
        lat: null,
        lng: null,
        sab: true,
      },
    ]);
    for (const col of [
      'idx int',
      'name_norm text',
      'phone text',
      'postal text',
      'street_num text',
      'lat float8',
      'lng float8',
      'sab boolean',
    ]) {
      expect(text).toContain(col);
    }

    // The city is a parameter too; the only other values are the probes'.
    expect(params.slice(1).every((v) => v === 'pharrcity')).toBe(true);
    expect(params.length).toBeGreaterThan(1);

    // No probe value and no city is ever spelled into the SQL text (T-4-10).
    for (const value of [
      'sentinel',
      '+1956',
      '6310001',
      '78577',
      '4321',
      '26.1911',
      '98.1717',
      'pharrcity',
    ]) {
      expect(text).not.toContain(value);
    }

    // Without a queried city there is no city parameter at all.
    const noCity = dialect.sqlToQuery(placeCandidatesQuery([LOCATED], null));
    expect(noCity.params).toHaveLength(1);
    expect(noCity.sql).toContain('jsonb_to_recordset($1::jsonb)');

    // The proximity box is the committed ±150 m, never a caller value.
    expect(text).toContain(`p.lat - ${PROXIMITY_DEG_LAT}`);
    expect(text).toContain(`p.lat + ${PROXIMITY_DEG_LAT}`);
    expect(text).toContain(`p.lng - ${PROXIMITY_DEG_LNG}`);
    expect(text).toContain(`p.lng + ${PROXIMITY_DEG_LNG}`);
    // The scorer's nameSim comes from the database.
    expect(text).toContain('similarity(p.name_norm, b.name_norm)');
  });

  it('places candidate query excludes merged businesses on every arm', () => {
    const withCity = dialect.sqlToQuery(placeCandidatesQuery([LOCATED, SAB], 'pharrcity')).sql;
    const withoutCity = dialect.sqlToQuery(placeCandidatesQuery([LOCATED, SAB], null)).sql;

    // B1 phone, B2 address, B3 trigram in the postal, B3 trigram in the queried city (SAB), B4
    // proximity. The SAB trigram arm is omitted entirely without a queried city.
    expect(count(withCity, 'cross join lateral')).toBe(5);
    expect(count(withoutCity, 'cross join lateral')).toBe(4);
    expect(count(withCity, 'b.merged_into_id is null')).toBe(5);
    expect(count(withoutCity, 'b.merged_into_id is null')).toBe(4);
    expect(withoutCity).not.toContain('lower(b.city)');
    expect(count(withCity, 'lower(b.city) = $')).toBe(1);

    // Every arm is bounded.
    expect(count(withCity, 'limit ')).toBe(5);
    // One row per (probe, business), however many arms found it.
    expect(withCity).toContain('distinct on (u.idx, u.business_id)');
  });

  it('places candidate query scopes by org on every arm', () => {
    for (const city of ['pharrcity', null]) {
      const text = dialect.sqlToQuery(placeCandidatesQuery([LOCATED, SAB], city)).sql;
      const arms = count(text, 'cross join lateral');
      expect(arms).toBeGreaterThan(0);
      expect(count(text, 'b.org_id = (select app.current_org_id())')).toBe(arms);
      // Never an org id from the caller.
      expect(text).not.toMatch(/org_id\s*=\s*\$/);
    }
  });

  it('places candidate query refuses more than one page of probes', () => {
    const page = Array.from({ length: 21 }, (_, i) => ({ ...LOCATED, idx: i }));
    expect(() => placeCandidatesQuery(page, null)).toThrow(/20/);
    expect(() => placeCandidatesQuery(page.slice(0, 20), null)).not.toThrow();
  });
});
