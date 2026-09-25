/**
 * The anonymized RECORDING, replayed through one Enterprise tile search (plan 04-32 Task 2;
 * D-04, D-20, D-21).
 *
 * 04-32 recorded two real Text Search Enterprise pages for `city:48215/McAllen|plumber|r`
 * against the LOCAL database (tests/unit/msw/fixtures/README.md, "Recorded (anonymized) —
 * D-04"). The recorder kept Google's structure — the place ids, the page split, the token, which
 * fields each place carried, the service-area flag — and replaced every string and number with
 * a synthetic one in memory (scripts/lib/anonymize-places.ts). This file serves those two files,
 * unchanged, through the REAL meter, candidate query, matcher and writers; only the network is
 * replayed and only the worker transaction is a double (the one in places-search-tile.test.ts,
 * copied — see that file's header). No Google call is possible: `startReplayServer` listens
 * with `onUnhandledRequest: 'error'`, and the places handler 501s any request no route claims.
 *
 * Every expectation is DERIVED from the recorded files and their sidecar entries, never typed
 * in, so a re-recording that changes the shape changes the expectations with it. The few
 * literals below (2 pages, 33 ids, 9 service areas) are sanity pins on what was recorded on
 * 2026-09-24, asserted against the derived values.
 *
 * 🔴 THE SERVICE-AREA FLAG AND THE WRITER. `place_observations` (the only Places table that
 * holds `pure_sab`) is written for a MATCHED place only (drizzle/0030 record_places_page: an
 * unmatched listing leaves its id in `place_tile_members` and an outcome, nothing else — D-06).
 * The anonymizer gives every place a `(956) 555-01NN` phone, which is never blockable, and a
 * service area has no address and no pin (D-07). So a recorded service area can score at most
 * name + cluster (45 + 5 = 50 < REVIEW_SCORE 80) against ANY business: it can never be observed,
 * whatever the spine holds. This test proves that directly — every recorded place gets an exact
 * twin in the spine (same name, phone and city; same street, ZIP and pin when it has them), every
 * located twin attaches and is observed with `pure_sab = false`, and every service-area twin is
 * left `unmatched` with no observation. The flag's positive path (a SAB with a blockable phone
 * observed with `pure_sab = true`) is places-search-tile.test.ts "a service-area listing is
 * observed with its flag", on the synthetic match page.
 */
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Tx } from '@/server/queries/budget';
import type { GeoShapesFile, Rect } from '@/lib/places/tiling';
import type { PlannedSearch } from '@/workflows/places-sweep/reducer';
import { rootSpec } from '@/lib/places/tiling';
import { addressKey } from '@/lib/normalize/address';
import { nameNorm } from '@/lib/normalize/name';
import geoShapes from '@/seed/data/geo-shapes.json';
import { seedTwoOrgs } from './_fixtures';
import { seedOvertureSide } from './_merge-fixtures';
import { asPg, closeDrizzleTx, withTxRollback } from './_drizzle-tx';
import { SPINE_BASIC_CATEGORY, seedPlacesRun, seedRunSearch } from './_places-fixtures';
import { server, startReplayServer } from '../unit/msw/server';
import {
  placesRefusals,
  placesRequests,
  resetPlaces,
  setPlacesRoutes,
  type PlacesRoute,
} from '../unit/msw/places';
import recordedP1 from '../unit/msw/fixtures/places-recorded-mcallen-plumber-p1.json';
import recordedP2 from '../unit/msw/fixtures/places-recorded-mcallen-plumber-p2.json';
import sidecar from '../unit/msw/fixtures/places-recordings.json';

// Hoisted above every import: src/env.ts parses process.env at module load and src/db/client.ts
// opens its pool from it (the places-meter prelude). The runtime pool must be the NON-OWNER
// app_user URL; CI names it RUNTIME_DB_URL.
vi.hoisted(() => {
  const url = process.env.RUNTIME_DB_URL ?? process.env.SUPABASE_DB_POOL_URL;
  if (!url) {
    throw new Error(
      'tests/db/places-recorded-replay.test.ts: neither RUNTIME_DB_URL nor SUPABASE_DB_POOL_URL is set (the non-owner runtime role).',
    );
  }
  if (/supabase\.(co|com)|pooler\.supabase/.test(url)) {
    throw new Error(
      'tests/db/places-recorded-replay.test.ts: the database URL points at a Supabase host. D-04: production is never a test target.',
    );
  }
  process.env.SUPABASE_DB_POOL_URL = url;
  process.env.CLERK_SECRET_KEY ||= 'sk_test_unused_by_the_db_suite';
});

vi.mock('server-only', () => ({}));

type SearchTile = typeof import('@/lib/places/search-tile');

const state: { tx: Tx | null } = { tx: null };

let tile: SearchTile;
let realDb: typeof import('@/db/client').db;

/** places-search-tile.test.ts's worker double, verbatim: what the real withWorkerOrg installs. */
const workerDouble = async <T>(
  clerkOrgId: string,
  actor: `workflow:${string}`,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> => {
  const outer = state.tx;
  if (!outer) throw new Error('places-recorded-replay: no test transaction is open');
  return outer.transaction(async (sp) => {
    const tx = sp as unknown as Tx;
    await tx.execute(
      sql`select set_config('request.jwt.claims', json_build_object('o', json_build_object('id', ${clerkOrgId}::text))::text, true)`,
    );
    await tx.execute(sql`select set_config('app.actor_id', ${actor}, true)`);
    await tx.execute(sql`set local role authenticated`);
    const out = await fn(tx);
    await tx.execute(sql`reset role`);
    await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
    await tx.execute(sql`select set_config('app.actor_id', '', true)`);
    return out;
  });
};

beforeAll(async () => {
  vi.resetModules();
  realDb = (await import('@/db/client')).db;
  vi.doMock('@/db/with-worker-org', () => ({ withWorkerOrg: workerDouble }));
  tile = await import('@/lib/places/search-tile');
  startReplayServer();
});

afterEach(() => {
  server.resetHandlers();
  resetPlaces();
});

afterAll(async () => {
  server.close();
  vi.doUnmock('@/db/with-worker-org');
  state.tx = null;
  await realDb.$client.end({ timeout: 5 });
  vi.resetModules();
  await closeDrizzleTx();
});

// ─── The recording, read from the files ─────────────────────────────────────────────────

type RecordedPlace = {
  id: string;
  pureServiceAreaBusiness?: boolean;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  websiteUri?: string;
};
type RecordedPage = { places?: RecordedPlace[]; nextPageToken?: string };
type SidecarEntry = {
  places: number;
  nextPageToken: boolean;
  anonymized?: boolean;
  requests?: number;
};

const RECORDED_FILES = [
  'places-recorded-mcallen-plumber-p1.json',
  'places-recorded-mcallen-plumber-p2.json',
] as const;
const PAGES: RecordedPage[] = [recordedP1 as RecordedPage, recordedP2 as RecordedPage];
const ENTRIES = RECORDED_FILES.map(
  (f) => (sidecar.files as Record<string, SidecarEntry | undefined>)[f],
);
const PLACES: RecordedPlace[] = PAGES.flatMap((p) => p.places ?? []);
const IDS = PLACES.map((p) => p.id);
const SAB = PLACES.filter((p) => p.pureServiceAreaBusiness === true);
const LOCATED = PLACES.filter((p) => p.pureServiceAreaBusiness !== true);

const TX_ZIP = /\bTX (\d{5})\b/;

/**
 * Every string the recorded files serve as Places TEXT, in the form it is SERVED and in every
 * form a writer would actually STORE it (04-REVIEW-DELTA WR-02): the name folded by `nameNorm`,
 * the street split out of the formatted address and folded by `addressKey`, the phone as E.164
 * (`+19565550101`) and as bare digits, and a URL kept as its host. A scan over the served forms
 * alone can only ever see a name. The phone's E.164 form is built from its digits, NOT through
 * `phoneE164`: the 555 exchange is rejected there (D-12), so the shipped normalizer returns null
 * for every recorded phone — a writer that stored one anyway would store exactly this form.
 * Matched case-insensitively, so an upper- or lower-cased copy is a hit too. Keyed by kind, so
 * non-vacuity is proven per kind.
 */
const SENTINEL_KINDS = [
  'name',
  'name_norm',
  'formatted_address',
  'street',
  'street_norm',
  'phone_national',
  'phone_digits',
  'phone_e164',
  'url',
  'url_host',
] as const;
type SentinelKind = (typeof SENTINEL_KINDS)[number];

function sentinelsOf(p: RecordedPlace): Array<[SentinelKind, string | null | undefined]> {
  const formatted = p.formattedAddress;
  const street = formatted?.split(',')[0]?.trim();
  const zip = formatted ? TX_ZIP.exec(formatted)?.[1] : undefined;
  const digits = p.nationalPhoneNumber?.replace(/\D/g, '');
  let host: string | undefined;
  try {
    host = p.websiteUri ? new URL(p.websiteUri).host : undefined;
  } catch {
    host = undefined;
  }
  return [
    ['name', p.displayName?.text],
    ['name_norm', nameNorm(p.displayName?.text)],
    ['formatted_address', formatted],
    ['street', street],
    ['street_norm', street ? addressKey(street, zip).streetNorm : null],
    ['phone_national', p.nationalPhoneNumber],
    ['phone_digits', digits && digits.length === 10 ? digits : null],
    ['phone_e164', e164(p.nationalPhoneNumber)],
    ['url', p.websiteUri],
    ['url_host', host],
  ];
}

const RECORDED_SENTINELS: ReadonlyArray<{ kind: SentinelKind; s: string }> = [
  ...new Map(
    PLACES.flatMap((p) => sentinelsOf(p))
      .filter((e): e is [SentinelKind, string] => typeof e[1] === 'string' && e[1].length > 0)
      .map(([kind, s]) => [`${kind}\u0000${s.toLowerCase()}`, { kind, s: s.toLowerCase() }]),
  ).values(),
].sort((x, y) => (x.kind + x.s < y.kind + y.s ? -1 : 1));

/** `kind:sentinel` for every sentinel found in any of `texts` (case-insensitive). */
function sentinelHits(texts: readonly string[]): string[] {
  return texts.flatMap((j) => {
    const lower = j.toLowerCase();
    return RECORDED_SENTINELS.filter((x) => lower.includes(x.s)).map((x) => `${x.kind}:${x.s}`);
  });
}

function kindsHit(texts: readonly string[]): Set<string> {
  return new Set(sentinelHits(texts).map((h) => h.slice(0, h.indexOf(':'))));
}

// ─── The world ──────────────────────────────────────────────────────────────────────────

const SHAPES = geoShapes as GeoShapesFile;
const MCALLEN_UNIT = '48215\u0000McAllen';
const MCALLEN = SHAPES.units.find((u) => u.unitKind === 'city' && u.unitId === MCALLEN_UNIT);
if (!MCALLEN) throw new Error('places-recorded-replay: no McAllen outline in geo-shapes.json');
const MCALLEN_BBOX: Rect = MCALLEN.bbox;

/** The recorded tile: `city:48215/McAllen|plumber|r`, the root. */
const ROOT = rootSpec({
  clusterKey: 'home_services',
  unitKind: 'city',
  unitId: MCALLEN_UNIT,
  placesType: 'plumber',
  kind: 'enterprise',
  shape: { kind: 'polygon', unitKind: 'city', unitId: MCALLEN_UNIT },
  bbox: MCALLEN_BBOX,
});

/** A service-area twin has no address or pin of its own: somewhere in McAllen, off every
 *  recorded pin by more than the ±150 m proximity box (asserted below). */
const SAB_TWIN_PIN = { lat: 26.2034, lng: -98.23 };

function e164(national: string | undefined): string | null {
  if (!national) return null;
  const digits = national.replace(/\D/g, '');
  return digits.length === 10 ? `+1${digits}` : null;
}

/**
 * One spine business per recorded place, seeded through the shipped Overture ingest path: the
 * same name, phone and city, and — for a located place — the same street, ZIP and pin. The
 * strongest spine the recording allows: whatever the matcher leaves unmatched, it leaves
 * unmatched against its exact twin.
 */
async function seedTwins(c: ReturnType<typeof asPg>, orgId: string): Promise<Map<string, string>> {
  const twins = new Map<string, string>();
  for (const [i, p] of PLACES.entries()) {
    const name = p.displayName?.text ?? `Recorded twin ${i}`;
    const phone = e164(p.nationalPhoneNumber);
    let spec: Parameters<typeof seedOvertureSide>[2];
    if (p.pureServiceAreaBusiness === true) {
      spec = {
        name,
        street: `${900 + i} Twin Service Rd`,
        zip: '78501',
        city: 'McAllen',
        lat: SAB_TWIN_PIN.lat,
        lng: SAB_TWIN_PIN.lng,
        phone,
        basicCategory: SPINE_BASIC_CATEGORY,
      };
    } else {
      const formatted = p.formattedAddress ?? '';
      const zip = TX_ZIP.exec(formatted)?.[1];
      const street = formatted.split(',')[0]?.trim();
      if (!p.location || !zip || !street) {
        throw new Error(`places-recorded-replay: recorded place ${i} is located but unaddressed`);
      }
      spec = {
        name,
        street,
        zip,
        city: 'McAllen',
        lat: p.location.latitude,
        lng: p.location.longitude,
        phone,
        basicCategory: SPINE_BASIC_CATEGORY,
      };
    }
    twins.set(p.id, (await seedOvertureSide(c, orgId, spec)).businessId);
  }
  return twins;
}

type World = {
  tx: Tx;
  orgA: string;
  runId: string;
  search: PlannedSearch;
  twins: Map<string, string>;
};

function inWorld(fn: (w: World) => Promise<void>): Promise<void> {
  return withTxRollback(async (tx) => {
    state.tx = tx;
    try {
      const c = asPg(tx);
      const { a } = await seedTwoOrgs(c);
      const twins = await seedTwins(c, a);
      const run = await seedPlacesRun(c, a, { ceilingRequests: 20 });
      const seeded = await seedRunSearch(c, a, run.runId, {
        tileKey: ROOT.tileKey,
        placesType: ROOT.placesType,
        rect: ROOT.rect,
      });
      await fn({
        tx,
        orgA: a,
        runId: run.runId,
        search: { ...ROOT, searchId: seeded.runSearchId },
        twins,
      });
    } finally {
      state.tx = null;
    }
  });
}

function rows<T>(r: unknown): T[] {
  return r as T[];
}

/** Code-point order (the database's collation orders mixed-case ids differently). */
function byPlaceId(x: { place_id: string }, y: { place_id: string }): number {
  return x.place_id < y.place_id ? -1 : x.place_id > y.place_id ? 1 : 0;
}

const RECORDED_ROUTE: PlacesRoute = {
  name: 'recorded-mcallen-plumber',
  when: (body) => body.includedType === 'plumber',
  pages: PAGES as unknown as Array<Record<string, unknown>>,
};

const TABLES = [
  'place_attachments',
  'place_observations',
  'place_coordinates',
  'place_tiles',
  'place_tile_members',
  'run_searches',
  'run_place_outcomes',
  'place_purge_runs',
  'cost_ledger',
  'cost_reservations',
  'runs',
  'events',
  // The spine's satellites: a Places writer that registered a source record, an alias or a
  // merge candidate from Google's text would land here (`businesses` itself: see the test).
  'source_records',
  'business_aliases',
  'merge_candidates',
  'business_merges',
] as const;

// ─── The test ───────────────────────────────────────────────────────────────────────────

describe('the anonymized McAllen plumber recording (04-32)', () => {
  it('recorded fixtures replay through the tile search', () =>
    inWorld(async (w) => {
      // The files are what the sidecar says they are, and what was recorded on 2026-09-24.
      for (const [i, entry] of ENTRIES.entries()) {
        expect(entry, RECORDED_FILES[i]).toMatchObject({
          anonymized: true,
          places: PAGES[i]!.places?.length ?? 0,
          nextPageToken: i < PAGES.length - 1,
        });
        expect(entry?.requests).toBe(PAGES.length);
      }
      expect(PAGES.map((p) => p.places?.length ?? 0)).toEqual([20, 13]);
      expect(new Set(IDS).size).toBe(IDS.length);
      expect(IDS).toHaveLength(33);
      expect(SAB).toHaveLength(9);
      expect(SAB.every((p) => p.location === undefined && p.formattedAddress === undefined)).toBe(
        true,
      );
      // No service-area twin's pin is inside any located place's ±150 m proximity box.
      for (const p of LOCATED) {
        const d = Math.hypot(
          p.location!.latitude - SAB_TWIN_PIN.lat,
          p.location!.longitude - SAB_TWIN_PIN.lng,
        );
        expect(d).toBeGreaterThan(0.003);
      }

      const snapshot = async (table: string): Promise<string[]> =>
        rows<{ j: string }>(
          await w.tx.execute(
            sql`select row_to_json(t)::text as j from ${sql.raw(table)} t where t.org_id = ${w.orgA}`,
          ),
        ).map((r) => r.j);
      // The scan is not vacuous, PER KIND (WR-02). The twins on the spine carry the recorded
      // text in its STORED forms — `businesses`: name, name_norm, street, street_norm; the
      // Overture payload in `source_records`: the E.164 phone and so its bare digits (the 555
      // exchange never reaches `businesses.phone_e164`, D-12) — and the served pages carry the
      // SERVED forms — the formatted address, the national phone, the URL and its host. Every
      // kind of sentinel is seen by one or the other: none is dead.
      const spine = [...(await snapshot('businesses')), ...(await snapshot('source_records'))];
      const spineKinds = kindsHit(spine);
      const STORED_KINDS: SentinelKind[] = [
        'name',
        'name_norm',
        'phone_e164',
        'phone_digits',
        'street',
        'street_norm',
      ];
      for (const k of STORED_KINDS) expect([...spineKinds], `spine: ${k}`).toContain(k);
      const servedKinds = kindsHit(PAGES.map((p) => JSON.stringify(p)));
      const SERVED_KINDS: SentinelKind[] = [
        'formatted_address',
        'phone_national',
        'url',
        'url_host',
      ];
      for (const k of SERVED_KINDS) expect([...servedKinds], `served: ${k}`).toContain(k);
      expect(new Set([...STORED_KINDS, ...SERVED_KINDS])).toEqual(new Set(SENTINEL_KINDS));
      // And every recorded place's twin is seen: its name and its E.164 phone.
      const spineHits = sentinelHits(spine);
      for (const p of PLACES) {
        expect(spineHits).toContain(`name:${p.displayName!.text!.toLowerCase()}`);
        const phone = e164(p.nationalPhoneNumber);
        if (phone !== null) expect(spineHits).toContain(`phone_e164:${phone}`);
      }

      // `businesses` cannot be scanned for sentinels — its twins legitimately carry them — so
      // the Places write path is held to "added no business and changed none": every column of
      // every org-A business, before and after (a name, phone, street or pin copied from the
      // served page onto a twin changes its row).
      const businessRows = async (): Promise<string[]> =>
        rows<{ j: string }>(
          await w.tx.execute(
            sql`select to_jsonb(b)::text as j from businesses b where b.org_id = ${w.orgA} order by b.id`,
          ),
        ).map((r) => r.j);
      const businessesBefore = await businessRows();
      expect(businessesBefore.length).toBeGreaterThanOrEqual(PLACES.length);

      const before = new Map<string, Set<string>>();
      for (const t of TABLES) before.set(t, new Set(await snapshot(t)));

      setPlacesRoutes([RECORDED_ROUTE]);
      const out = await tile.runSearchTile({ runId: w.runId, clerkOrgId: 'org_A' }, w.search, {
        mode: 'enterprise',
        shapes: SHAPES,
      });
      expect(placesRefusals).toEqual([]);

      // ── Pagination and counts: exactly the sidecar's. ──
      const total = ENTRIES.reduce((n, e) => n + (e?.places ?? 0), 0);
      expect(out).toEqual({
        kind: 'searched',
        tileKey: ROOT.tileKey,
        resultsCount: total,
        saturated: false,
        next: { action: 'done' },
      });
      expect(placesRequests).toHaveLength(ENTRIES[0]!.requests!);
      expect(placesRequests.map((r) => r.body.pageToken)).toEqual([
        undefined,
        PAGES[0]!.nextPageToken,
      ]);
      const search = rows<{
        status: string;
        saturated: boolean;
        truncated: boolean;
        pages_done: number;
        results_count: number;
      }>(
        await w.tx.execute(sql`
          select status, saturated, truncated, pages_done, results_count
            from run_searches where id = ${w.search.searchId}`),
      );
      expect(search[0]).toEqual({
        status: 'done',
        saturated: false,
        truncated: false,
        pages_done: PAGES.length,
        results_count: total,
      });
      const ledger = rows<{ sku: string; units: number }>(
        await w.tx.execute(
          sql`select sku, units from cost_ledger where run_id = ${w.runId} order by occurred_at, id`,
        ),
      );
      expect(ledger).toEqual(PAGES.map(() => ({ sku: 'ts_enterprise', units: 1 })));

      // ── Every recorded id round-trips into the tile's membership, and nothing else does. ──
      const members = rows<{ place_id: string }>(
        await w.tx.execute(sql`
          select m.place_id
            from place_tile_members m join place_tiles t on t.id = m.tile_id
           where t.org_id = ${w.orgA} and t.tile_key = ${ROOT.tileKey} and m.gone_at is null`),
      ).map((r) => r.place_id);
      expect([...members].sort()).toEqual([...IDS].sort());

      // ── Outcomes: every located place attaches to its twin; every service area cannot. ──
      const outcomes = Object.fromEntries(
        rows<{ place_id: string; outcome: string }>(
          await w.tx.execute(
            sql`select place_id, outcome from run_place_outcomes where run_id = ${w.runId}`,
          ),
        ).map((r) => [r.place_id, r.outcome]),
      );
      expect(outcomes).toEqual(
        Object.fromEntries(
          PLACES.map((p) => [p.id, p.pureServiceAreaBusiness === true ? 'unmatched' : 'attached']),
        ),
      );

      // ── The service-area flag, as the writer records it (see the header). ──
      const obs = rows<{ place_id: string; business_id: string; pure_sab: boolean }>(
        await w.tx.execute(sql`
          select place_id, business_id::text as business_id, pure_sab
            from place_observations where run_id = ${w.runId}`),
      ).sort(byPlaceId);
      // One observation per MATCHED place, on its twin, carrying the recording's own flag.
      const observed = PLACES.filter((p) => outcomes[p.id] !== 'unmatched');
      expect(obs).toEqual(
        observed
          .map((p) => ({
            place_id: p.id,
            business_id: w.twins.get(p.id),
            pure_sab: p.pureServiceAreaBusiness === true,
          }))
          .sort(byPlaceId),
      );
      // A pure_sab observation exists iff a recorded SAB was matched: the recording held 9
      // service areas, and a 555 phone with no address or pin can match none of them.
      const sabObserved = SAB.filter((p) => outcomes[p.id] !== 'unmatched').length;
      expect(obs.filter((o) => o.pure_sab)).toHaveLength(sabObserved);
      expect(sabObserved).toBe(0);
      expect(obs).toHaveLength(LOCATED.length);
      expect(obs.every((o) => !o.pure_sab)).toBe(true);
      // And no service area left a pin behind (D-07): coordinates only for the located places.
      const coords = rows<{ n: number }>(
        await w.tx.execute(sql`
          select count(*)::int as n
            from place_coordinates c join place_observations o on o.id = c.observation_id
           where o.run_id = ${w.runId}`),
      );
      expect(coords[0]?.n).toBe(LOCATED.length);

      // ── The spine: no business added, none changed. ── Asserted first, so a write onto a
      // twin is reported here rather than as the audit row it also leaves in `events`.
      expect(await businessRows()).toEqual(businessesBefore);

      // ── The sentinel scan: no recorded string, served or stored form, reached any table. ──
      expect(RECORDED_SENTINELS.length).toBeGreaterThan(PLACES.length);
      let written = 0;
      for (const t of TABLES) {
        const fresh = (await snapshot(t)).filter((j) => !before.get(t)!.has(j));
        written += fresh.length;
        expect({ table: t, hits: sentinelHits(fresh) }).toEqual({ table: t, hits: [] });
      }
      // The page really wrote: 33 members, 24 attachments + observations, 33 outcomes, ledger.
      expect(written).toBeGreaterThan(IDS.length * 2);
    }));
});
