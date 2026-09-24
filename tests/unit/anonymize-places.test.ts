/**
 * D-20 / D-01 / D-04: the recorder's anonymizer and its guards (plan 04-19). The recorder itself
 * makes real, billed Google calls and is NOT run by any test — these are the pure parts it is
 * built from, and each refusal it depends on.
 *
 * The input page below is hand-built to LOOK real (every string is distinctive and made up here);
 * no Google-authored text is in this file.
 */
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hostClass } from '@/lib/places/host-class';
import { FIXTURES_DIR, writeRecording } from '../../scripts/record-places-fixtures';
import {
  anonymizePage,
  assertAnonymizedPage,
  type AnonymizeContext,
} from '../../scripts/lib/anonymize-places';
import {
  MAX_RECORD_REQUESTS,
  assertLegalRecord,
  assertLocalTarget,
  parseRecordArgs,
} from '../../scripts/lib/record-guard';

const RECT = { south: 26.15, west: -98.3, north: 26.3, east: -98.18 };
const CTX: AnonymizeContext = { rect: RECT, city: 'McAllen', placesType: 'plumber', page: 1 };

type Place = Record<string, unknown>;

/** Twenty places that look like a real page: names, addresses, phones, URLs, pins, ratings. */
function realLookingPage(): { places: Place[]; nextPageToken: string } {
  const websites = [
    'https://acmeplumbing-real.com',
    'https://www.facebook.com/acme-real',
    undefined,
    'https://acme-real.business.site',
    'https://www.yelp.com/biz/acme-real-mcallen',
    'https://acmereal.wixsite.com/home',
    'not a url at all REAL',
  ];
  const places: Place[] = [];
  for (let i = 0; i < 20; i++) {
    const p: Place = {
      id: `ChIJrealLooking${String(i).padStart(2, '0')}_xY-z`,
      displayName: { text: `REAL-LOOKING Business ${i}`, languageCode: 'en' },
      formattedAddress: `${4300 + i} N Real Rd, McAllen, TX 78504, USA`,
      location: { latitude: 26.22221 + i / 1000, longitude: -98.23331 },
      types: ['plumber', 'point_of_interest', 'establishment'],
      businessStatus: 'OPERATIONAL',
      nationalPhoneNumber: `(956) 686-${String(1200 + i)}`,
      rating: 4.7,
      userRatingCount: 123 + i,
      googleMapsUri: `https://maps.google.com/?cid=REALCID${i}`,
    };
    const site = websites[i % websites.length];
    if (site !== undefined) p.websiteUri = site;
    places.push(p);
  }
  // Place 0: the plan's named distinctive strings.
  places[0] = {
    ...places[0],
    displayName: { text: 'REAL-LOOKING Acme Plumbing', languageCode: 'en' },
    formattedAddress: '4321 N Real Rd, McAllen, TX 78504, USA',
    nationalPhoneNumber: '(956) 686-1234',
    websiteUri: 'https://acmeplumbing-real.com',
  };
  // Place 1: a pure service-area business — no address, no pin, a Facebook page.
  places[1] = {
    id: 'ChIJrealSab01',
    displayName: { text: 'REAL-LOOKING Acme Mobile Locksmith' },
    types: ['locksmith'],
    pureServiceAreaBusiness: true,
    nationalPhoneNumber: '(956) 686-9876',
    websiteUri: 'https://www.facebook.com/acme-real',
  };
  // Place 2: across the river.
  places[2] = {
    ...places[2],
    formattedAddress: 'Calle Real 12, Reynosa, Tamps., Mexico',
  };
  return { places, nextPageToken: 'REAL-TOKEN-AaBbCc123' };
}

const DISTINCTIVE = [
  'REAL-LOOKING',
  'Acme',
  'Real Rd',
  '78504',
  '686-',
  'acmeplumbing-real',
  'acme-real',
  'acmereal',
  'REALCID',
  'Reynosa',
  'REAL-TOKEN',
  'languageCode',
  'googleMapsUri',
  '26.2222',
  '-98.2333',
  '4.7',
];

type Out = { places: Place[]; nextPageToken?: string };

describe('the anonymizer (D-20)', () => {
  it('the anonymizer keeps structure and drops every Google string', () => {
    const input = realLookingPage();
    const out = anonymizePage(input, CTX) as Out;

    expect(out.places).toHaveLength(20);
    expect(out.places.map((p) => p.id)).toEqual(input.places.map((p) => p.id));
    expect(out.places.map((p) => p.pureServiceAreaBusiness)).toEqual(
      input.places.map((p) => p.pureServiceAreaBusiness),
    );
    // 2026-09-23: Google's own enums are no longer kept — the input carries them, the twin never.
    expect(input.places.some((p) => p.types !== undefined)).toBe(true);
    expect(input.places.some((p) => p.businessStatus !== undefined)).toBe(true);
    for (const p of out.places) {
      expect(p).not.toHaveProperty('types');
      expect(p).not.toHaveProperty('businessStatus');
    }
    expect(out.places.map((p) => hostClass(p.websiteUri as string | undefined))).toEqual(
      input.places.map((p) => hostClass(p.websiteUri as string | undefined)),
    );
    // Every host class survives, and "absent" (none) stays absent.
    expect(new Set(out.places.map((p) => hostClass(p.websiteUri as string | undefined)))).toEqual(
      new Set(['none', 'other', 'social', 'business_site_dead', 'directory', 'platform_subdomain']),
    );
    expect(out.nextPageToken).toBe('recorded:p2');

    const text = JSON.stringify(out);
    for (const s of DISTINCTIVE) expect(text, s).not.toContain(s);

    // A last page: no token in, no token out.
    const last = anonymizePage({ places: input.places.slice(0, 3) }, { ...CTX, page: 3 });
    expect(last).not.toHaveProperty('nextPageToken');
  });

  it('the anonymizer places every location inside the searched rectangle', () => {
    const input = realLookingPage();
    const a = anonymizePage(input, CTX) as Out;
    const b = anonymizePage(input, CTX) as Out;

    for (const [i, p] of a.places.entries()) {
      const had = input.places[i]?.location !== undefined;
      expect(p.location !== undefined, `place ${i}`).toBe(had);
      if (!had) continue;
      const { latitude, longitude } = p.location as { latitude: number; longitude: number };
      expect(latitude).toBeGreaterThan(RECT.south);
      expect(latitude).toBeLessThan(RECT.north);
      expect(longitude).toBeGreaterThan(RECT.west);
      expect(longitude).toBeLessThan(RECT.east);
      expect(Math.round(latitude * 1e4) / 1e4).toBe(latitude);
      expect(Math.round(longitude * 1e4) / 1e4).toBe(longitude);
      // The real pin never survives.
      expect(p.location).not.toEqual(input.places[i]?.location);
    }
    // Deterministic per id: the same page twice gives the same points…
    expect(b.places.map((p) => p.location)).toEqual(a.places.map((p) => p.location));
    // …and the point follows the id, not the position: a reordered page moves nothing.
    const reversed = anonymizePage({ places: [...input.places].reverse() }, CTX) as Out;
    const byId = new Map(reversed.places.map((p) => [p.id, p.location]));
    for (const p of a.places) expect(byId.get(p.id)).toEqual(p.location);
    // Distinct places land on distinct points.
    const located = a.places.filter((p) => p.location !== undefined);
    expect(new Set(located.map((p) => JSON.stringify(p.location))).size).toBe(located.length);
    // A service-area business stays pinless.
    expect(a.places[1]).not.toHaveProperty('location');
    expect(a.places[1]).not.toHaveProperty('formattedAddress');
    expect(a.places[1]?.pureServiceAreaBusiness).toBe(true);
  });

  it('the anonymizer synthesizes ratings', () => {
    const input = realLookingPage();
    const out = anonymizePage(input, CTX) as Out;
    for (const [i, p] of out.places.entries()) {
      const had = input.places[i]?.rating !== undefined;
      expect(p.rating, `place ${i}`).toBe(had ? 4 : undefined);
      expect(p.userRatingCount, `place ${i}`).toBe(had ? 10 : undefined);
    }
    // The SAB carried neither, and stays without.
    expect(out.places[1]).not.toHaveProperty('rating');
    expect(out.places[1]).not.toHaveProperty('userRatingCount');
  });

  it('the anonymizer keeps a foreign listing foreign', () => {
    const out = anonymizePage(realLookingPage(), CTX) as Out;
    const foreign = out.places[2]?.formattedAddress as string;
    expect(foreign.split(',').pop()?.trim()).not.toBe('USA');
    expect(foreign).toBe('003 Calle Sintetica, Synthetic, Mexico');
    const domestic = out.places[0]?.formattedAddress as string;
    expect(domestic).toBe('001 Synthetic St, McAllen, TX 78500, USA');
  });

  it('the anonymizer is a fixpoint, so the recorder can anonymize again as it writes', () => {
    const input = realLookingPage();
    for (const page of [1, 2] as const) {
      const once = anonymizePage(input, { ...CTX, page });
      expect(anonymizePage(once, { ...CTX, page })).toEqual(once);
    }
  });

  it("the anonymizer's output passes the write-time check and a raw page does not", () => {
    const input = realLookingPage();
    expect(() => assertAnonymizedPage(anonymizePage(input, CTX))).not.toThrow();
    let message = '';
    try {
      assertAnonymizedPage(input);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/assertAnonymizedPage: page/);
    // The refusal names a key, never a value.
    for (const s of DISTINCTIVE.slice(0, 11)) expect(message).not.toContain(s);
    // Each synthetic field is checked on its own: one real phone slipped into an otherwise
    // anonymized page is refused.
    const one = anonymizePage(input, CTX) as Out;
    (one.places[4] as Place).nationalPhoneNumber = '(956) 686-1204';
    expect(() => assertAnonymizedPage(one)).toThrow(/place 4 nationalPhoneNumber/);
  });

  it('a fixture carrying types or businessStatus is refused', () => {
    // Otherwise a perfectly anonymized page: the only fault is the one key.
    const clean = anonymizePage(realLookingPage(), CTX) as Out;
    expect(() => assertAnonymizedPage(clean)).not.toThrow();
    for (const [key, value] of [
      ['types', ['plumber']],
      ['businessStatus', 'OPERATIONAL'],
    ] as const) {
      const page = structuredClone(clean);
      (page.places[3] as Place)[key] = value;
      expect(() => assertAnonymizedPage(page), key).toThrow(
        new RegExp(`place 3 carries ${key}, which no fixture may hold`),
      );
      // Named by key, never by value.
      expect(() => assertAnonymizedPage(page), key).not.toThrow(/plumber|OPERATIONAL/);
    }
  });

  it('the anonymizer refuses an id outside the place-id alphabet, without echoing it', () => {
    const page = { places: [{ id: 'places/REAL Acme Plumbing' }] };
    expect(() => anonymizePage(page, CTX)).toThrow(/place 0 id is not a place id/);
    expect(() => anonymizePage(page, CTX)).not.toThrow(/Acme/);
  });
});

const PROJECT_HEAD =
  '# Siteless\n\n## Core Value\n\nText.\n\n## Key Decisions\n\n| Decision | Rationale | Outcome |\n|---|---|---|\n| Overture is primary | free | — Pending |\n';
const PROJECT_TAIL =
  '\n## Evolution\n\nD-01 Places legal gate — counsel-yes (mentioned outside the table)\n';

function projectWith(row: string): string {
  return PROJECT_HEAD + row + '\n' + PROJECT_TAIL;
}

const LOCAL = 'postgres://postgres:pw@localhost:54322/siteless_test';

describe('the recorder guards (D-01, D-04)', () => {
  it('the recorder refuses without the D-01 record', () => {
    // No row in the table (a mention elsewhere in the file does not count).
    expect(() => assertLegalRecord(projectWith(''))).toThrow(/no D-01 Places row/);
    // A D-01 row about something else.
    expect(() => assertLegalRecord(projectWith('| D-01 hosting | x | y |'))).toThrow(
      /no D-01 Places row/,
    );
    // Recorded as no.
    expect(() =>
      assertLegalRecord(projectWith('| D-01 Places legal gate — no | counsel said no | Blocked |')),
    ).toThrow(/recorded as NO/);
    // An answer the guard cannot read refuses rather than guessing.
    expect(() =>
      assertLegalRecord(projectWith('| D-01 Places legal gate — probably fine | … | ok |')),
    ).toThrow(/Refusing rather than guessing/);
    // The two answers 04-29 can write.
    expect(() =>
      assertLegalRecord(
        projectWith(
          '| D-01 Places legal gate — counsel-yes | "verbatim answer" | Decided 2026-10-01 |',
        ),
      ),
    ).not.toThrow();
    expect(() =>
      assertLegalRecord(
        projectWith('| D-01 Places legal gate — danlo-risk-call | "verbatim call" | Decided |'),
      ),
    ).not.toThrow();
  });

  it('the recorder refuses any target but the local database', () => {
    expect(() => assertLocalTarget('prod', LOCAL)).toThrow(/local test database only/);
    expect(() =>
      assertLocalTarget(
        'test',
        'postgres://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
      ),
    ).toThrow(/Supabase host/);
    expect(() => assertLocalTarget('test', 'postgres://u:p@db.example.net:5432/x')).toThrow(
      /not local/,
    );
    expect(() => assertLocalTarget('test', undefined)).toThrow(/not set/);
    expect(() => assertLocalTarget('test', LOCAL)).not.toThrow();
    expect(() =>
      assertLocalTarget('test', 'postgres://app_user:pw@127.0.0.1:5432/x'),
    ).not.toThrow();
    // The URL carries a password: never echoed.
    expect(() => assertLocalTarget('test', 'postgres://u:SECRETPW@db.example.net/x')).not.toThrow(
      /SECRETPW/,
    );
  });

  const BASE = [
    '--version=0b6f1c2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f',
    '--type=plumber',
    '--unit=city:48215/McAllen',
  ];

  it('the recorder caps its requests', () => {
    expect(MAX_RECORD_REQUESTS).toBe(10);
    expect(() => parseRecordArgs([...BASE, '--out=x', '--max-requests=11'])).toThrow(/1\.\.10/);
    expect(() => parseRecordArgs([...BASE, '--out=x', '--max-requests=0'])).toThrow(/1\.\.10/);
    expect(parseRecordArgs([...BASE, '--out=x', '--max-requests=10']).maxRequests).toBe(10);
    expect(parseRecordArgs([...BASE, '--out=mcallen-plumber', '--max-requests=3'])).toEqual({
      version: '0b6f1c2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f',
      type: 'plumber',
      unit: 'city:48215/McAllen',
      maxRequests: 3,
      out: 'mcallen-plumber',
      idsOnly: false,
    });
    // A billed recording with nowhere to write is refused; so are typos and repeats.
    expect(() => parseRecordArgs([...BASE])).toThrow(/needs --out/);
    expect(() => parseRecordArgs([...BASE, '--out=x', '--max-request=3'])).toThrow(
      /unknown argument/,
    );
    expect(() => parseRecordArgs([...BASE, '--out=x', '--out=y'])).toThrow(/given twice/);
    expect(() => parseRecordArgs([...BASE, '--out=../../etc'])).toThrow(/basename/);
    expect(() =>
      parseRecordArgs(['--type=general_contractor', ...BASE.slice(0, 1), BASE[2]!, '--out=x']),
    ).toThrow(/Table A/);
  });

  it("the recorder's ids-only mode is one free call", () => {
    expect(parseRecordArgs(['--ids-only', ...BASE])).toMatchObject({
      idsOnly: true,
      maxRequests: 1,
    });
    expect(parseRecordArgs(['--ids-only', '--max-requests=1', ...BASE])).toMatchObject({
      idsOnly: true,
      maxRequests: 1,
    });
    expect(() => parseRecordArgs(['--ids-only', '--max-requests=2', ...BASE])).toThrow(
      /exactly one request/,
    );
    // No fixture unless --out is also given.
    expect(parseRecordArgs(['--ids-only', ...BASE])).not.toHaveProperty('out');
  });

  it('the recorder writes only anonymized pages and marks them in the sidecar', () => {
    // A scratch copy of the fixtures' sidecar — the real directory is never written by a test.
    const dir = mkdtempSync(join(tmpdir(), 'siteless-record-'));
    try {
      copyFileSync(
        new URL('places-recordings.json', FIXTURES_DIR),
        join(dir, 'places-recordings.json'),
      );
      const dirUrl = pathToFileURL(dir + '/');
      const input = realLookingPage();
      const anonymize = { rect: RECT, city: 'McAllen', placesType: 'plumber' };
      // Page 1 as the loop keeps it (anonymized); page 2 handed over RAW, as a regressed loop
      // would — the write line anonymizes it anyway.
      const pages = [anonymizePage(input, CTX), { places: input.places.slice(0, 5) }];

      const names = writeRecording(
        {
          out: 'unit-test',
          pages,
          anonymize,
          requests: 2,
          truncatedByCap: false,
          recordedAt: '2026-09-23T00:00:00.000Z',
          purpose: 'unit test',
        },
        dirUrl,
      );

      expect(names).toEqual([
        'places-recorded-unit-test-p1.json',
        'places-recorded-unit-test-p2.json',
      ]);
      for (const name of names) {
        const text = readFileSync(join(dir, name), 'utf8');
        for (const s of DISTINCTIVE) expect(text, `${name}: ${s}`).not.toContain(s);
        expect(() => assertAnonymizedPage(JSON.parse(text))).not.toThrow();
      }
      const sidecar = JSON.parse(readFileSync(join(dir, 'places-recordings.json'), 'utf8'));
      expect(sidecar.anonymized).toBe(true);
      expect(sidecar.files['places-recorded-unit-test-p1.json']).toMatchObject({
        places: 20,
        nextPageToken: true,
        synthetic: false,
        anonymized: true,
        recordedAt: '2026-09-23T00:00:00.000Z',
        requests: 2,
      });
      expect(sidecar.files['places-recorded-unit-test-p2.json']).toMatchObject({
        places: 5,
        nextPageToken: false,
      });
      // Never overwritten.
      expect(() =>
        writeRecording(
          {
            out: 'unit-test',
            pages: pages.slice(0, 1),
            anonymize,
            requests: 1,
            truncatedByCap: false,
            recordedAt: 'x',
            purpose: 'again',
          },
          dirUrl,
        ),
      ).toThrow(/already exists/);
      expect(readdirSync(dir).sort()).toEqual([...names, 'places-recordings.json'].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
