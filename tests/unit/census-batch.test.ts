/**
 * The US Census BATCH geocoder client, replayed from the five recorded bodies. D-08,
 * DATA-01, DATA-03, T-3-03, T-3-05, T-3-12.
 *
 * Every request in this file is served by `./msw/server.ts`, which dispatches on the
 * request's CSV matched against each fixture's own echo. `onUnhandledRequest: 'error'`
 * turns an accidental live call into a failure rather than a flake.
 *
 * 🔴 The defects these tests exist to catch are all invisible to a `toBeDefined`:
 *   1. indexing position 6 on a short `Tie` or `No_Match` line. 03-RESEARCH recorded a
 *      No_Match as 4 fields; the 2026-09-22 recordings here carry it as 3, the same as a
 *      Tie. Both shapes are exercised below — what matters is that neither has a position 6;
 *   2. zipping results to rows BY POSITION — the service answers out of order, so every
 *      business silently gets somebody else's location, 200 miles away or next door;
 *   3. reading `"lng,lat"` in written order — a swap is still two finite numbers;
 *   4. promoting a direction-flipping `Non_Exact` to the exact-address signal.
 *
 * The expected values below are read out of the fixtures with a splitter written HERE, not
 * with the parser under test, so the oracle cannot share the parser's bugs.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';

import {
  CENSUS_BATCH_ATTEMPTS,
  CENSUS_BATCH_CHUNK,
  CENSUS_BATCH_CONCURRENCY,
  geocodeBatch,
  locationMatchType,
  parseBatchLine,
  promotesToAddressSignal,
  type BatchOutcome,
  type BatchRow,
} from '@/lib/geocode/census-batch';
import {
  CENSUS_BATCH_BODY,
  CENSUS_BATCH_ENDPOINT,
  CENSUS_BATCH_PATHNAME,
  CENSUS_ORIGIN,
  censusBatchRequests,
  failNextCensusBatches,
  RECORDED_BATCH_ROWS,
  resetCensus,
  server,
  startReplayServer,
  type CensusBatchFixture,
} from './msw/server';

beforeAll(() => {
  startReplayServer();
});
afterEach(() => {
  server.resetHandlers();
  resetCensus();
});
afterAll(() => {
  server.close();
});

// ─── The oracle: an independent read of the recorded bodies ─────────────────────────────

const linesOf = (name: CensusBatchFixture): string[] =>
  CENSUS_BATCH_BODY[name].split('\n').filter((l) => l.length > 0);

/** Every field in these bodies is quoted and none contains `","`, so this is exact for
 *  them — and deliberately NOT the parser under test. */
const fieldsOf = (line: string): string[] => line.slice(1, -1).split('","');

/** The rows a fixture was recorded against, as `geocodeBatch` input. */
const rowsOf = (name: CensusBatchFixture): BatchRow[] =>
  RECORDED_BATCH_ROWS[name].map(({ id, street, city, zip }) => ({ id, street, city, zip }));

// Load-time guard, as `census.test.ts` does: each fixture must carry what the tests below
// read. A fixture that silently changed shape would otherwise make them pass for the wrong
// reason — a re-recording that came back in input order would make the rejoin test vacuous.
const fieldCounts = (name: CensusBatchFixture): number[] =>
  linesOf(name).map((l) => fieldsOf(l).length);
const shuffledIds = linesOf('shuffled').map((l) => fieldsOf(l)[0]);
const outOfPlace = shuffledIds.filter((id, i) => id !== String(i + 1)).length;
const nonExactFields = fieldsOf(linesOf('non_exact')[0] ?? '');
if (
  !fieldCounts('tie').includes(3) ||
  !fieldCounts('no_match').every((n) => n < 6) ||
  fieldCounts('no_match').length < 2 ||
  !fieldCounts('match').includes(8) ||
  shuffledIds.length < 20 ||
  shuffledIds[0] === '1' ||
  outOfPlace < shuffledIds.length / 2 ||
  nonExactFields[3] !== 'Non_Exact' ||
  !/^\d+ E /.test(nonExactFields[1] ?? '') ||
  !/^\d+ W /.test(nonExactFields[4] ?? '')
) {
  throw new Error(
    'tests/unit/census-batch.test.ts: a census-batch fixture no longer carries what these ' +
      'tests read (a 3-field Tie, two short No_Matches, an 8-field Match, a >=20-line ' +
      'out-of-order response, an E->W Non_Exact). See tests/unit/msw/fixtures/README.md.',
  );
}

const noSleep = async (): Promise<void> => {};

describe('the Census batch geocoder (D-08)', () => {
  it('census batch parses a ragged No_Match', () => {
    const recorded = linesOf('no_match');
    // Both recorded lines — the PO box and the Mexican-side address — are 3 fields as
    // recorded on 2026-09-22 (03-RESEARCH had written 4). Either way: no position 6.
    expect(recorded.map((l) => fieldsOf(l).length)).toEqual([3, 3]);
    expect(recorded.map((l) => parseBatchLine(l))).toEqual([
      { id: '1', kind: 'No_Match' },
      { id: '2', kind: 'No_Match' },
    ]);

    // The 4-field shape the research described (a trailing empty field), SYNTHESIZED from
    // the recorded line: it parses the same.
    const [first] = recorded;
    expect(parseBatchLine(`${first},""`)).toEqual({ id: '1', kind: 'No_Match' });

    // The parser never reads position 6 of a No_Match: the same line with a poisoned
    // `"lng,lat"` pair (and the rest of a Match's tail) appended parses identically. A
    // parser that read the coordinates before branching would pick these up or reject them.
    const poisoned = `${first},"Exact","SOMEWHERE ELSE","-1,1","0","L"`;
    expect(parseBatchLine(poisoned)).toEqual({ id: '1', kind: 'No_Match' });
  });

  it('census batch parses a ragged Tie', () => {
    const [line] = linesOf('tie');
    expect(fieldsOf(line ?? '')).toHaveLength(3);
    expect(parseBatchLine(line ?? '')).toEqual({ id: '1', kind: 'Tie' });
  });

  it('census batch rejoins by id', async () => {
    const rows = rowsOf('shuffled');
    const out = await geocodeBatch(rows, { sleep: noSleep });
    expect(out.size).toBe(rows.length);

    // Every ID's outcome is the one its OWN recorded line carries.
    for (const line of linesOf('shuffled')) {
      const [id, , status, matchType, matchedAddress, lngLat] = fieldsOf(line);
      const got = out.get(id ?? '');
      if (status === 'Match') {
        const [lng, lat] = (lngLat ?? '').split(',').map(Number);
        expect(got).toEqual({ kind: 'Match', matchType, matchedAddress, lat, lng });
      } else {
        expect(got).toEqual({ kind: status });
      }
    }

    // And NOT the one at the same position. Line 1 of the response is ID 22 (Brownsville);
    // ID 1 is the Harlingen join row. A position zip would hand ID 1 the Brownsville point.
    const firstLine = fieldsOf(linesOf('shuffled')[0] ?? '');
    expect(firstLine[0]).not.toBe('1');
    const one = out.get('1');
    if (one?.kind !== 'Match') throw new Error(`expected ID 1 to match, got ${one?.kind}`);
    expect(one.matchedAddress).toBe('2426 E TYLER AVE, HARLINGEN, TX, 78550');
    expect(one.matchedAddress).not.toBe(firstLine[4]);
    // ID 16 is the one No_Match in the recording; position 16 of the response is a Match.
    expect(out.get('16')).toEqual({ kind: 'No_Match' });
    expect(fieldsOf(linesOf('shuffled')[15] ?? '')[2]).toBe('Match');
  });

  it('census batch pins the axis order', async () => {
    // End to end: the Harlingen row goes out as CSV and comes back through the handler.
    const out = (await geocodeBatch(rowsOf('match'), { sleep: noSleep })).get('32006170057-5');
    if (out?.kind !== 'Match') throw new Error(`expected a Match, got ${out?.kind}`);

    // 🔴 RGV longitude is about -98 and latitude about +26, so a swap flips both at once.
    expect(out.lng).toBeLessThan(-90);
    expect(out.lat).toBeGreaterThan(20);
    expect(out.lng).toBe(-97.672649743751);
    expect(out.lat).toBe(26.189604634647);
    // Straight against the recorded field: position 6 is "longitude,latitude".
    expect(fieldsOf(linesOf('match')[0] ?? '')[5]).toBe(`${out.lng},${out.lat}`);
    expect(out.matchType).toBe('Exact');
  });

  it('non_exact is location only', async () => {
    const rows = rowsOf('non_exact');
    const out = (await geocodeBatch(rows, { sleep: noSleep })).get('1');
    if (out?.kind !== 'Match') throw new Error(`expected a Match, got ${out?.kind}`);

    // The measured direction flip: sent 100 E CANO ST, matched 100 W CANO ST.
    expect(rows[0]?.street).toBe('100 E CANO ST');
    expect(out.matchType).toBe('Non_Exact');
    expect(out.matchedAddress).toBe('100 W CANO ST, EDINBURG, TX, 78539');

    // It still carries a location — the distance feature may use it...
    expect(out.lng).toBeLessThan(-90);
    expect(out.lat).toBeGreaterThan(20);
    expect(locationMatchType(out)).toBe('census_non_exact');
    // ...but it never becomes the exact-address signal.
    expect(promotesToAddressSignal(out)).toBe(false);

    // Two-sided: an Exact does promote, and nothing without a location does.
    const exact = parseBatchLine(linesOf('match')[0] ?? '');
    expect(promotesToAddressSignal(exact)).toBe(true);
    expect(locationMatchType(exact)).toBe('census_exact');
    const others: BatchOutcome[] = [
      { kind: 'No_Match' },
      { kind: 'Tie' },
      { kind: 'ChunkFailed', reason: 'unreachable' },
    ];
    for (const o of others) {
      expect(promotesToAddressSignal(o)).toBe(false);
      expect(locationMatchType(o)).toBeNull();
    }
  });

  it('census batch retries and then records the chunk as failed', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      waits.push(ms);
    };

    // Three transport failures: three attempts, 2 s then 8 s between them, then a named
    // outcome — not a rejection. (`await` without `rejects` IS the "nothing threw" check.)
    failNextCensusBatches(3, 'network');
    const failed = await geocodeBatch(rowsOf('match'), { sleep });
    expect(CENSUS_BATCH_ATTEMPTS).toBe(3);
    expect(censusBatchRequests).toHaveLength(3);
    expect(waits).toEqual([2_000, 8_000]);
    expect(failed.get('32006170057-5')).toEqual({ kind: 'ChunkFailed', reason: 'unreachable' });

    // The service's own failure mode — a 200 with a line missing — is retried too, and
    // named for what it was.
    resetCensus();
    failNextCensusBatches(3, 'truncated');
    const truncated = await geocodeBatch(rowsOf('shuffled'), { sleep: noSleep });
    expect(censusBatchRequests).toHaveLength(3);
    expect(truncated.get('1')).toEqual({ kind: 'ChunkFailed', reason: 'count_mismatch' });

    // Positive control: two failures, then the third attempt lands and is used.
    resetCensus();
    failNextCensusBatches(2, 'status_500');
    const recovered = await geocodeBatch(rowsOf('match'), { sleep: noSleep });
    expect(censusBatchRequests).toHaveLength(3);
    expect(recovered.get('32006170057-5')).toMatchObject({ kind: 'Match', matchType: 'Exact' });
  });
});

describe('the Census batch geocoder — transport bounds (T-3-05, T-3-12)', () => {
  it('census batch never runs more than three chunks at once', async () => {
    // A synthetic handler for a transport property, not a recording: it answers every row
    // No_Match after a short hold, and counts how many requests overlap.
    let inFlight = 0;
    let peak = 0;
    const sizes: number[] = [];
    server.use(
      http.post(CENSUS_BATCH_ENDPOINT, async ({ request }) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        const file = (await request.formData()).get('addressFile');
        const csv = typeof file === 'string' ? file : ((await file?.text()) ?? '');
        const ids = csv
          .split('\n')
          .filter((l) => l.length > 0)
          .map((l) => fieldsOf(l)[0]);
        sizes.push(ids.length);
        await new Promise((r) => setTimeout(r, 20));
        inFlight -= 1;
        return HttpResponse.text(
          ids.map((id) => `"${id}","X, Y, TX, 78501","No_Match"\n`).join(''),
        );
      }),
    );

    const rows: BatchRow[] = Array.from({ length: CENSUS_BATCH_CHUNK * 6 + 500 }, (_, i) => ({
      id: `r${i}`,
      street: `${i} MAIN ST`,
      city: 'MCALLEN',
      zip: '78501',
    }));
    const out = await geocodeBatch(rows, { sleep: noSleep });

    expect(sizes).toHaveLength(7);
    expect(Math.max(...sizes)).toBe(CENSUS_BATCH_CHUNK);
    expect(peak).toBe(CENSUS_BATCH_CONCURRENCY);
    expect(CENSUS_BATCH_CONCURRENCY).toBe(3);
    expect(out.size).toBe(rows.length);
    expect(out.get('r6499')).toEqual({ kind: 'No_Match' });
  });

  it('census batch sends an address only as a CSV field', async () => {
    // Legal-looking strings that would matter if they reached a URL or a header. The CSV
    // matches no recording, so the handler answers 501 and the client retries — every
    // attempt is logged, and every one must have gone to the constant host and path.
    const rows: BatchRow[] = [
      { id: 'a', street: 'https://evil.example/', city: '../../x?y=', zip: '78501' },
      { id: 'b', street: '1 MAIN ST\r\nHost: evil.example', city: 'MCALLEN', zip: '785019999' },
    ];
    const out = await geocodeBatch(rows, { sleep: noSleep });

    expect(censusBatchRequests.length).toBeGreaterThan(0);
    for (const req of censusBatchRequests) {
      expect(req.url.origin).toBe(CENSUS_ORIGIN);
      expect(req.url.pathname).toBe(CENSUS_BATCH_PATHNAME);
      expect(req.url.search).toBe('');
      expect(req.benchmark).toBe('Public_AR_Current');
      expect(req.vintage).toBeNull();
      // The CRLF did not split the row: still exactly two CSV lines, ZIP cut to five.
      expect(req.csv.split('\n').filter((l) => l.length > 0)).toEqual([
        '"a","https://evil.example/","../../x?y=","TX","78501"',
        '"b","1 MAIN ST  Host: evil.example","MCALLEN","TX","78501"',
      ]);
    }
    expect(out.get('a')).toMatchObject({ kind: 'ChunkFailed' });
  });

  it('census batch refuses an id it could not rejoin on', async () => {
    const dup: BatchRow[] = [
      { id: 'x', street: '1 A ST', city: 'MCALLEN', zip: '78501' },
      { id: 'x', street: '2 B ST', city: 'MCALLEN', zip: '78501' },
    ];
    await expect(geocodeBatch(dup)).rejects.toThrow(/appears twice/);
    await expect(
      geocodeBatch([{ id: 'has "quote"', street: '1 A ST', city: 'MCALLEN', zip: '78501' }]),
    ).rejects.toThrow(TypeError);
    // Refused before any request was built.
    expect(censusBatchRequests).toHaveLength(0);
  });

  it('census batch turns a malformed line into bad_shape', () => {
    expect(parseBatchLine('"7","X","Match","Exact","X","not-a-number,26","1","L"')).toEqual({
      id: '7',
      kind: 'ChunkFailed',
      reason: 'bad_shape',
    });
    // A swapped pair (latitude first) puts -97.67 in the latitude slot: out of range.
    expect(parseBatchLine('"7","X","Match","Exact","X","26.18,-97.67","1","L"')).toMatchObject({
      kind: 'ChunkFailed',
      reason: 'bad_shape',
    });
    expect(parseBatchLine('"7","X","Maybe"')).toMatchObject({ kind: 'ChunkFailed' });
    expect(parseBatchLine('"7","unbalanced')).toMatchObject({ kind: 'ChunkFailed' });
    expect(parseBatchLine('')).toMatchObject({ kind: 'ChunkFailed' });
  });
});
