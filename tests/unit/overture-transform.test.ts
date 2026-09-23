/**
 * DATA-02: the Overture transform, driven entirely by the committed JSON fixture
 * `tests/unit/fixtures/overture-rgv-sample.json` (193 real rows of release 2026-08-19.0, cut by
 * `tsx scripts/ingest-overture.ts --sample`). No DuckDB and no S3 in this file's import graph:
 * CI needs no native binary to run it (T-3-14).
 *
 * The five named tests from 03-13-PLAN, each paired with a positive control so a transform that
 * rejects everything (or a matcher that never fires) cannot pass them:
 *
 *   texas side filter      — mutation M23 (drop the country half) reds it, and the DB test
 *                            `a naive-RGV-bbox radius search returns no Mexican-side row`
 *   duckdb list shape      — `.items`, never the bare list
 *   geometry not bbox      — ST_X/ST_Y is stored, the float32 bbox struct never is
 *   basic_category only    — a grep gate over src/lib/overture/ and the desk script
 *   release recorded       — every record carries the release it was read from
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isSkipped,
  OVERTURE_RGV_BBOX,
  overtureRowToSourceRecord,
  type OvertureSourceRecord,
  type OvertureTransformResult,
} from '@/lib/overture/transform';

// ---------------------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------------------

interface NodeApiList {
  items: Array<string | null>;
}

interface FixtureRow {
  _why: string;
  id: string;
  name_primary: string | null;
  basic_category: string | null;
  taxonomy_primary: string | null;
  confidence: number | null;
  operating_status: string | null;
  websites: NodeApiList;
  socials: NodeApiList;
  phones: NodeApiList;
  emails: NodeApiList;
  street: string | null;
  locality: string | null;
  postcode: string | null;
  region: string | null;
  country: string | null;
  lon: number;
  lat: number;
  version: number | null;
  bbox: { xmin: number; xmax: number; ymin: number; ymax: number };
}

interface FixtureMeta {
  release: string;
  bbox: typeof OVERTURE_RGV_BBOX;
  rowCount: number;
}

const FIXTURE_PATH = 'tests/unit/fixtures/overture-rgv-sample.json';
const ENTRIES = JSON.parse(nodeFs.readFileSync(FIXTURE_PATH, 'utf8')) as Array<
  FixtureRow | { _meta: FixtureMeta }
>;
const META = (ENTRIES[0] as { _meta: FixtureMeta })._meta;
const ROWS = ENTRIES.filter((e): e is FixtureRow => !('_meta' in e));
const RELEASE = META.release;

const isTexasRow = (r: FixtureRow) => r.country === 'US' && r.region === 'TX';
const byWhy = (why: string) => ROWS.filter((r) => r._why === why);

function record(r: OvertureTransformResult): OvertureSourceRecord {
  if (isSkipped(r)) throw new Error(`expected a record, got skipped: ${r.skipped} (${r.id})`);
  return r;
}

const transform = (row: unknown, release = RELEASE) => overtureRowToSourceRecord(row, release);

// ---------------------------------------------------------------------------------------

describe('the fixture itself', () => {
  it('overture fixture carries its provenance and every branch', () => {
    expect(RELEASE).toBe('2026-08-19.0');
    expect(META.bbox).toEqual(OVERTURE_RGV_BBOX);
    expect(ROWS.length).toBe(META.rowCount);
    expect(ROWS.length).toBeGreaterThanOrEqual(150);
    for (const why of [
      'all_fields',
      'basic_category_null',
      'permanently_closed',
      'no_phone',
      'phone_e164',
      'phone_bare10',
      'phone_bare11',
      'phone_other',
      'toll_free_shared',
      'junk_postcode',
      'mx_region_tx',
      'mx_reynosa',
      'mx_matamoros',
      'mx_rio_bravo',
      'us_region_missing',
    ]) {
      expect(byWhy(why).length, why).toBeGreaterThan(0);
    }
  });
});

describe('DATA-02: overtureRowToSourceRecord', () => {
  it('texas side filter', () => {
    // Every Mexican-side row — Reynosa, Matamoros, Río Bravo and the rest — is turned away.
    const mexican = ROWS.filter((r) => r.country === 'MX');
    expect(mexican.length).toBeGreaterThanOrEqual(15);
    for (const city of ['Reynosa', 'Matamoros', 'Río Bravo']) {
      expect(mexican.some((r) => r.locality === city), city).toBe(true);
    }
    for (const r of mexican) {
      expect(transform(r), `${r.locality} ${r.id}`).toEqual({ skipped: 'not_texas', id: r.id });
    }

    // 🔴 The rows that make both halves load-bearing: country MX, region TX. A region-only
    // filter (M23) admits every one of them. One of them sits in Pharr — a real US city that
    // Overture tags MX — and the country half still drops it: that is the measured trade.
    const mxTx = ROWS.filter((r) => r.country === 'MX' && r.region === 'TX');
    expect(mxTx.length).toBeGreaterThanOrEqual(1);
    for (const r of mxTx) {
      expect(transform(r)).toEqual({ skipped: 'not_texas', id: r.id });
    }

    // US rows with a NULL or '' region are dropped too (the 0.3 % trade, 03-RESEARCH).
    const noRegion = ROWS.filter((r) => r.country === 'US' && (r.region === null || r.region === ''));
    expect(noRegion.length).toBeGreaterThan(0);
    for (const r of noRegion) expect(transform(r)).toEqual({ skipped: 'not_texas', id: r.id });
  });

  it('texas side filter positive control: every named US/TX row is kept', () => {
    // A filter that rejects everything passes the test above perfectly. This one fails it.
    const texas = ROWS.filter((r) => isTexasRow(r) && (r.name_primary ?? '').trim() !== '');
    expect(texas.length).toBeGreaterThanOrEqual(150);
    for (const r of texas) {
      const out = record(transform(r));
      expect(out.externalId).toBe(r.id);
      expect(out.payload.country).toBe('US');
      expect(out.payload.region).toBe('TX');
    }
  });

  it('duckdb list shape', () => {
    const row = byWhy('all_fields')[0]!;
    // 🔴 The defect, made explicit: DuckDB's node-api returns VARCHAR[] as { items }, so a
    // bare-array read is `undefined` on every row.
    expect((row.phones as unknown as string[])[0]).toBeUndefined();
    expect(typeof row.phones.items[0]).toBe('string');

    const out = record(transform(row));
    expect(out.derived.phoneE164).toMatch(/^\+1\d{10}$/);
    expect(out.payload.phones).toEqual(row.phones.items);
    expect(out.payload.websites).toEqual(row.websites.items);
    expect(out.payload.socials).toEqual(row.socials.items);
    expect(out.payload.emails).toEqual(row.emails.items);
    expect(out.payload.websites.length).toBeGreaterThan(0);
    expect(out.payload.socials.length).toBeGreaterThan(0);

    // A reader that switched to a JSON-converting accessor hands over bare arrays. That is
    // refused as malformed — never silently ingested as "no phone, no website".
    const bare = {
      ...row,
      phones: row.phones.items,
      websites: row.websites.items,
      socials: row.socials.items,
      emails: row.emails.items,
    };
    expect(transform(bare)).toEqual({ skipped: 'malformed', id: row.id });

    // Across the whole Texas side: every row with a phone string emits a phone.
    const withPhone = ROWS.filter(
      (r) => isTexasRow(r) && r.phones.items.some((p) => (p ?? '').trim() !== ''),
    );
    expect(withPhone.length).toBeGreaterThan(100);
    const phoned = withPhone.filter((r) => record(transform(r)).derived.phoneE164 !== null);
    expect(phoned.length).toBe(withPhone.length);
  });

  it('duckdb list shape: the four measured phone forms and the toll-free switchboard', () => {
    for (const why of ['phone_e164', 'phone_bare10', 'phone_bare11', 'phone_other']) {
      for (const r of byWhy(why)) {
        expect(record(transform(r)).derived.phoneE164, `${why} ${r.phones.items[0]}`).toMatch(
          /^\+1\d{10}$/,
        );
      }
    }
    // The number shared by 215 places, in BOTH of its forms: one E.164, and never a
    // blocking key (DEDUP-04, D-07).
    const tollFree = byWhy('toll_free_shared');
    expect(new Set(tollFree.map((r) => r.phones.items[0])).size).toBe(2);
    for (const r of tollFree) {
      const out = record(transform(r));
      expect(out.derived.phoneE164).toBe('+18004879643');
      expect(out.derived.phoneBlockable).toBe(false);
    }
    for (const r of byWhy('no_phone')) {
      const out = record(transform(r));
      expect(out.derived.phoneE164).toBeNull();
      expect(out.derived.phoneBlockable).toBe(false);
    }
  });

  it('geometry not bbox', () => {
    const texas = ROWS.filter(isTexasRow);
    let lngDiffers = 0;
    let latDiffers = 0;
    for (const r of texas) {
      const out = record(transform(r));
      // Exactly ST_X / ST_Y(geometry)…
      expect(out.derived.lng).toBe(r.lon);
      expect(out.derived.lat).toBe(r.lat);
      expect(out.payload.lon).toBe(r.lon);
      expect(out.payload.lat).toBe(r.lat);
      // …and never the float32-rounded bbox struct, wherever the two differ.
      if (r.bbox.xmin !== r.lon) {
        expect(out.derived.lng).not.toBe(r.bbox.xmin);
        lngDiffers += 1;
      }
      if (r.bbox.ymin !== r.lat) {
        expect(out.derived.lat).not.toBe(r.bbox.ymin);
        latDiffers += 1;
      }
      // Axis order: RGV longitudes are negative, latitudes ~26 N.
      expect(out.derived.lng!).toBeLessThan(-97);
      expect(out.derived.lat!).toBeGreaterThan(25.5);
      expect(out.derived.locationMatchType).toBe('overture');
      // The bbox never leaks into what is stored.
      expect(Object.keys(out.payload)).not.toContain('bbox');
    }
    // Non-vacuity: the fixture really does carry rows whose bbox differs from the point.
    expect(lngDiffers).toBeGreaterThan(50);
    expect(latDiffers).toBeGreaterThan(50);
  });

  it('basic_category only', () => {
    const files = [
      ...nodeFs
        .readdirSync('src/lib/overture')
        .filter((f) => /\.(ts|tsx)$/.test(f))
        .map((f) => nodePath.posix.join('src/lib/overture', f)),
      'scripts/ingest-overture.ts',
    ];
    expect(files).toContain('src/lib/overture/transform.ts');

    const TOKEN = /\bcategories\b/;
    // The matcher fires on the read it exists to catch…
    expect(TOKEN.test('categories.primary as category')).toBe(true);
    expect(TOKEN.test("row['categories']")).toBe(true);
    // …and not on the column it must allow.
    expect(TOKEN.test('basic_category')).toBe(false);

    const isComment = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line);
    const offences: string[] = [];
    let readsBasicCategory = 0;
    let commentMentions = 0;
    for (const file of files) {
      const lines = nodeFs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (isComment(line)) {
          if (TOKEN.test(line)) commentMentions += 1;
          return;
        }
        if (line.includes('basic_category')) readsBasicCategory += 1;
        if (TOKEN.test(line)) offences.push(`${file}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offences, offences.join('\n')).toEqual([]);
    // Two-sided: the files really were read (they select and map basic_category), and the
    // comment filter is doing work — the script's header says the legacy struct is removed.
    expect(readsBasicCategory).toBeGreaterThan(2);
    expect(commentMentions).toBeGreaterThan(0);

    // And the emitted record carries basic_category, NULL included.
    for (const r of byWhy('basic_category_null')) {
      expect(record(transform(r)).derived.basicCategory).toBeNull();
    }
    const cat = byWhy('all_fields')[0]!;
    expect(record(transform(cat)).derived.basicCategory).toBe(cat.basic_category);
  });

  it('release recorded', () => {
    const texas = ROWS.filter(isTexasRow);
    for (const release of [RELEASE, '2031-01-07.3']) {
      const records = texas.map((r) => transform(r, release)).filter((r) => !isSkipped(r));
      expect(records.length).toBeGreaterThanOrEqual(150);
      for (const r of records) {
        expect((r as OvertureSourceRecord).sourceVersion).toBe(release);
        expect((r as OvertureSourceRecord).sourceKey).toBe('overture');
        expect((r as OvertureSourceRecord).retentionClass).toBe('durable');
      }
    }
  });
});

describe('DATA-02: the remaining branches', () => {
  it('overture external id is the GERS id verbatim', () => {
    for (const r of ROWS.filter(isTexasRow)) {
      const out = record(transform(r));
      expect(out.externalId).toBe(r.id);
      expect(out.payload.id).toBe(r.id);
    }
  });

  it('overture permanently_closed is stored, not skipped', () => {
    const closed = byWhy('permanently_closed');
    for (const r of closed) {
      expect(record(transform(r)).derived.operatingStatus).toBe('permanently_closed');
    }
  });

  it('overture junk postcode never becomes a ZIP5', () => {
    for (const r of byWhy('junk_postcode')) {
      const out = record(transform(r));
      expect(out.derived.postal).toBeNull();
      expect(out.payload.postcode).toBe(r.postcode);
    }
  });

  it('overture row with no name is skipped as no_name', () => {
    const row = { ...byWhy('all_fields')[0]!, name_primary: '   ' };
    expect(transform(row)).toEqual({ skipped: 'no_name', id: row.id });
    expect(transform({ ...row, name_primary: null })).toEqual({ skipped: 'no_name', id: row.id });
  });

  it('overture malformed rows are named, never thrown', () => {
    expect(transform(null)).toEqual({ skipped: 'malformed' });
    expect(transform({ id: 'x' })).toEqual({ skipped: 'malformed', id: 'x' });
    const row = byWhy('all_fields')[0]!;
    expect(transform({ ...row, lat: null })).toEqual({ skipped: 'malformed', id: row.id });
  });

  it('overture payload is exactly the selected fields', () => {
    const out = record(transform(byWhy('all_fields')[0]!));
    expect(Object.keys(out.payload).sort()).toEqual(
      [
        'basic_category',
        'confidence',
        'country',
        'emails',
        'id',
        'lat',
        'locality',
        'lon',
        'name_primary',
        'operating_status',
        'phones',
        'postcode',
        'region',
        'socials',
        'street',
        'taxonomy_primary',
        'version',
        'websites',
      ].sort(),
    );
  });

  it('no src module imports the DuckDB native binary', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of nodeFs.readdirSync(dir, { withFileTypes: true })) {
        const full = nodePath.posix.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) {
          const text = nodeFs.readFileSync(full, 'utf8');
          if (/from\s+['"]@duckdb\//.test(text) || /import\(\s*['"]@duckdb\//.test(text)) {
            offenders.push(full);
          }
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
    // Two-sided: the desk script DOES import it, so the matcher is proven live.
    expect(/from\s+['"]@duckdb\//.test(nodeFs.readFileSync('scripts/ingest-overture.ts', 'utf8'))).toBe(
      true,
    );
  });
});
