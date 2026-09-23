/**
 * The Texas Comptroller Socrata client and its two dataset transforms. DATA-01, D-03.
 *
 * Every request in this file is served by `./msw/server.ts` from a recorded payload.
 * Nothing here touches the network, and `onUnhandledRequest: 'error'` turns an accidental
 * live call into a failure rather than a flake.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  naicsPredicate,
  paddedCountyCode,
  payloadHash,
  SOCRATA_PAGE_LIMIT,
  socrataQuery,
  socrataRowsUpdatedAt,
  unpaddedCountyCode,
} from '@/lib/socrata/client';
import {
  CLOSURES_DATASET,
  CLOSURES_RGV_WHERE,
  closureRowSchema,
  closureRowToSourceRecord,
  RGV_UNPADDED_COUNTY_CODES,
} from '@/lib/socrata/closures';
import {
  comptrollerRowToSourceRecord,
  PERMITS_DATASET,
  PERMITS_RGV_WHERE,
  permitRowSchema,
  RGV_PADDED_COUNTY_CODES,
} from '@/lib/socrata/permits';
import { localDate } from '@/lib/time';
import clustersJson from '@/seed/data/clusters.json';
import closuresFixture from './msw/fixtures/socrata-3kx8-page.json';
import permitsFixture from './msw/fixtures/socrata-jrea-page.json';
import typeMismatchEnvelope from './msw/fixtures/socrata-400-type-mismatch.json';
import {
  failNextSocrataWithTypeMismatch,
  RECORDED_ORDER,
  RECORDED_WHERE,
  resetSocrata,
  server,
  socrataRequests,
  startReplayServer,
} from './msw/server';

beforeAll(() => {
  startReplayServer();
});
afterEach(() => {
  server.resetHandlers();
  resetSocrata();
});
afterAll(() => {
  server.close();
});

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const permitsQuery = (extra: Record<string, string> = {}) => ({
  $where: RECORDED_WHERE.permits,
  $order: RECORDED_ORDER.permits,
  ...extra,
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe('the NAICS predicate (Pitfall 6)', () => {
  it('naics prefix: the SoQL string-prefix function appears nowhere in the Socrata client or the counts script', () => {
    // `outlet_naics_code` is a Socrata NUMBER; the string-prefix function on it is an HTTP
    // 400 `query.soql.type-mismatch`. The gate covers comments too: a comment quoting the
    // function is how it gets copied back into code. This file lives under tests/ and is
    // outside the scan, so it may spell the token.
    const forbidden = 'starts_with';
    const files = [
      ...walk(join(ROOT, 'src/lib/socrata')),
      join(ROOT, 'scripts/refresh-outlet-counts.ts'),
    ];
    const scanned = files.map((f) => relative(ROOT, f).replace(/\\/g, '/'));

    // Non-vacuous: the walk really did reach the lifted client and the script.
    expect(scanned).toContain('src/lib/socrata/client.ts');
    expect(scanned).toContain('scripts/refresh-outlet-counts.ts');

    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes(forbidden));
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('naics prefix: ranges become half-open numeric comparisons', () => {
    expect(naicsPredicate([{ lo: 230000, hi: 240000 }])).toBe(
      '((outlet_naics_code >= 230000 and outlet_naics_code < 240000))',
    );
    expect(
      naicsPredicate([
        { lo: 812100, hi: 812200 },
        { lo: 621000, hi: 622000 },
      ]),
    ).toBe(
      '((outlet_naics_code >= 812100 and outlet_naics_code < 812200) or ' +
        '(outlet_naics_code >= 621000 and outlet_naics_code < 622000))',
    );
  });
});

describe('SOCRATA_APP_TOKEN in src/env.ts', () => {
  const KEYS = ['SOCRATA_APP_TOKEN', 'SUPABASE_DB_POOL_URL', 'CLERK_SECRET_KEY'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    process.env.CLERK_SECRET_KEY ||= 'sk_test_unused_by_this_test';
    process.env.SUPABASE_DB_POOL_URL ||= 'postgres://app_user:x@localhost:5432/unused';
    vi.resetModules();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.resetModules();
  });

  const loadEnv = async () => (await import('@/env')).env;

  it('socrata app token: an EMPTY value is absent, not a boot failure', async () => {
    // GitHub Actions substitutes an absent secret as ''. Without the `|| undefined`
    // normalisation `.min(1)` refuses it and every deploy dies at boot over an OPTIONAL
    // variable.
    process.env.SOCRATA_APP_TOKEN = '';
    expect((await loadEnv()).SOCRATA_APP_TOKEN).toBeUndefined();
  });

  it('socrata app token: a real value is carried through', async () => {
    process.env.SOCRATA_APP_TOKEN = 'app-token-for-test';
    expect((await loadEnv()).SOCRATA_APP_TOKEN).toBe('app-token-for-test');
  });

  it('socrata app token: the X-App-Token header is sent only when a token is present', async () => {
    delete process.env.SOCRATA_APP_TOKEN;
    await socrataQuery('jrea-zgmq', permitsQuery());
    process.env.SOCRATA_APP_TOKEN = '';
    await socrataQuery('jrea-zgmq', permitsQuery());
    process.env.SOCRATA_APP_TOKEN = 'app-token-for-test';
    await socrataQuery('jrea-zgmq', permitsQuery());

    expect(socrataRequests.map((r) => r.appToken)).toEqual([null, null, 'app-token-for-test']);
  });
});

describe('the Socrata client against recorded pages', () => {
  it('socrata replay: the recorded permits $where pages through the whole recording', async () => {
    // 40 recorded rows at a page size of 15: three requests, the last one short, which is
    // the loop's only stop condition.
    const rows = await socrataQuery('jrea-zgmq', permitsQuery({ $limit: '15' }));

    expect(rows).toEqual(permitsFixture);
    expect(socrataRequests.map((r) => r.url.searchParams.get('$offset'))).toEqual([
      '0',
      '15',
      '30',
    ]);
    // Every page carried the same $order, which is what makes offset paging stable.
    for (const r of socrataRequests) {
      expect(r.url.searchParams.get('$order')).toBe(RECORDED_ORDER.permits);
    }
  });

  it('socrata replay: the default page size is the measured 50,000', async () => {
    await socrataQuery('jrea-zgmq', permitsQuery());
    expect(socrataRequests).toHaveLength(1);
    expect(socrataRequests[0]?.url.searchParams.get('$limit')).toBe(String(SOCRATA_PAGE_LIMIT));
  });

  it('socrata replay: an unrecorded $where is refused, never answered with the recorded rows', async () => {
    await expect(
      socrataQuery('jrea-zgmq', {
        $where: "outlet_county_code in ('031')",
        $order: RECORDED_ORDER.permits,
      }),
    ).rejects.toThrow(/501[\s\S]*unrecorded/);
  });

  it('socrata: $order is mandatory and is checked before any request', async () => {
    await expect(socrataQuery('jrea-zgmq', { $where: RECORDED_WHERE.permits })).rejects.toThrow(
      /\$order is required/,
    );
    expect(socrataRequests).toHaveLength(0);
  });

  it('socrata: a dataset id or parameter name outside the allowed shape is refused before any request', async () => {
    // T-3-05: the dataset is one path segment of a constant host and nothing else.
    await expect(socrataQuery('../views/x', permitsQuery())).rejects.toThrow(/dataset id/);
    await expect(socrataQuery('jrea-zgmq.json?x=1', permitsQuery())).rejects.toThrow(/dataset id/);
    await expect(socrataQuery('jrea-zgmq', { ...permitsQuery(), '$where&x': '1' })).rejects.toThrow(
      /parameter name/,
    );
    expect(socrataRequests).toHaveLength(0);
  });

  it('socrata rows updated at: epoch seconds become the ISO source version', async () => {
    // 1789805121 was recorded with the permits page; 03-RESEARCH records the same instant.
    await expect(socrataRowsUpdatedAt('jrea-zgmq')).resolves.toBe('2026-09-19T08:05:21.000Z');
    await expect(socrataRowsUpdatedAt('3kx8-uryv')).resolves.toBe('2026-09-21T15:48:35.000Z');
  });

  it('socrata 400 echoes the SoQL error body', async () => {
    // The recorded 400 is the string-prefix predicate against the NUMBER column. "request
    // failed" alone sent an earlier reader looking at the network; the SoQL message is the
    // diagnosis, so it must survive into the thrown error.
    failNextSocrataWithTypeMismatch();
    const failure = socrataQuery('jrea-zgmq', permitsQuery()).then(
      () => null,
      (e: unknown) => e,
    );
    const error = await failure;
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('400');
    expect(message).toContain('query.soql.type-mismatch');
    // A substring of the RECORDED body, not a string this test made up.
    expect(message).toContain(typeMismatchEnvelope.body.slice(0, 120));

    // Positive control: the one-shot is spent and the same query now succeeds.
    await expect(socrataQuery('jrea-zgmq', permitsQuery())).resolves.toHaveLength(
      permitsFixture.length,
    );
  });
});

// ─── The two dataset transforms ──────────────────────────────────────────────────────────

const SOURCE_VERSION = '2026-09-19T08:05:21.000Z';
const CLUSTERS = clustersJson.clusters;

function permitRow(taxpayer: string, outlet: string) {
  const raw = permitsFixture.find(
    (r) => r.taxpayer_number === taxpayer && r.outlet_number === outlet,
  );
  if (!raw) throw new Error(`fixture lost permit row ${taxpayer}-${outlet}`);
  return raw;
}

function closureRow(tp: string, loc: string) {
  const raw = closuresFixture.find((r) => r.tp_number === tp && r.loc_number === loc);
  if (!raw) throw new Error(`fixture lost closure row ${tp}-${loc}`);
  return raw;
}

describe('jrea-zgmq: active sales tax permits', () => {
  it('comptroller row: a real row parses and becomes a tx_comptroller source record', () => {
    const raw = permitRow('32006170057', '5');
    const row = permitRowSchema.parse(raw);

    // 🔴 The payload sends the NUMBER column as a JSON string; it must stay a string.
    expect(raw.outlet_naics_code).toBe('561311');
    expect(row.outlet_naics_code).toBe('561311');

    const record = comptrollerRowToSourceRecord(row, SOURCE_VERSION, CLUSTERS);
    expect(record).toMatchObject({
      sourceKey: 'tx_comptroller',
      externalId: '32006170057-5',
      sourceVersion: SOURCE_VERSION,
      retentionClass: 'durable',
      legalName: 'PATTI ZIMMY HAIR REPLACEMENT SPECIALIST',
      street: '2426 E TYLER AVE STE 1C',
      city: 'HARLINGEN',
      postal: '78550',
      countyCode: 31,
      naics: '561311',
      // 561311 (employment placement) is in none of the four clusters.
      clusterKey: null,
    });
  });

  it('comptroller row: every recorded row parses, and a numeric NAICS is coerced to a string', () => {
    for (const raw of permitsFixture) {
      const parsed = permitRowSchema.safeParse(raw);
      expect(parsed.success, `${raw.taxpayer_number}-${raw.outlet_number}`).toBe(true);
    }
    // Two-sided: the column's declared type is `number`, so the other arrival is covered too.
    const asNumber = { ...permitRow('32006170057', '5'), outlet_naics_code: 561311 };
    expect(permitRowSchema.parse(asNumber).outlet_naics_code).toBe('561311');
  });

  it('comptroller row: the location is outlet_address, never the taxpayer mailing address', () => {
    // A real row whose taxpayer_address is a PO box and whose outlet_address is the shop.
    const raw = permitRow('32006259231', '1');
    expect(raw.taxpayer_address).toBe('PO BOX 1502');

    const record = comptrollerRowToSourceRecord(
      permitRowSchema.parse(raw),
      SOURCE_VERSION,
      CLUSTERS,
    );
    expect(record.street).toBe('34389 OLD ALICE RD');
    // zod strips every column the transform does not read, so the mailing address cannot
    // ride into the durable payload by accident.
    expect(JSON.stringify(record.payload)).not.toContain('PO BOX 1502');
    expect(Object.keys(record.payload)).not.toContain('taxpayer_address');
    expect(Object.keys(record.payload)).not.toContain('taxpayer_name');
  });

  it('comptroller row: the cluster comes from the seeded half-open ranges passed in', () => {
    const food = comptrollerRowToSourceRecord(
      permitRowSchema.parse(permitRow('32006204898', '2')), // 722410
      SOURCE_VERSION,
      CLUSTERS,
    );
    expect(food.clusterKey).toBe('food_hospitality');

    const personalCare = comptrollerRowToSourceRecord(
      permitRowSchema.parse(permitRow('32006175239', '1')), // 812113
      SOURCE_VERSION,
      CLUSTERS,
    );
    expect(personalCare.clusterKey).toBe('personal_care_health');

    // Not hard-coded in the module: the same row against different ranges resolves
    // differently. `hi` is EXCLUSIVE, so a range ending at 722410 does not contain it.
    const edge = [{ key: 'edge', naicsRanges: [{ lo: 722000, hi: 722410 }] }];
    expect(
      comptrollerRowToSourceRecord(
        permitRowSchema.parse(permitRow('32006204898', '2')),
        SOURCE_VERSION,
        edge,
      ).clusterKey,
    ).toBeNull();
    const inclusiveLo = [{ key: 'lo', naicsRanges: [{ lo: 722410, hi: 722411 }] }];
    expect(
      comptrollerRowToSourceRecord(
        permitRowSchema.parse(permitRow('32006204898', '2')),
        SOURCE_VERSION,
        inclusiveLo,
      ).clusterKey,
    ).toBe('lo');
  });

  it('comptroller row: the RGV permits request uses the PADDED county codes', () => {
    expect(PERMITS_DATASET).toBe('jrea-zgmq');
    expect(PERMITS_RGV_WHERE).toBe("outlet_county_code in ('031','108','214','245')");
  });

  it('canonical hash: key order does not change the payload hash, a value does', () => {
    const row = permitRowSchema.parse(permitRow('32006170057', '5'));
    const reversed = Object.fromEntries(Object.entries(row).reverse()) as typeof row;
    // Prove the two objects really do serialise differently under a naive stringify.
    expect(JSON.stringify(reversed)).not.toBe(JSON.stringify(row));

    expect(payloadHash(reversed)).toBe(payloadHash(row));
    expect(comptrollerRowToSourceRecord(reversed, SOURCE_VERSION, CLUSTERS).payloadHash).toBe(
      comptrollerRowToSourceRecord(row, SOURCE_VERSION, CLUSTERS).payloadHash,
    );
    expect(payloadHash(row)).toMatch(/^[0-9a-f]{64}$/);

    // Two-sided: a hash that ignored its input would pass everything above.
    const moved = { ...row, outlet_address: '2426 E TYLER AVE STE 1D' };
    expect(payloadHash(moved)).not.toBe(payloadHash(row));
  });
});

describe('3kx8-uryv: the closure feed', () => {
  it('unpadded county: the two formatters differ for county 31, and each dataset uses its own', () => {
    expect(paddedCountyCode(31)).toBe('031');
    expect(unpaddedCountyCode(31)).toBe('31');
    expect(paddedCountyCode(31)).not.toBe(unpaddedCountyCode(31));

    expect(RGV_PADDED_COUNTY_CODES[0]).toBe('031');
    expect(RGV_UNPADDED_COUNTY_CODES[0]).toBe('31');
    // T-3-04: the county lists are literals, exactly these four, in this order.
    expect([...RGV_PADDED_COUNTY_CODES]).toEqual(['031', '108', '214', '245']);
    expect([...RGV_UNPADDED_COUNTY_CODES]).toEqual(['31', '108', '214', '245']);

    // The closure request built from them: unpadded, closures only.
    expect(CLOSURES_DATASET).toBe('3kx8-uryv');
    expect(CLOSURES_RGV_WHERE).toBe(
      "loc_county in ('31','108','214','245') and out_of_business_date IS NOT NULL",
    );
    expect(CLOSURES_RGV_WHERE).not.toContain("'031'");

    // And the recorded page really is unpadded: every loc_county, not one zero-led.
    expect(closuresFixture.every((r) => !r.loc_county.startsWith('0'))).toBe(true);
  });

  it('unpadded county: a padded loc_county is refused by the closure schema', () => {
    const raw = closureRow('32006181989', '2');
    expect(closureRowSchema.safeParse(raw).success).toBe(true);
    expect(closureRowSchema.safeParse({ ...raw, loc_county: '031' }).success).toBe(false);
  });

  it('closure row: the join key equals the permits feed key for the same business', () => {
    // The verified join row is ACTIVE: it is in the closure page only because the recorded
    // $where ORs it in, and it carries no out_of_business_date. The key shape is what D-03's
    // exact match rests on, and both transforms build it the same way.
    const permit = comptrollerRowToSourceRecord(
      permitRowSchema.parse(permitRow('32006170057', '5')),
      SOURCE_VERSION,
      CLUSTERS,
    );
    const active = closureRow('32006170057', '5');
    expect(active).not.toHaveProperty('out_of_business_date');
    expect(`${active.tp_number}-${active.loc_number}`).toBe(permit.externalId);

    // An open location is not a closure: the closure schema refuses it, on that field.
    const refused = closureRowSchema.safeParse(active);
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((i) => i.path.join('.'))).toContain('out_of_business_date');

    // Every other recorded row is a real closure and parses.
    const closed = closuresFixture.filter((r) => r !== active);
    expect(closed).toHaveLength(49);
    for (const raw of closed) {
      expect(closureRowSchema.safeParse(raw).success, `${raw.tp_number}-${raw.loc_number}`).toBe(
        true,
      );
    }
  });

  it('closure row parses in America/Chicago', () => {
    // 🔴 `out_of_business_date` arrives as "2022-12-31T00:00:00.000" — NO zone suffix. It is
    // a Texas business date. The suite runs with TZ=UTC, so a parse that fell back to the
    // process zone lands on UTC midnight here and the assertions below go red.
    const raw = closureRow('32006197027', '1');
    expect(raw.out_of_business_date).toBe('2022-12-31T00:00:00.000');

    const record = closureRowToSourceRecord(closureRowSchema.parse(raw), SOURCE_VERSION);
    expect(record).toMatchObject({
      sourceKey: 'tx_comptroller_closures',
      externalId: '32006197027-1',
      sourceVersion: SOURCE_VERSION,
      retentionClass: 'durable',
      legalName: 'CLIMA CONTROL',
      countyCode: 108,
    });
    // Chicago midnight in CST is 06:00Z.
    expect(record.closedAt.toISOString()).toBe('2022-12-31T06:00:00.000Z');
    expect(localDate(record.closedAt, 'America/Chicago')).toBe('2022-12-31');

    // ONE instant, TWO zones, OPPOSITE verdicts: the naive UTC reading of the same string.
    // In UTC it is still New Year's Eve; in Chicago it is the day before — a closure that
    // lands a day (here, a year) early.
    const naiveUtc = new Date(`${raw.out_of_business_date}Z`);
    expect(localDate(naiveUtc, 'UTC')).toBe('2022-12-31');
    expect(localDate(naiveUtc, 'America/Chicago')).toBe('2022-12-30');
    expect(record.closedAt.getTime()).not.toBe(naiveUtc.getTime());

    // And the offset follows DST: a CDT closure date is 05:00Z, not 06:00Z.
    const summer = closureRowToSourceRecord(
      closureRowSchema.parse(closureRow('32006181989', '2')), // 2024-03-30, after the switch
      SOURCE_VERSION,
    );
    expect(summer.closedAt.toISOString()).toBe('2024-03-30T05:00:00.000Z');
  });

  it('closure row: a date carrying a zone suffix is refused rather than reinterpreted', () => {
    const raw = closureRow('32006197027', '1');
    expect(
      closureRowSchema.safeParse({ ...raw, out_of_business_date: '2022-12-31T00:00:00.000Z' })
        .success,
    ).toBe(false);
  });
});
