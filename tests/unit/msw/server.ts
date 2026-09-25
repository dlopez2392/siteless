/**
 * The Census Geocoder, replayed from the four recorded payloads in `./fixtures/` — and,
 * since plan 03-03, the Texas Comptroller's Socrata datasets (see the Socrata section
 * below and the fixtures README), and since plan 03-07 the Census BATCH endpoint (five
 * recorded `text/plain` bodies; see the batch section below).
 *
 * 🔴 CI MUST NEVER REACH THE NETWORK. `onUnhandledRequest` is set to `'error'` inside
 * `startCensusServer()` rather than at each call site precisely so no test can weaken it
 * by forgetting it: a request that slips past the handler fails the test instead of
 * silently going out to a third party whose uptime would then decide whether CI is green.
 * The geocoder is free, so the risk here is flakiness and a supply-chain read rather than
 * spend — but the same harness is what Places and Firecrawl will use in Phase 4, where it
 * IS spend.
 *
 * 🔴 DISPATCH IS BY THE RECORDED ADDRESS, READ OUT OF THE FIXTURE. Nothing below restates
 * an address string. A substring rule would be worse than wrong: the no-match fixture was
 * recorded for "Joe's Taqueria, McAllen, TX", so any rule that keys on "mcallen" would
 * serve it the McAllen hit and the no-match test would prove nothing.
 *
 * 🔴 `census-503.json` IS AN ENVELOPE, NOT A BODY. The live service will not produce a 503
 * on demand, so it is hand-written `{ status, body }` while its three neighbours are
 * verbatim 200 bodies. Replaying one as the other is the mistake the fixtures' README
 * warns about, so this module asserts the shape at load rather than trusting it.
 */
import { readFileSync } from 'node:fs';

import { http, HttpResponse, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';

import mcallen from './fixtures/census-mcallen.json';
import noMatch from './fixtures/census-no-match.json';
import rioGrandeCity from './fixtures/census-rio-grande-city.json';
import serviceUnavailable from './fixtures/census-503.json';
import closuresPage from './fixtures/socrata-3kx8-page.json';
import typeMismatch from './fixtures/socrata-400-type-mismatch.json';
import permitsPage from './fixtures/socrata-jrea-page.json';
import socrataRecordings from './fixtures/socrata-recordings.json';
import { placesHandler, resetPlaces } from './places';

export const CENSUS_ORIGIN = 'https://geocoding.geo.census.gov';
export const CENSUS_PATHNAME = '/geocoder/geographies/onelineaddress';
export const CENSUS_ENDPOINT = `${CENSUS_ORIGIN}${CENSUS_PATHNAME}`;

/** The exact strings the fixtures were recorded against, read from the fixtures. A test
 *  that typed one of these by hand could drift from the payload it expects back. */
export const RECORDED_ADDRESS = {
  mcallen: mcallen.result.input.address.address,
  rioGrandeCity: rioGrandeCity.result.input.address.address,
  noMatch: noMatch.result.input.address.address,
} as const;

const BY_ADDRESS = new Map<string, JsonBodyType>([
  [RECORDED_ADDRESS.mcallen.toLowerCase(), mcallen],
  [RECORDED_ADDRESS.rioGrandeCity.toLowerCase(), rioGrandeCity],
  [RECORDED_ADDRESS.noMatch.toLowerCase(), noMatch],
]);

// Load-time envelope check. If someone re-records this file as a 200 body, every 503 test
// would quietly start asserting against a geocoder payload.
if (typeof serviceUnavailable.status !== 'number' || typeof serviceUnavailable.body !== 'string') {
  throw new Error(
    'tests/unit/msw/server.ts: census-503.json is not a { status, body } envelope. ' +
      'See tests/unit/msw/fixtures/README.md - the other three files are verbatim 200 ' +
      'bodies and this one is deliberately not.',
  );
}

/** Every outbound request the handler saw, in order. The T-2-13 test reads this to assert
 *  where the caller's string ended up. */
export const censusRequests: URL[] = [];

type OneShot = { kind: 'unavailable' } | { kind: 'json'; body: JsonBodyType };

let oneShot: OneShot | null = null;

/** Make the NEXT request replay the hand-written 503 envelope. One call only — a sticky
 *  failure would leak into whichever test ran next. */
export function failNextWithServiceUnavailable(): void {
  oneShot = { kind: 'unavailable' };
}

/** Make the NEXT request return an arbitrary 200 body. Used to serve a deliberately
 *  mutated copy of a recorded payload (a non-Texas STATE) without editing the fixture. */
export function respondNextWithJson(body: JsonBodyType): void {
  oneShot = { kind: 'json', body };
}

/** Clear the request log and any pending one-shot — the one-line endpoint's AND the batch
 *  endpoint's (see the batch section below), so a file that only knows `resetCensus` still
 *  cannot leak an armed batch failure into the next test. Also clears the Places routes, log
 *  and hook (`./places.ts`), for the same reason. Call in `afterEach`. */
export function resetCensus(): void {
  censusRequests.length = 0;
  oneShot = null;
  resetCensusBatch();
  resetPlaces();
}

export const censusHandler = http.get(CENSUS_ENDPOINT, ({ request }) => {
  censusRequests.push(new URL(request.url));

  if (oneShot) {
    const pending = oneShot;
    oneShot = null;
    if (pending.kind === 'unavailable') {
      return new HttpResponse(serviceUnavailable.body, { status: serviceUnavailable.status });
    }
    return HttpResponse.json(pending.body);
  }

  const address = (new URL(request.url).searchParams.get('address') ?? '').toLowerCase();
  // An unrecorded address falls through to the empty-match payload, which is exactly what
  // the live service does for anything it cannot resolve.
  return HttpResponse.json(BY_ADDRESS.get(address) ?? noMatch);
});

// ─── Census BATCH geocoder (plan 03-07) ─────────────────────────────────────────────────
//
// Five verbatim `text/plain` bodies recorded from `locations/addressbatch` on 2026-09-22
// (provenance in the fixtures README). They are read as TEXT, not imported, because they
// are CSV and must reach the parser byte-for-byte.
//
// 🔴 DISPATCH IS BY THE INPUT CSV READ OUT OF THE REQUEST BODY, matched against what each
// fixture ECHOES. Every response line starts with the request's own ID and its input
// address echoed as `street, city, state, zip` — the batch analogue of the one-line
// payload echoing `result.input.address`. So each fixture carries its own request, and the
// handler serves the fixture whose (id, echoed address) set equals the request's exactly.
// Nothing below restates an address. A request that matches no recording gets a 501 naming
// the mismatch — never a best-effort body, which would make a wrong CSV look right.

export const CENSUS_BATCH_PATHNAME = '/geocoder/locations/addressbatch';
export const CENSUS_BATCH_ENDPOINT = `${CENSUS_ORIGIN}${CENSUS_BATCH_PATHNAME}`;

export const CENSUS_BATCH_FIXTURES = ['match', 'non_exact', 'tie', 'no_match', 'shuffled'] as const;
export type CensusBatchFixture = (typeof CENSUS_BATCH_FIXTURES)[number];

/** The recorded bodies, verbatim. Tests read lines out of these; the handler serves them. */
export const CENSUS_BATCH_BODY = Object.fromEntries(
  CENSUS_BATCH_FIXTURES.map((name) => [
    name,
    readFileSync(new URL(`./fixtures/census-batch-${name}.txt`, import.meta.url), 'utf8'),
  ]),
) as Record<CensusBatchFixture, string>;

/**
 * A deliberately small quoted-CSV splitter, kept separate from the parser under test: a
 * harness that parsed with the code it is testing would agree with that code's bugs.
 * Returns `null` on an unbalanced quote.
 */
function splitQuotedCsv(line: string): string[] | null {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  if (quoted) return null;
  fields.push(field);
  return fields;
}

function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}

export type RecordedBatchRow = {
  id: string;
  street: string;
  city: string;
  state: string;
  zip: string;
};

/**
 * The rows each fixture was recorded against, read back out of the fixture's own echo, in
 * ID order (the order they were submitted in — the response is not). The echo is
 * `street, city, state, zip`; it is split from the RIGHT so a street carrying a comma would
 * still survive. A test that typed these rows by hand could drift from the body it expects.
 */
function recordedRows(name: CensusBatchFixture): RecordedBatchRow[] {
  const rows = nonEmptyLines(CENSUS_BATCH_BODY[name]).map((line) => {
    const fields = splitQuotedCsv(line);
    const id = fields?.[0];
    const echo = fields?.[1];
    const parts = echo?.split(', ');
    if (!id || !parts || parts.length < 4) {
      throw new Error(
        `tests/unit/msw/server.ts: census-batch-${name}.txt has an unreadable line: ${line}`,
      );
    }
    const zip = parts.pop() as string;
    const state = parts.pop() as string;
    const city = parts.pop() as string;
    return { id, street: parts.join(', '), city, state, zip };
  });
  return rows.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

export const RECORDED_BATCH_ROWS = Object.fromEntries(
  CENSUS_BATCH_FIXTURES.map((name) => [name, recordedRows(name)]),
) as Record<CensusBatchFixture, RecordedBatchRow[]>;

function signatureOf(rows: ReadonlyArray<{ id: string; echo: string }>): string {
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(sorted.map((r) => [r.id, r.echo]));
}

const BATCH_BY_SIGNATURE = new Map<string, CensusBatchFixture>();
for (const name of CENSUS_BATCH_FIXTURES) {
  const body = CENSUS_BATCH_BODY[name];
  // Load-time checks: pure text, one line per submitted row, every ID distinct. A fixture
  // re-saved through an editor that added a BOM, CRLFs or a NUL fails here, not in a test.
  // (`.gitattributes` marks these files `-text` so an autocrlf checkout cannot add the CRs.)
  if (
    body.includes('\u0000') ||
    body.includes('\r') ||
    body.charCodeAt(0) === 0xfeff ||
    !body.endsWith('\n')
  ) {
    throw new Error(
      `tests/unit/msw/server.ts: census-batch-${name}.txt is not the verbatim LF-terminated body`,
    );
  }
  const rows = RECORDED_BATCH_ROWS[name];
  if (new Set(rows.map((r) => r.id)).size !== nonEmptyLines(body).length) {
    throw new Error(`tests/unit/msw/server.ts: census-batch-${name}.txt repeats an ID`);
  }
  const signature = signatureOf(
    rows.map((r) => ({ id: r.id, echo: `${r.street}, ${r.city}, ${r.state}, ${r.zip}` })),
  );
  BATCH_BY_SIGNATURE.set(signature, name);
}

/** Every batch request the handler saw: where it went, the form fields, and the CSV. */
export const censusBatchRequests: Array<{
  url: URL;
  benchmark: string | null;
  vintage: string | null;
  csv: string;
}> = [];

type BatchFailure = 'network' | 'status_500' | 'truncated';
let batchFailures: { kind: BatchFailure; remaining: number } | null = null;

/**
 * Make the NEXT `count` batch requests fail, then serve normally again. `'network'` is a
 * transport error (the fetch rejects), `'status_500'` a non-200, and `'truncated'` a 200
 * whose body has lost its last line — the service's own failure mode, since it answers 200
 * for everything. Cleared by `resetCensusBatch()` / `resetCensus()` in `afterEach`, so an
 * armed failure can never leak into the next test.
 */
export function failNextCensusBatches(count: number, kind: BatchFailure = 'network'): void {
  batchFailures = { kind, remaining: count };
}

export function resetCensusBatch(): void {
  censusBatchRequests.length = 0;
  batchFailures = null;
}

export const censusBatchHandler = http.post(CENSUS_BATCH_ENDPOINT, async ({ request }) => {
  const url = new URL(request.url);
  const form = await request.formData();
  const file = form.get('addressFile');
  const csv = typeof file === 'string' ? file : file ? await file.text() : '';
  const benchmark = form.get('benchmark');
  const vintage = form.get('vintage');
  censusBatchRequests.push({
    url,
    benchmark: typeof benchmark === 'string' ? benchmark : null,
    vintage: typeof vintage === 'string' ? vintage : null,
    csv,
  });

  if (benchmark !== 'Public_AR_Current' || vintage !== null) {
    return new HttpResponse(
      `msw: unrecorded batch form: benchmark=${String(benchmark)} vintage=${String(vintage)}`,
      { status: 501 },
    );
  }

  const requested: Array<{ id: string; echo: string }> = [];
  for (const line of nonEmptyLines(csv)) {
    const f = splitQuotedCsv(line);
    if (!f || f.length !== 5) {
      return new HttpResponse(`msw: batch CSV line is not 5 fields: ${line}`, { status: 501 });
    }
    const [id, street, city, state, zip] = f as [string, string, string, string, string];
    requested.push({ id, echo: `${street}, ${city}, ${state}, ${zip}` });
  }
  const name = BATCH_BY_SIGNATURE.get(signatureOf(requested));
  if (!name) {
    return new HttpResponse(
      `msw: no batch recording for these ${requested.length} rows (first: ${JSON.stringify(requested[0])})`,
      { status: 501 },
    );
  }
  const body = CENSUS_BATCH_BODY[name];

  if (batchFailures && batchFailures.remaining > 0) {
    batchFailures.remaining -= 1;
    const { kind } = batchFailures;
    if (kind === 'network') return HttpResponse.error();
    if (kind === 'status_500') return new HttpResponse('', { status: 500 });
    const lines = nonEmptyLines(body);
    return HttpResponse.text(`${lines.slice(0, -1).join('\n')}\n`);
  }
  return HttpResponse.text(body);
});

// ─── Socrata (data.texas.gov) ────────────────────────────────────────────────────────────
//
// 🔴 DISPATCH IS BY THE RECORDED `$where`, READ OUT OF `socrata-recordings.json`. That file
// is written by the same capture run that wrote the two page bodies, from the same
// variables, so the `$where` it names is by construction the one that produced them. A
// Socrata page is a bare JSON array with nowhere to carry its own request (unlike the
// Census payload, which echoes its input address), hence the sidecar. Nothing below
// restates a predicate by hand.
//
// A request whose `$where` or `$order` is not the recorded one gets a 501 naming the
// mismatch, never a best-effort page: the live service would have answered a different
// question, and silently serving the recorded rows would make a wrong query look right.

export const SOCRATA_ORIGIN = 'https://data.texas.gov';

type Recording = {
  file: string;
  where: string;
  order: string;
  limit: number;
  rowCount: number;
  rowsUpdatedAt: number;
};

const RECORDINGS: Record<string, { recording: Recording; rows: JsonBodyType[] }> = {
  'jrea-zgmq': { recording: socrataRecordings.datasets['jrea-zgmq'], rows: permitsPage },
  '3kx8-uryv': { recording: socrataRecordings.datasets['3kx8-uryv'], rows: closuresPage },
};

/** The exact `$where` / `$order` each page was recorded under, read from the sidecar. */
export const RECORDED_WHERE = {
  permits: socrataRecordings.datasets['jrea-zgmq'].where,
  closures: socrataRecordings.datasets['3kx8-uryv'].where,
} as const;

export const RECORDED_ORDER = {
  permits: socrataRecordings.datasets['jrea-zgmq'].order,
  closures: socrataRecordings.datasets['3kx8-uryv'].order,
} as const;

// Load-time checks, the same discipline as the census-503 envelope check above: a
// re-recording that drifted from its sidecar, or a 400 re-captured as a 200 body, fails
// here before any test can assert against it.
for (const [dataset, { recording, rows }] of Object.entries(RECORDINGS)) {
  if (rows.length !== recording.rowCount || rows.length === 0) {
    throw new Error(
      `tests/unit/msw/server.ts: ${recording.file} has ${rows.length} rows but ` +
        `socrata-recordings.json says ${dataset} recorded ${recording.rowCount}.`,
    );
  }
}
if (
  typeMismatch.status !== 400 ||
  typeof typeMismatch.body !== 'string' ||
  !typeMismatch.body.includes('query.soql.type-mismatch')
) {
  throw new Error(
    'tests/unit/msw/server.ts: socrata-400-type-mismatch.json is not a { status: 400, body } ' +
      'envelope carrying the SoQL type-mismatch. See tests/unit/msw/fixtures/README.md.',
  );
}

/** Every Socrata request the handlers saw, with the app-token header as it arrived. */
export const socrataRequests: Array<{ url: URL; appToken: string | null }> = [];

let socrataOneShot: 'type-mismatch' | null = null;

/** Make the NEXT Socrata request replay the recorded 400. One call only. */
export function failNextSocrataWithTypeMismatch(): void {
  socrataOneShot = 'type-mismatch';
}

/** Clear the request log and any pending one-shot (and the Places routes, log and hook, so
 *  a file that only knows `resetSocrata` cannot leak them either). Call in `afterEach`. */
export function resetSocrata(): void {
  socrataRequests.length = 0;
  socrataOneShot = null;
  resetPlaces();
}

function datasetFromFile(file: unknown): string {
  return typeof file === 'string' ? file.replace(/\.json$/, '') : '';
}

export const socrataResourceHandler = http.get(
  `${SOCRATA_ORIGIN}/resource/:file`,
  ({ request, params }) => {
    const url = new URL(request.url);
    socrataRequests.push({ url, appToken: request.headers.get('x-app-token') });

    if (socrataOneShot === 'type-mismatch') {
      socrataOneShot = null;
      return new HttpResponse(typeMismatch.body, {
        status: typeMismatch.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    const entry = RECORDINGS[datasetFromFile(params.file)];
    if (!entry) {
      return new HttpResponse(`msw: no Socrata recording for ${url.pathname}`, { status: 501 });
    }
    const { recording, rows } = entry;
    const where = url.searchParams.get('$where');
    const order = url.searchParams.get('$order');
    if (where !== recording.where || order !== recording.order) {
      return new HttpResponse(
        `msw: unrecorded request for ${recording.file}: $where=${where} $order=${order}`,
        { status: 501 },
      );
    }

    const limit = Number(url.searchParams.get('$limit') ?? '1000');
    const offset = Number(url.searchParams.get('$offset') ?? '0');
    // A recording that filled its own `$limit` is a TRUNCATED result set: rows exist past it
    // that were never captured. A request reaching past that edge cannot be answered
    // truthfully, so it is refused rather than served a short page that would read as "done".
    const truncated = recording.rowCount === recording.limit;
    if (truncated && offset + limit > recording.limit) {
      return new HttpResponse(
        `msw: ${recording.file} is a truncated page of ${recording.limit}; ` +
          `$offset=${offset} $limit=${limit} reaches past what was recorded`,
        { status: 501 },
      );
    }
    return HttpResponse.json(rows.slice(offset, offset + limit));
  },
);

/** `/api/views/<id>.json`, reduced to the one field the client reads. The real metadata
 *  payload is tens of kilobytes of column descriptions; `rowsUpdatedAt` is the value the
 *  capture run recorded for the page it fetched. */
export const socrataViewsHandler = http.get(`${SOCRATA_ORIGIN}/api/views/:file`, ({ params }) => {
  const entry = RECORDINGS[datasetFromFile(params.file)];
  if (!entry) return new HttpResponse('msw: no Socrata recording', { status: 501 });
  return HttpResponse.json({ rowsUpdatedAt: entry.recording.rowsUpdatedAt });
});

export const server = setupServer(
  censusHandler,
  censusBatchHandler,
  socrataResourceHandler,
  socrataViewsHandler,
  placesHandler,
);

/**
 * Start the replay server — Census, Socrata and (since plan 04-10) Google Places, whose
 * handler, routes and synthetic fixtures live in `./places.ts`. 🔴 The `onUnhandledRequest`
 * setting lives here, once, so it cannot be relaxed per test file — for Places that is the
 * difference between a failed test and a billed request.
 */
export function startCensusServer(): void {
  server.listen({ onUnhandledRequest: 'error' });
}

/** The same server under a name that does not read as Census-only. */
export const startReplayServer = startCensusServer;
