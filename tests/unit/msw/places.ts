/**
 * Google Places (API New) Text Search, replayed from SYNTHETIC fixtures (plan 04-10).
 *
 * D-01: the whole phase is built and tested on replayed payloads; CI never spends. D-20: no
 * Google-authored text is ever committed — every `places-*.json` beside this file is
 * hand-authored (the sidecar `places-recordings.json` says `synthetic: true`, checked below),
 * and real recordings, when 04-19's recorder makes them after the legal gate, are anonymized
 * in memory before they are written.
 *
 * msw intercepts `fetch` in every lane — unit, DB and the workflow lane, where `vi.mock` of
 * `@/` does NOT reach step code but this handler does (04-RESEARCH spike). So this one
 * handler is every Places test's only endpoint, and its strictness is every test's.
 *
 * 🔴 A REGEXP PATH, NEVER THE STRING (Pitfall 8, measured). msw parses the string
 * `…/v1/places:searchText` as `places` + a route PARAM `:searchText`, which also matches
 * `/v1/placesXYZ`. The anchored RegExp below matches exactly one URL.
 *
 * 🔴 501, NEVER A PAGE, when the request is not one the real builder may send (B-WR-10): no
 * `X-Goog-FieldMask`, no `X-Goog-Api-Key`, a mask field the product never requests, or a body
 * that breaks any invariant request.ts fixes — `includePureServiceAreaBusinesses: true`
 * (PLACE-05, M26), `strictTypeFiltering: true`, `pageSize: 20`, `regionCode: 'US'`,
 * `languageCode: 'en'`, a Table A `includedType` spelled as the `textQuery`, an ordered
 * rectangle, no other key. A later page must be EXACTLY the page-1 body its token was issued
 * for, plus the token (M49 — Google answers INVALID_ARGUMENT otherwise). And a request NO ROUTE
 * claims is refused too: a test that wants an empty page routes to `PLACES_PAGES.empty`. The
 * Socrata handler's discipline: a best-effort page would make a builder regression look right.
 *
 * 🔴 `regionCode: 'US'` OMITS THE COUNTRY (B-CR-01). Google leaves `, USA` off a US address when
 * the region matches; the handler does the same to any fixture that still carries it.
 *
 * 🔴 THE MASK DECIDES WHAT IS SERVED. Each place is reduced to the fields the request's
 * `X-Goog-FieldMask` names (`places.<field>` → `<field>`; `nextPageToken` only when masked),
 * so an IDs-only request can never be handed a `websiteUri` a test then "finds".
 */
import { readdirSync, readFileSync } from 'node:fs';

import { http, HttpResponse, type JsonBodyType } from 'msw';

import { isTableAType } from '@/lib/places/place-types';

import { assertAnonymizedPage, NEVER_KEPT } from '../../../scripts/lib/anonymize-places';

import dailyEnvelope from './fixtures/places-429-daily.json';
import minuteEnvelope from './fixtures/places-429-minute.json';
import invalidEnvelope from './fixtures/places-400-invalid.json';
import unavailableEnvelope from './fixtures/places-503.json';
import child12 from './fixtures/places-child-12.json';
import empty from './fixtures/places-empty.json';
import idsOnly from './fixtures/places-ids-only.json';
import matchPage from './fixtures/places-match-page.json';
import sidecar from './fixtures/places-recordings.json';
import saturatedP1 from './fixtures/places-saturated-p1.json';
import saturatedP2 from './fixtures/places-saturated-p2.json';
import saturatedP3 from './fixtures/places-saturated-p3.json';

/** The origin, for tests that must build a URL without spelling the host themselves
 *  (`no-network.test.ts` allows the host only under `tests/unit/msw/`). */
export const PLACES_ORIGIN = 'https://places.googleapis.com';

export const PLACES_ENDPOINT = /^https:\/\/places\.googleapis\.com\/v1\/places:searchText$/;

type Json = Record<string, unknown>;

/** The replayable pages, by scenario. Each array is the scenario's pages in token order. */
export const PLACES_PAGES = {
  saturated: [saturatedP1, saturatedP2, saturatedP3] as Json[],
  child12: [child12] as Json[],
  empty: [empty] as Json[],
  matchPage: [matchPage] as Json[],
  idsOnly: [idsOnly] as Json[],
} as const;

type Envelope = { status: number; body: { error: { code: number; status: string } } };

const ENVELOPES = {
  daily: dailyEnvelope,
  minute: minuteEnvelope,
  invalid: invalidEnvelope,
  unavailable: unavailableEnvelope,
} satisfies Record<string, Envelope>;

export type PlacesRoute =
  | { name: string; when: (body: Json) => boolean; pages: Json[] }
  | {
      name: string;
      when: (body: Json) => boolean;
      error: 'daily' | 'minute' | 'invalid' | 'unavailable';
      times?: number;
    };

export type PlacesRequest = { body: Json; mask: string | null; hasKey: boolean };

// ─── Load-time checks (the census-503 / Socrata discipline) ─────────────────────────────
//
// A fixture that drifted from its sidecar, an envelope saved as a body, or a raw capture
// that slipped in beside the synthetic files fails HERE, before any test can assert on it.

const FIXTURES_DIR = new URL('./fixtures/', import.meta.url);
const SIDECAR_FILE = 'places-recordings.json';

function fail(message: string): never {
  throw new Error(`tests/unit/msw/places.ts: ${message} See tests/unit/msw/fixtures/README.md.`);
}

if (sidecar.synthetic !== true && (sidecar.anonymized as boolean) !== true) {
  fail(`${SIDECAR_FILE} marks the fixtures neither synthetic nor anonymized (D-20).`);
}

for (const [name, envelope] of Object.entries(ENVELOPES) as Array<[string, Envelope]>) {
  if (
    typeof envelope.status !== 'number' ||
    envelope.body?.error?.code !== envelope.status ||
    typeof envelope.body.error.status !== 'string'
  ) {
    fail(`the ${name} error fixture is not a { status, body: { error } } envelope.`);
  }
}

const SIDECAR_FILES = sidecar.files as Record<
  string,
  { places: number; nextPageToken: boolean; synthetic?: boolean; anonymized?: boolean }
>;

/** Every `places-*.json` on disk, parsed — the sidecar excepted. Read from disk rather than
 *  from the imports above so a NEW fixture file is covered without anyone registering it. */
const ON_DISK: Record<string, Json> = Object.fromEntries(
  readdirSync(FIXTURES_DIR)
    .filter((f) => f.startsWith('places-') && f.endsWith('.json') && f !== SIDECAR_FILE)
    .sort()
    .map((f) => [f, JSON.parse(readFileSync(new URL(f, FIXTURES_DIR), 'utf8')) as Json]),
);

function placesOf(page: Json): Json[] {
  return Array.isArray(page.places) ? (page.places as Json[]) : [];
}

if (Object.keys(ON_DISK).join() !== Object.keys(SIDECAR_FILES).sort().join()) {
  fail(`the places-*.json files on disk and the files ${SIDECAR_FILE} lists differ.`);
}
for (const [file, page] of Object.entries(ON_DISK)) {
  const listed = SIDECAR_FILES[file];
  const count = placesOf(page).length;
  if (!listed || listed.places !== count) {
    fail(`${file} serves ${count} places but ${SIDECAR_FILE} says ${String(listed?.places)}.`);
  }
  if (listed.nextPageToken !== (typeof page.nextPageToken === 'string')) {
    fail(`${file}'s nextPageToken disagrees with ${SIDECAR_FILE}.`);
  }
  // Every file, synthetic or recorded (2026-09-23): the mask no longer requests `types` or
  // `businessStatus`, so no fixture may carry them — a hand-authored one would serve a field
  // the real API never sends us, and a recorded one would commit Google's own enum values.
  placesOf(page).forEach((place, i) => {
    for (const key of NEVER_KEPT) {
      if (key in place) fail(`${file} place ${i} carries ${key}, which no fixture may hold.`);
    }
  });
  // Per FILE (04-19): a recording the sidecar marks `anonymized: true` (written by
  // scripts/record-places-fixtures.ts) must have exactly the anonymized shape — every string one
  // of the synthetic forms, only known keys. Every other file is hand-authored, and every id in
  // it must be one we made up. A raw capture dropped in beside them fails one rule or the other.
  if (listed.anonymized === true) {
    if (listed.synthetic !== false) fail(`${file} is marked anonymized but not synthetic: false.`);
    try {
      assertAnonymizedPage(page, file);
    } catch (e) {
      fail(`${(e as Error).message}.`);
    }
  } else {
    for (const place of placesOf(page)) {
      if (typeof place.id !== 'string' || !place.id.startsWith('synthetic-')) {
        fail(`${file} carries a non-synthetic place id ${JSON.stringify(place.id)}.`);
      }
    }
  }
}

/**
 * Every Google-text string the fixtures serve: `displayName.text`, `formattedAddress`,
 * `nationalPhoneNumber` and `websiteUri`, read out of every `places-*.json` on disk. The "no
 * Places text reaches the database" and "no step returns Places content" scans search for
 * these. Deduplicated; never contains an empty string (which would match everything).
 */
export const PLACES_SENTINELS: readonly string[] = Object.freeze(
  [
    ...new Set(
      Object.values(ON_DISK)
        .flatMap(placesOf)
        .flatMap((p) => [
          (p.displayName as { text?: unknown } | undefined)?.text,
          p.formattedAddress,
          p.nationalPhoneNumber,
          p.websiteUri,
        ])
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ].sort(),
);

// ─── The handler ────────────────────────────────────────────────────────────────────────

/** Every request the handler SERVED (a 501 refusal is not logged), in order. */
export const placesRequests: PlacesRequest[] = [];

/** Every refusal's reason, in order — so a test that went red on a 501 can say why. */
export const placesRefusals: string[] = [];

let routes: PlacesRoute[] = [];
const remaining = new Map<PlacesRoute, number>();
let hook: ((r: PlacesRequest) => Promise<void> | void) | null = null;
/** Page tokens this handler issued → the page-1 bodies (canonical JSON) it issued them for. */
const issued = new Map<string, Set<string>>();

/** Replace the route table. First route whose `when` is true answers; none → a 501 refusal
 *  (B-WR-10: route to `PLACES_PAGES.empty` explicitly for a zero-result page). */
export function setPlacesRoutes(next: PlacesRoute[]): void {
  routes = [...next];
  remaining.clear();
  for (const route of routes) {
    if ('error' in route) remaining.set(route, route.times ?? 1);
  }
}

/** Run `hook` on every served request, after it is logged and before it is answered — e.g.
 *  to assert that a reservation is open at request time. `null` clears it. */
export function onPlacesRequest(next: ((r: PlacesRequest) => Promise<void> | void) | null): void {
  hook = next;
}

/** Clear the routes, the request log and the hook. Call in `afterEach`. */
export function resetPlaces(): void {
  routes = [];
  remaining.clear();
  placesRequests.length = 0;
  placesRefusals.length = 0;
  issued.clear();
  hook = null;
}

function refuse(message: string): HttpResponse<string> {
  placesRefusals.push(message);
  return new HttpResponse(`msw places: ${message}`, { status: 501 });
}

/** The Text Search fields the product ever requests (src/lib/budget/field-mask-tier.ts). A mask
 *  naming anything else — `types`, `businessStatus`, a Pro field — is a request we never price. */
const KNOWN_FIELDS = new Set([
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'pureServiceAreaBusiness',
  'websiteUri',
  'nationalPhoneNumber',
  'rating',
  'userRatingCount',
]);

/** Every key request.ts may put on a body. */
const BODY_KEYS = new Set([
  'textQuery',
  'includedType',
  'strictTypeFiltering',
  'locationRestriction',
  'includePureServiceAreaBusinesses',
  'pageSize',
  'regionCode',
  'languageCode',
  'pageToken',
]);

/** JSON with sorted keys, so two equal bodies compare equal whatever their key order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Json;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * The whole request contract request.ts fixes (B-WR-10), not only the service-area flag. Returns
 * what is wrong, or null. The harness answers a violation with a 501 — as Google would answer
 * INVALID_ARGUMENT — never a page that makes the regression look right.
 */
function contractViolation(json: Json): string | null {
  for (const key of Object.keys(json)) {
    if (!BODY_KEYS.has(key)) return `unexpected body key ${JSON.stringify(key)}`;
  }
  if (json.includePureServiceAreaBusinesses !== true) {
    return 'includePureServiceAreaBusinesses is not true (PLACE-05)';
  }
  if (json.strictTypeFiltering !== true) return 'strictTypeFiltering is not true';
  if (json.pageSize !== 20) return 'pageSize is not 20';
  if (json.regionCode !== 'US') return 'regionCode is not US';
  if (json.languageCode !== 'en') return 'languageCode is not en';
  if (typeof json.includedType !== 'string' || !isTableAType(json.includedType)) {
    return 'includedType is not a Table A type';
  }
  if (json.textQuery !== json.includedType.replaceAll('_', ' ')) {
    return 'textQuery is not the includedType, spelled';
  }
  type Corner = { latitude?: unknown; longitude?: unknown };
  const rect = (
    json.locationRestriction as { rectangle?: { low?: Corner; high?: Corner } } | undefined
  )?.rectangle;
  const low = rect?.low;
  const high = rect?.high;
  if (
    !low ||
    !high ||
    !isFiniteNumber(low.latitude) ||
    !isFiniteNumber(low.longitude) ||
    !isFiniteNumber(high.latitude) ||
    !isFiniteNumber(high.longitude) ||
    low.latitude >= high.latitude ||
    low.longitude >= high.longitude
  ) {
    return 'locationRestriction.rectangle is not an ordered low/high rectangle';
  }
  if (json.pageToken !== undefined && typeof json.pageToken !== 'string') {
    return 'pageToken is not a string';
  }
  return null;
}

/** `regionCode: 'US'` makes Google omit the country from a US address (B-CR-01): a fixture that
 *  still carries it is served the way Google would serve it. */
function asRegionUs(place: Json): Json {
  if (typeof place.formattedAddress !== 'string') return place;
  return {
    ...place,
    formattedAddress: place.formattedAddress.replace(/,\s*(USA|United States)\s*$/, ''),
  };
}

function project(page: Json, fields: ReadonlySet<string>, withToken: boolean): Json {
  const out: Json = {};
  if (Array.isArray(page.places)) {
    out.places = (page.places as Json[]).map((place) =>
      Object.fromEntries(Object.entries(asRegionUs(place)).filter(([key]) => fields.has(key))),
    );
  }
  if (withToken && typeof page.nextPageToken === 'string') out.nextPageToken = page.nextPageToken;
  return out;
}

export const placesHandler = http.post(PLACES_ENDPOINT, async ({ request }) => {
  const key = request.headers.get('x-goog-api-key');
  const mask = request.headers.get('x-goog-fieldmask');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse('the request body is not JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return refuse('the request body is not a JSON object');
  }
  const json = body as Json;

  if (!mask) return refuse('no X-Goog-FieldMask header (every request must name its fields)');
  if (!key) return refuse('no X-Goog-Api-Key header');
  const violation = contractViolation(json);
  if (violation) return refuse(violation);

  const entries = mask
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const fields = new Set<string>();
  let withToken = false;
  for (const entry of entries) {
    if (entry === 'nextPageToken') withToken = true;
    else if (
      entry.startsWith('places.') &&
      entry.length > 'places.'.length &&
      !entry.includes('*')
    ) {
      const field = entry.slice('places.'.length).split('.')[0] as string;
      if (!KNOWN_FIELDS.has(field)) return refuse(`field ${JSON.stringify(field)} is never masked`);
      fields.add(field);
    } else {
      // A wildcard would bill the highest SKU; anything else is not a Text Search field.
      return refuse(`unrecorded field-mask entry ${JSON.stringify(entry)}`);
    }
  }

  const { pageToken, ...routable } = json;
  // M49: a later page is page 1's body plus the token the harness issued for THAT body.
  if (pageToken !== undefined) {
    const bodies = issued.get(pageToken as string);
    if (!bodies) return refuse(`pageToken ${JSON.stringify(pageToken)} was never issued`);
    if (!bodies.has(canonical(routable))) {
      return refuse('a later page whose body differs from page 1 (Google: INVALID_ARGUMENT)');
    }
  }

  const route = routes.find(
    (r) => (!('error' in r) || (remaining.get(r) ?? 0) > 0) && r.when(routable),
  );
  // B-WR-10: never a best-effort page. An unrecognised request is a test that did not say what
  // Google should answer — or a builder regression (a wrong rectangle, type or body).
  if (!route) return refuse('no route claims this request');

  const logged: PlacesRequest = { body: json, mask, hasKey: true };
  placesRequests.push(logged);
  await hook?.(logged);

  if ('error' in route) {
    remaining.set(route, (remaining.get(route) ?? 1) - 1);
    const envelope = ENVELOPES[route.error];
    return HttpResponse.json(envelope.body as JsonBodyType, { status: envelope.status });
  }

  let index = 0;
  if (pageToken !== undefined) {
    const n = typeof pageToken === 'string' ? /:p(\d+)$/.exec(pageToken)?.[1] : undefined;
    if (!n) return refuse(`unreadable pageToken ${JSON.stringify(pageToken)}`);
    index = Number(n) - 1;
  }
  const page = route.pages[index];
  if (!page) {
    return refuse(
      `route ${route.name} has no page ${index + 1} (it recorded ${route.pages.length})`,
    );
  }
  const served = project(page, fields, withToken);
  if (typeof served.nextPageToken === 'string') {
    // Remember which body this token was issued for: the next page must be that body + token.
    const bodies = issued.get(served.nextPageToken) ?? new Set<string>();
    bodies.add(canonical(routable));
    issued.set(served.nextPageToken, bodies);
  }
  return HttpResponse.json(served as JsonBodyType);
});
