import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { upsertBusinessFromSource, upsertSourceRecord } from '@/lib/ingest/upsert';
import type { Claims } from './_fixtures';
import {
  asEtlExecutor,
  comptrollerIngestInput,
  overtureIngestInput,
  type ComptrollerFixtureRow,
  type OvertureFixtureRow,
} from './_ingest-fixtures';
import tripleJson from '../unit/fixtures/merge-triple.json';

/**
 * Merge fixtures (plan 03-11), composed on `_ingest-fixtures.ts`. A separate file because
 * 03-12 / 03-13 extend `_ingest-fixtures.ts` in the same wave.
 *
 * 🔴 EVERY BUSINESS IS SEEDED THROUGH THE SHIPPED INGEST PATH (`upsertSourceRecord` +
 * `upsertBusinessFromSource`), so each carries a real external key, a durable source record and
 * provenance ids — the shape a merge actually meets, and the only shape in which "unmerge
 * re-derives the loser from its own source records" means anything.
 *
 * 🔴 SEED AS THE OWNER, BEFORE `actAs`. `merge_candidates` is SELECT-only for `authenticated`
 * (decisions go through a definer, T-3-08), so the candidate rows can only be inserted here.
 *
 * 🔴 THE WINNER IS MADE DETERMINISTIC. Every row in one `withRollback` shares `now()` as its
 * `created_at`, so the winner rule (older `created_at`, then smaller id) would fall through to
 * a random uuid. The Comptroller business is back-dated one day, so it is always the winner
 * and the merge visibly changes it (its display_name becomes Overture's).
 */

export const CLAIMS_A: Claims = {
  o: { id: 'org_A', rol: 'admin' },
  sub: 'user_reviewer_A',
  role: 'authenticated',
};
export const CLAIMS_B: Claims = {
  o: { id: 'org_B', rol: 'admin' },
  sub: 'user_reviewer_B',
  role: 'authenticated',
};

/** Every column survivorship owns — the list the definers snapshot and apply, typed out
 *  independently here so a test never trusts the implementation's own helper. */
export const SURVIVORSHIP_COLUMNS = [
  'legal_name',
  'legal_name_source_id',
  'display_name',
  'display_name_source_id',
  'phone_e164',
  'phone_blockable',
  'phone_source_id',
  'street',
  'street_num',
  'street_norm',
  'unit',
  'postal',
  'city',
  'address_source_id',
  'lat',
  'lng',
  'location_match_type',
  'location_source_id',
  'closed_at',
  'closed_at_source_id',
  'basic_category',
  'cluster_key',
  'confidence',
  'operating_status',
] as const;

export async function survivorshipColumns(
  c: Client,
  businessId: string,
): Promise<Record<string, unknown>> {
  const r = await c.query(
    `select ${SURVIVORSHIP_COLUMNS.join(', ')} from businesses where id = $1`,
    [businessId],
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error('survivorshipColumns: no business ' + businessId);
  return row;
}

let seq = 0;
const digits = (n: number) =>
  String(Date.now() % 1_000_000_000).padStart(9, '0') + String(n).padStart(2, '0');

export interface SeededSide {
  businessId: string;
  sourceRecordId: string;
  externalKey: string;
}

/** One Comptroller outlet, its Census Exact geocode record, and its business located by it. */
export async function seedComptrollerSide(
  c: Client,
  orgId: string,
  spec: { name: string; address: string; zip: string; city: string; lat: number; lng: number },
): Promise<SeededSide & { censusRecordId: string }> {
  seq += 1;
  const row: ComptrollerFixtureRow = {
    taxpayer_number: digits(seq),
    outlet_number: '1',
    outlet_name: spec.name,
    outlet_address: spec.address,
    outlet_city: spec.city,
    outlet_zip_code: spec.zip,
    outlet_county_code: '108',
    outlet_naics_code: '238220',
  };
  const input = comptrollerIngestInput(row);
  const x = asEtlExecutor(c);
  const seenAt = new Date();
  const sr = await upsertSourceRecord(x, {
    orgId,
    sourceKey: 'tx_comptroller',
    externalId: input.externalId,
    payload: input.payload,
    sourceVersion: '2026-09-20T00:00:00.000Z',
    seenAt,
  });
  const b = await upsertBusinessFromSource(x, sr.id, input.derived, { orgId, changed: sr.changed });
  // The Census batch geocode as 03-12 writes it: a durable census_geocoder record keyed by the
  // Comptroller key, and the business's lat/lng citing it.
  const census = await upsertSourceRecord(x, {
    orgId,
    sourceKey: 'census_geocoder',
    externalId: input.externalId,
    payload: {
      kind: 'Match',
      matchType: 'Exact',
      matchedAddress: `${spec.address}, ${spec.city}, TX, ${spec.zip}`,
      lat: spec.lat,
      lng: spec.lng,
    },
    sourceVersion: null,
    seenAt,
  });
  const u = await c.query<{ external_key: string }>(
    `update businesses
        set lat = $2, lng = $3, location_match_type = 'census_exact', location_source_id = $4,
            created_at = created_at - interval '1 day'
      where id = $1 returning external_key`,
    [b.businessId, spec.lat, spec.lng, census.id],
  );
  return {
    businessId: b.businessId,
    sourceRecordId: sr.id,
    censusRecordId: census.id,
    externalKey: u.rows[0]!.external_key,
  };
}

/** One Overture place and its business. */
export async function seedOvertureSide(
  c: Client,
  orgId: string,
  spec: {
    name: string;
    street: string;
    zip: string;
    city: string;
    lat: number;
    lng: number;
    phone?: string | null;
  },
): Promise<SeededSide> {
  const row: OvertureFixtureRow = {
    id: randomUUID(),
    name: spec.name,
    country: 'US',
    region: 'TX',
    locality: spec.city,
    lat: spec.lat,
    lng: spec.lng,
    basic_category: 'stone_supplier',
    phone: spec.phone ?? null,
    street: spec.street,
    postcode: spec.zip,
  };
  const input = overtureIngestInput(row);
  const x = asEtlExecutor(c);
  const sr = await upsertSourceRecord(x, {
    orgId,
    sourceKey: 'overture',
    externalId: input.externalId,
    payload: input.payload,
    sourceVersion: '2026-08-19.0',
    seenAt: new Date(),
  });
  const b = await upsertBusinessFromSource(x, sr.id, input.derived, { orgId, changed: sr.changed });
  const k = await c.query<{ external_key: string }>(
    'select external_key from businesses where id = $1',
    [b.businessId],
  );
  return { businessId: b.businessId, sourceRecordId: sr.id, externalKey: k.rows[0]!.external_key };
}

export async function seedCandidate(
  c: Client,
  orgId: string,
  a: string,
  b: string,
  score = 95,
): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into merge_candidates (org_id, left_id, right_id, block_key, score, features)
     values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), 'addr', $4,
             '{"name":45,"address":30,"distance":15,"cluster":5}'::jsonb)
     returning id`,
    [orgId, a, b, score],
  );
  return r.rows[0]!.id;
}

/** A Comptroller business + an Overture business for the same place, and their candidate. */
export async function seedMergePair(c: Client, orgId: string, tag = 'RIVERSIDE') {
  const comptroller = await seedComptrollerSide(c, orgId, {
    name: `${tag} STONE, INC.`,
    address: '900 E BUSINESS 83 STE 4',
    zip: '78501',
    city: 'MCALLEN',
    lat: 26.18,
    lng: -98.21,
  });
  const overture = await seedOvertureSide(c, orgId, {
    name: `${tag[0]}${tag.slice(1).toLowerCase()} Stone`,
    street: '900 E Business 83',
    zip: '78501',
    city: 'McAllen',
    lat: 26.1802,
    lng: -98.21,
    phone: '(956) 682-2400',
  });
  const candidateId = await seedCandidate(c, orgId, comptroller.businessId, overture.businessId);
  return { comptroller, overture, candidateId };
}

type TripleRecord = (typeof tripleJson.records)[number];
const tripleRec = (id: string): TripleRecord => {
  const r = tripleJson.records.find((x) => x.id === id);
  if (!r) throw new Error('merge-triple.json: no record ' + id);
  return r;
};

/**
 * The SYNTHETIC three-way cluster from tests/unit/fixtures/merge-triple.json (95 on every edge
 * under the committed scorer; the real Rio Stone Products triple scores 90 and never
 * auto-merges — 03-02). One Comptroller row, two Overture rows, three candidates at 95.
 */
export async function seedTriple(c: Client, orgId: string) {
  const a = tripleRec('T01-a');
  const b = tripleRec('T01-b');
  const cc = tripleRec('T01-c');
  const comptroller = await seedComptrollerSide(c, orgId, {
    name: a.sourceName,
    address: '900 E SYNTHETIC BUSINESS 83',
    zip: a.postal,
    city: 'MCALLEN',
    lat: a.lat,
    lng: a.lng,
  });
  const overtureB = await seedOvertureSide(c, orgId, {
    name: b.sourceName,
    street: '900 E Synthetic Business 83',
    zip: b.postal,
    city: 'McAllen',
    lat: b.lat,
    lng: b.lng,
  });
  const overtureC = await seedOvertureSide(c, orgId, {
    name: cc.sourceName,
    street: '900 E Synthetic Business 83',
    zip: cc.postal,
    city: 'McAllen',
    lat: cc.lat,
    lng: cc.lng,
  });
  // Back-date B one hour so the three have a strict age order: A (1 day) < B < C.
  await c.query(`update businesses set created_at = created_at - interval '1 hour' where id = $1`, [
    overtureB.businessId,
  ]);
  const byId: Record<string, string> = {
    'T01-a': comptroller.businessId,
    'T01-b': overtureB.businessId,
    'T01-c': overtureC.businessId,
  };
  const candidates: string[] = [];
  for (const e of tripleJson.edges) {
    candidates.push(await seedCandidate(c, orgId, byId[e.a]!, byId[e.b]!, e.expect.score));
  }
  return { a: comptroller, b: overtureB, c: overtureC, candidates };
}
