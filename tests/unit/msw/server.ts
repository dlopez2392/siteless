/**
 * The Census Geocoder, replayed from the four recorded payloads in `./fixtures/` — and,
 * since plan 03-03, the Texas Comptroller's Socrata datasets (see the Socrata section
 * below and the fixtures README).
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

/** Clear the request log and any pending one-shot. Call in `afterEach`. */
export function resetCensus(): void {
  censusRequests.length = 0;
  oneShot = null;
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

/** Clear the request log and any pending one-shot. Call in `afterEach`. */
export function resetSocrata(): void {
  socrataRequests.length = 0;
  socrataOneShot = null;
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

export const server = setupServer(censusHandler, socrataResourceHandler, socrataViewsHandler);

/**
 * Start the replay server — Census and Socrata both. 🔴 The `onUnhandledRequest` setting
 * lives here, once, so it cannot be relaxed per test file.
 */
export function startCensusServer(): void {
  server.listen({ onUnhandledRequest: 'error' });
}

/** The same server under a name that does not read as Census-only. */
export const startReplayServer = startCensusServer;
