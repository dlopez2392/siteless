/**
 * `scripts/ingest-comptroller.ts` — the Comptroller desk ingest (DATA-01, D-03, D-08, D-11).
 *
 * msw-driven: every request below is answered by `./msw/server.ts` (`onUnhandledRequest:
 * 'error'`) or by a capture handler installed in this file. 🔴 These tests assert on the
 * REQUEST the client was handed, never on a live response — CI never reaches the network.
 */
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  closuresQuery,
  fetchClosures,
  fetchPermits,
  foldClosureDuplicates,
  IngestOrgRequiredError,
  parseIngestArgs,
  permitsQuery,
  permitToIngest,
  seededClusters,
  type ClosureIngest,
} from '../../scripts/ingest-comptroller';
import { nameNorm } from '@/lib/normalize';
import { closureRowToSourceRecord, type ClosureRow } from '@/lib/socrata/closures';
import { fetchStatewideNameFrequency } from '@/lib/socrata/statewide-names';
import closuresPage from './msw/fixtures/socrata-3kx8-page.json';
import socrataRecordings from './msw/fixtures/socrata-recordings.json';
import {
  RECORDED_ORDER,
  RECORDED_WHERE,
  resetSocrata,
  server,
  SOCRATA_ORIGIN,
  startReplayServer,
} from './msw/server';

/**
 * Installs a handler IN FRONT of the shared replay handler that records every
 * `/resource/…` request and answers it with `respond(url)`. For the query-shape tests the
 * answer is `[]`: the whole-RGV request has no recording (and must never be answered with
 * the recorded subset, which would make it look right), and what is pinned is the request.
 * `/api/views/…` (`rowsUpdatedAt`) still goes to the shared handler's recorded value.
 */
function captureSocrata(respond: (url: URL) => JsonBodyType = () => []): URL[] {
  const seen: URL[] = [];
  server.use(
    http.get(`${SOCRATA_ORIGIN}/resource/:file`, ({ request }) => {
      const url = new URL(request.url);
      seen.push(url);
      return HttpResponse.json(respond(url));
    }),
  );
  return seen;
}

const param = (u: URL | undefined, name: string) => u?.searchParams.get(name) ?? '';

beforeAll(() => {
  startReplayServer();
});
afterEach(() => {
  server.resetHandlers();
  resetSocrata();
  vi.restoreAllMocks();
});
afterAll(() => {
  server.close();
});

describe('the argument gate (T-3-01)', () => {
  it('ingest-comptroller refuses to start without an org', () => {
    // Spied, so "before any I/O" is asserted rather than assumed: the gate must throw
    // before a single request is attempted.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    for (const argv of [[], ['--target=test'], ['--org='], ['--org=   '], ['--limit=5']]) {
      let thrown: unknown;
      try {
        parseIngestArgs(argv);
      } catch (e) {
        thrown = e;
      }
      expect(thrown, JSON.stringify(argv)).toBeInstanceOf(IngestOrgRequiredError);
      expect((thrown as Error).message).toContain('--org');
      expect((thrown as Error).message).toContain('never defaults');
    }
    expect(fetchSpy).not.toHaveBeenCalled();

    // Positive control: an explicit org passes, and the org is carried verbatim.
    expect(parseIngestArgs(['--org=org_2abcDEF'])).toEqual({
      clerkOrgId: 'org_2abcDEF',
      target: 'test',
      limit: undefined,
    });
  });

  it('ingest-comptroller refuses an unknown flag rather than dropping it', () => {
    expect(() => parseIngestArgs(['--orgs=org_x'])).toThrow(/unknown argument/);
    expect(() => parseIngestArgs(['--org=org_x', '--target=staging'])).toThrow(/unknown target/);
    expect(() => parseIngestArgs(['--org=org_x', '--limit=0'])).toThrow(/positive integer/);
    expect(parseIngestArgs(['--org=org_x', '--target=prod', '--limit=25'])).toEqual({
      clerkOrgId: 'org_x',
      target: 'prod',
      limit: 25,
    });
  });
});

describe('the query shapes, pinned on the request the client was handed', () => {
  it('permits are queried with padded county codes', async () => {
    const seen = captureSocrata();
    await fetchPermits();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.pathname).toBe('/resource/jrea-zgmq.json');
    const where = param(seen[0], '$where');
    // `jrea-zgmq`.`outlet_county_code` is zero-padded text: Cameron is '031'.
    for (const code of ["'031'", "'108'", "'214'", "'245'"]) expect(where).toContain(code);
    expect(where).not.toContain("'31'");
    expect(where).toMatch(/^outlet_county_code in \(/);
    // 🔴 Without an order Socrata gives no stability guarantee across $offset pages.
    expect(param(seen[0], '$order')).toBe('taxpayer_number,outlet_number');
    expect(param(seen[0], '$limit')).toBe('50000');
  });

  it('closures are queried with unpadded county codes', async () => {
    const seen = captureSocrata();
    await fetchClosures();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.pathname).toBe('/resource/3kx8-uryv.json');
    const where = param(seen[0], '$where');
    // 🔴 `3kx8-uryv`.`loc_county` is UNPADDED: '031' matches ZERO rows there, and the padded
    // list silently loses all of Cameron (37,875 rows instead of 58,937).
    for (const code of ["'31'", "'108'", "'214'", "'245'"]) expect(where).toContain(code);
    expect(where).not.toContain("'031'");
    expect(where).toContain('out_of_business_date IS NOT NULL');
    expect(param(seen[0], '$order')).toBe('tp_number,loc_number');
  });

  it('statewide name frequency uses the county sentinel', async () => {
    // Three groups copied from the live response measured on 2026-09-22 (see the header of
    // src/lib/socrata/statewide-names.ts): two raw spellings of one name, and the largest.
    const seen = captureSocrata(() => [
      { outlet_name: '100 % ANTOJITOS MEXICANOS', n: '4' },
      { outlet_name: '100 % ANTOJITOS MEXICANOS, INC', n: '4' },
      { outlet_name: 'HRB TECHNOLOGY LLC', n: '437' },
    ]);
    const frequency = await fetchStatewideNameFrequency();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.pathname).toBe('/resource/jrea-zgmq.json');
    // The `000` sentinel belongs to no county: every statewide figure excludes it.
    expect(param(seen[0], '$where')).toContain("between '001' and '254'");
    expect(param(seen[0], '$having')).toContain('>=3');
    expect(param(seen[0], '$group')).toBe('outlet_name');
    expect(param(seen[0], '$select')).toContain('count(1)');
    expect(param(seen[0], '$order')).toBe('outlet_name');

    // Keyed by nameNorm (the key `businesses.name_norm` joins on), never the raw string,
    // and the two raw spellings of one name are summed under one key.
    const antojitos = nameNorm('100 % ANTOJITOS MEXICANOS');
    expect(antojitos).not.toBeNull();
    expect(nameNorm('100 % ANTOJITOS MEXICANOS, INC')).toBe(antojitos);
    expect(frequency.get(antojitos as string)).toBe(8);
    expect(frequency.get(nameNorm('HRB TECHNOLOGY LLC') as string)).toBe(437);
    expect(frequency.has('100 % ANTOJITOS MEXICANOS')).toBe(false);
    expect(frequency.size).toBe(2);
  });
});

describe('release recorded (the Comptroller half)', () => {
  it('release recorded: every emitted source record carries the rowsUpdatedAt ISO version', async () => {
    // Permits: the RECORDED request, served by the shared replay handler from the recording.
    const permits = await fetchPermits(permitsQuery(RECORDED_WHERE.permits));
    const permitVersion = socrataRecordings.datasets['jrea-zgmq'].rowsUpdatedAtIso;
    expect(permits.sourceVersion).toBe(permitVersion);
    expect(permits.rows.length).toBe(socrataRecordings.datasets['jrea-zgmq'].rowCount);
    const records = permits.rows.map((r) =>
      permitToIngest(r, permits.sourceVersion, seededClusters(), new Map()),
    );
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) expect(r.sourceVersion).toBe(permitVersion);

    // Closures: the recorded page filled its own `$limit` (50 of 50), so the shared handler
    // rightly refuses to page past it. Served here as a complete answer, and ONLY to the
    // recorded `$where`/`$order` read out of the sidecar; anything else gets an empty page.
    captureSocrata((url) =>
      param(url, '$where') === RECORDED_WHERE.closures &&
      param(url, '$order') === RECORDED_ORDER.closures
        ? closuresPage
        : [],
    );
    const closures = await fetchClosures(closuresQuery(RECORDED_WHERE.closures));
    const closureVersion = socrataRecordings.datasets['3kx8-uryv'].rowsUpdatedAtIso;
    expect(closures.sourceVersion).toBe(closureVersion);
    // The one recorded row with no closure date (32006170057-5, recorded as the open
    // counterpart of a permit) is refused by the closure schema, never written as closed.
    expect(closures.rejected.count).toBe(1);
    expect(closures.rejected.sample[0]?.key).toBe('32006170057-5');
    expect(closures.records.length).toBe(closuresPage.length - 1);
    for (const r of closures.records) expect(r.sourceVersion).toBe(closureVersion);
  });
});

/**
 * 03-20 desk run, measured live 2026-09-22: `3kx8-uryv` carries 21,509 RGV rows over only
 * 21,467 distinct `tp_number-loc_number` keys — 18 keys on 60 rows, differing in
 * `out_of_business_date` (one outlet, 17426217984-1, has nine quarterly dates). Written one row
 * at a time, a duplicate key flips its own stored payload inside a single run (`changed 42` on a
 * FIRST run), and `$order=tp_number,loc_number` does not order rows within a key, so a second run
 * can never report `unchanged` for them. The feed is folded to one record per key first.
 */
describe('closure feed duplicate keys (03-20)', () => {
  const row = (tp: string, loc: string, date: string): ClosureRow => ({
    tp_number: tp,
    loc_number: loc,
    loc_name: 'SYNTHETIC CLOSED OUTLET',
    loc_county: '108',
    out_of_business_date: date,
  });
  const rec = (r: ClosureRow): ClosureIngest => {
    const s = closureRowToSourceRecord(r, '2026-09-21T15:48:35.000Z');
    return {
      externalId: s.externalId,
      sourceVersion: s.sourceVersion,
      payload: s.payload,
      closedAt: s.closedAt,
    };
  };
  const dupDates = [
    '2023-04-01T00:00:00.000',
    '2024-10-01T00:00:00.000',
    '2022-10-01T00:00:00.000',
  ];

  it('closure feed duplicate keys fold to one record, latest date, order-independent', () => {
    const dups = dupDates.map((d) => rec(row('17426217984', '1', d)));
    const other = rec(row('32043411274', '6', '2024-05-01T00:00:00.000'));
    const forward = foldClosureDuplicates([...dups, other]);
    const backward = foldClosureDuplicates([other, ...[...dups].reverse()]);

    expect(forward.records.map((r) => r.externalId).sort()).toEqual([
      '17426217984-1',
      '32043411274-6',
    ]);
    expect(forward.duplicateKeys).toBe(1);
    expect(forward.duplicateRows).toBe(3);
    const kept = forward.records.find((r) => r.externalId === '17426217984-1');
    expect(kept?.payload.out_of_business_date).toBe('2024-10-01T00:00:00.000');
    // The same stored payload whatever order Socrata hands the rows over in.
    const keptBack = backward.records.find((r) => r.externalId === '17426217984-1');
    expect(keptBack?.payload).toEqual(kept?.payload);
  });

  it('closure feed duplicate keys with an equal date resolve identically in either order', () => {
    const a = rec({ ...row('32029393843', '4', '2025-04-02T00:00:00.000'), loc_name: 'NAME A' });
    const b = rec({ ...row('32029393843', '4', '2025-04-02T00:00:00.000'), loc_name: 'NAME B' });
    const ab = foldClosureDuplicates([a, b]).records;
    const ba = foldClosureDuplicates([b, a]).records;
    expect(ab).toHaveLength(1);
    expect(ab[0]?.payload).toEqual(ba[0]?.payload);
  });
});
