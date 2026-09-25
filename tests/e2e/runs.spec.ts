import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import type { HostClass } from '@/lib/places/host-class';
import {
  decide,
  toPlaceForMatch,
  type PlaceFeatures,
  type ScoredCandidate,
} from '@/lib/places/match';
import { toPageRecord, type PageRecordItem } from '@/lib/places/page-record';
import { periodStart } from '@/lib/budget/period';

/**
 * The run report on a REAL rendered screen (plan 04-28; PLACE-06 / PLACE-03; 04-UI-SPEC Rules 29,
 * 36, 37; § Accessibility). The unit registry (tests/unit/google-maps-attribution.test.tsx)
 * proves the tag is PRESENT wherever a Places value renders; jsdom paints nothing, so only a
 * browser can prove what the tag LOOKS like. This file pins Google's policy colours as the
 * browser computed them — rgb(94, 94, 94) in light, rgb(255, 255, 255) in dark — and the
 * Roboto stack, on the built app, in both themes, driven through the real theme control.
 *
 * 🔴 ASSERTS ON `data-testid`, ATTRIBUTES AND NUMBERS, NEVER ON COPY (as preset-detail.spec).
 *
 * 🔴 THE RUN IS SEEDED THROUGH THE SHIPPED WRITERS, UNDER THE TENANT'S CLAIMS — the producer →
 * consumer contract 04-20's db test holds (tests/db/places-run-report.test.ts). The owner seeds
 * only what is not a Places table (the preset, its version, the `runs` row). Everything the
 * report reads comes from the definers the workflow calls:
 *   * searches and tiles — `app.plan_run_searches`;
 *   * outcomes, the attachment, the tentative listing, observations — `app.record_places_page`,
 *     fed a `PageRecord` built by the real chain `toPlaceForMatch` → `decide` → `toPageRecord`;
 *   * progress, saturation, the truncated tile — `app.mark_run_search`;
 *   * two settled ledger rows — `app.reserve_budget` + `app.settle_reservation`, at 0 µUSD (the
 *     free tier), so the local meter's spent total never moves.
 * The run is inserted `running` (every definer requires an active run), seeded, marked
 * `complete`, and only then COMMITTED — the app never sees it live, and no Workflow exists for
 * it. 🔴 NO GOOGLE REQUEST, AND THIS SPEC CANNOT START A RUN (Rules 38, 39): it never opens a
 * run drawer and never clicks a confirm.
 *
 * 🔴 THE DATABASE IS SHARED AND IS LEFT AS FOUND. Everything is scoped by `PREFIX` and by the
 * seeded run ids, and deleted in FK order in `afterAll` (and before seeding, for residue from an
 * interrupted run). `place_observations` is APPEND-ONLY EVEN FOR THE OWNER (drizzle/0027 § 9,
 * D-10): its trigger refuses every DELETE. The teardown therefore removes THIS run's
 * observations — and only those — with `set local session_replication_role = replica`, which
 * suspends triggers for that one statement's transaction on this one connection (the local
 * owner is a superuser; CI never runs this file). The role is set back to `origin` for every
 * other delete, so the foreign keys are enforced again: deleting the `runs` row would refuse if
 * any observation or coordinate of it were left behind.
 *
 * 🔴 LOCAL TARGET ONLY — the two-databases trap, verbatim from preset-detail.spec.ts: `withDb()`
 * opens `TEST_DATABASE_URL` (the local `siteless_test`) and `tenantId()` reads the org id out
 * of the app at `E2E_BASE_URL`. They are one database only when the target is local. Seeding
 * the deployed app's database would need the production OWNER credential, which
 * docs/deploy.md § 3 forbids off this machine (T-4-01).
 */

const PREFIX = 'e2e-04-28';

const TARGET_IS_LOCAL = ((): boolean => {
  const raw = process.env.E2E_BASE_URL;
  if (!raw) return false;
  try {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(raw).hostname);
  } catch {
    return false;
  }
})();

test.skip(
  !TARGET_IS_LOCAL,
  'seeds the LOCAL database; the deployed app reads another one (two-databases trap)',
);

/** Google's attribution policy colours, as the browser paints them (04-08; Rule 29). */
const TAG_LIGHT = 'rgb(94, 94, 94)';
const TAG_DARK = 'rgb(255, 255, 255)';

/** A namespaced tile unit: `place_tiles` is unique per (org, tile_key) and shared across runs,
 *  so a fixture tile must never share a key with a real one. */
const UNIT = `${PREFIX}/McAllen`;
const PLACES_TYPE = 'roofing_contractor';
const CTX = { clusterKey: 'home_services', queriedCity: 'McAllen' };

/** Numeric-only, as `pa_features_numeric` (drizzle/0029) demands. */
const FEATURES: PlaceFeatures = {
  name: 30,
  phone: 40,
  address: 25,
  distance: 0,
  cluster: 5,
  nameSim: 1,
  distanceM: 12,
  signals: ['name', 'phone', 'address'],
  listingPhone: 1,
  listingLocation: 1,
};

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('runs.spec: TEST_DATABASE_URL is not set');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** One transaction; any failure rolls the whole seed or teardown back. */
async function inTx<T>(c: Client, fn: () => Promise<T>): Promise<T> {
  await c.query('begin');
  try {
    const out = await fn();
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
}

function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`runs.spec: ${what} is missing`);
  return value;
}

/** The tenant this signed-in session resolves to, read from the product's own answer. */
async function tenantId(page: Page): Promise<string> {
  await page.goto('/settings/organization');
  const id = await page.getByTestId('org-row-id').innerText();
  expect(id).not.toHaveLength(0);
  return id.trim();
}

function searchSpec(quad: string): Record<string, unknown> {
  return {
    tileKey: `city:${UNIT}|${PLACES_TYPE}|${quad}`,
    cellKey: `home_services/${UNIT}`,
    clusterKey: 'home_services',
    unitKind: 'city',
    unitId: UNIT,
    placesType: PLACES_TYPE,
    quadPath: quad,
    depth: quad.length - 1,
    south: 26.15,
    west: -98.3,
    north: 26.3,
    east: -98.18,
    parentTileKey: quad === 'r' ? null : `city:${UNIT}|${PLACES_TYPE}|r`,
    kind: 'enterprise',
  };
}

/** One listing through the real producer chain (as tests/db/places-run-report.test.ts). */
function listing(placeId: string, cands: ScoredCandidate[], host: HostClass): PageRecordItem {
  const pfm = toPlaceForMatch(
    {
      id: placeId,
      formattedAddress: 'McAllen, TX 78501',
      location: { latitude: 26.2159, longitude: -98.2336 },
      pureServiceAreaBusiness: false,
    },
    CTX,
  );
  return {
    decision: decide(pfm, cands),
    pureSab: pfm.pureSab,
    hadWebsiteUri: host !== 'none',
    hostClass: host,
    lat: pfm.lat,
    lng: pfm.lng,
  };
}

type Fixture = { searchId: string; runId: string };

/**
 * A `complete` McAllen × home_services full sweep: two searches (the root saturated and split;
 * its child still truncated at the minimum size), one attached listing (a dead Google site),
 * one tentative, one unmatched, and two settled ledger rows.
 */
async function seedFinishedRun(orgId: string): Promise<Fixture> {
  return withDb((c) =>
    inTx(c, async () => {
      const clerkOrgId = must(
        (
          await c.query<{ clerk_org_id: string }>('select clerk_org_id from orgs where id = $1', [
            orgId,
          ])
        ).rows[0]?.clerk_org_id,
        'the tenant org',
      );
      const seeded = 'reference rows are not seeded; run db:seed';
      const clusterId = must(
        (
          await c.query<{ id: string }>(
            "select id from industry_clusters where org_id is null and key = 'home_services'",
          )
        ).rows[0]?.id,
        seeded,
      );
      const cityId = must(
        (
          await c.query<{ id: string }>(
            "select id from cities where org_id is null and lower(name) = 'mcallen' order by id limit 1",
          )
        ).rows[0]?.id,
        seeded,
      );
      // Two of the tenant's own live businesses with no Google listing yet: one attached, one
      // tentative. The writer re-reads each under the org and skips a merged one.
      const biz = (
        await c.query<{ id: string }>(
          `select b.id from businesses b
            where b.org_id = $1 and b.merged_into_id is null and b.closed_at is null
              and not exists (select 1 from place_attachments pa where pa.business_id = b.id)
            order by b.id limit 2`,
          [orgId],
        )
      ).rows;
      const attachedBiz = must(biz[0]?.id, 'a live business for the attached listing');
      const tentativeBiz = must(biz[1]?.id, 'a live business for the tentative listing');

      // As the owner: the preset, its version and the run — none of them a Places table.
      const searchId = must(
        (
          await c.query<{ id: string }>(
            `insert into searches (org_id, name_internal, display_name, status)
             values ($1, $2, $2, 'active') returning id`,
            [orgId, `${PREFIX} McAllen home services`],
          )
        ).rows[0]?.id,
        'the inserted search',
      );
      const versionId = must(
        (
          await c.query<{ id: string }>(
            `insert into search_versions (org_id, search_id, version, cluster_ids, geo_kind, geo_payload)
             values ($1, $2, 1, $3::uuid[], 'cities', $4::jsonb) returning id`,
            [orgId, searchId, [clusterId], JSON.stringify({ cityIds: [cityId] })],
          )
        ).rows[0]?.id,
        'the inserted version',
      );
      await c.query('update searches set current_version_id = $1 where id = $2', [
        versionId,
        searchId,
      ]);
      const runId = must(
        (
          await c.query<{ id: string }>(
            `insert into runs (org_id, search_version_id, status, kind, ceiling_requests,
                               estimate_requests_lo, estimate_requests_hi,
                               estimate_micro_usd_lo, estimate_micro_usd_hi, started_at)
             values ($1, $2, 'running', 'full_sweep', 8, 1, 4, 35000, 140000,
                     now() - interval '3 minutes')
             returning id`,
            [orgId, versionId],
          )
        ).rows[0]?.id,
        'the inserted run',
      );

      // As the tenant, through the shipped definers.
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({
          o: { id: clerkOrgId, rol: 'admin' },
          sub: `user_${PREFIX}`,
          role: 'authenticated',
        }),
      ]);
      await c.query('set local role authenticated');

      const planned = await c.query<{ search_id: string; tile_key: string }>(
        'select search_id, tile_key from app.plan_run_searches($1, $2::jsonb)',
        [runId, JSON.stringify([searchSpec('r'), searchSpec('r0')])],
      );
      const ids: Record<string, string> = {};
      for (const row of planned.rows) ids[row.tile_key.split('|')[2] ?? ''] = row.search_id;
      const root = must(ids.r, 'the root search');
      const child = must(ids.r0, 'the child search');

      const record = toPageRecord({
        page: 1,
        sku: 'ts_enterprise',
        resultsSoFar: 3,
        items: [
          listing(
            `ChIJ-${PREFIX}-attached`,
            [{ businessId: attachedBiz, score: 97, features: FEATURES }],
            'business_site_dead',
          ),
          listing(
            `ChIJ-${PREFIX}-tentative`,
            [{ businessId: tentativeBiz, score: 85, features: FEATURES }],
            'social',
          ),
          listing(`ChIJ-${PREFIX}-unmatched`, [], 'none'),
        ],
      });
      await c.query('select app.record_places_page($1, $2::jsonb)', [root, JSON.stringify(record)]);

      const mark = (searchId: string, state: Record<string, unknown>) =>
        c.query('select app.mark_run_search($1, $2::jsonb)', [searchId, JSON.stringify(state)]);
      await mark(root, { status: 'done', saturated: true, subdivided: true });
      await mark(child, {
        status: 'done',
        saturated: true,
        truncated: true,
        truncated_why: 'min_size',
      });

      // Two settled requests at 0 µUSD (inside the free 1,000): reserve holds one µUSD, the
      // settle releases it and spends nothing — the local meter ends where it started.
      for (let n = 1; n <= 2; n += 1) {
        const reservationId = must(
          (
            await c.query<{ reservation_id: string | null }>(
              'select reservation_id from app.reserve_budget($1, $2::date, $3::bigint, $4::uuid, $5)',
              ['places', periodStart(new Date()), '1', runId, 'ts_enterprise'],
            )
          ).rows[0]?.reservation_id,
          'a reservation (the meter refused it)',
        );
        const settled = await c.query<{ ok: boolean }>(
          'select app.settle_reservation($1::uuid, $2, $3::bigint, 1, $4, $5) as ok',
          [reservationId, `${PREFIX}:${runId}:${n}`, '0', 'ts_enterprise', 'places'],
        );
        if (settled.rows[0]?.ok !== true) throw new Error('runs.spec: a settle was refused');
      }

      // Finished — only now does anything become visible to the app.
      await c.query('reset role');
      await c.query(
        `update runs set status = 'complete', finished_at = now(), calls_count = 2,
                         cost_micro_usd = 0
          where id = $1`,
        [runId],
      );
      return { searchId, runId };
    }),
  );
}

/** Everything this file created, in FK order. */
async function teardown(orgId: string) {
  await withDb((c) =>
    inTx(c, async () => {
      const args = [orgId, `${PREFIX}%`];
      const runs = `select r.id from runs r
                      join search_versions v on v.id = r.search_version_id
                      join searches s on s.id = v.search_id
                     where s.org_id = $1 and s.display_name like $2`;
      const tileIds = (
        await c.query<{ tile_id: string }>(
          `select distinct tile_id from run_searches where run_id in (${runs})`,
          args,
        )
      ).rows.map((r) => r.tile_id);

      await c.query(
        `delete from place_coordinates where observation_id in (
           select id from place_observations where run_id in (${runs}))`,
        args,
      );
      // The append-only wall, lifted for THIS statement's transaction on THIS connection only.
      await c.query('set local session_replication_role = replica');
      await c.query(`delete from place_observations where run_id in (${runs})`, args);
      await c.query('set local session_replication_role = origin');

      await c.query(`delete from run_place_outcomes where run_id in (${runs})`, args);
      await c.query(
        `delete from place_attachments
          where first_seen_run_id in (${runs}) or last_seen_run_id in (${runs})`,
        args,
      );
      await c.query('delete from place_tile_members where tile_id = any($1::uuid[])', [tileIds]);
      await c.query(`delete from run_searches where run_id in (${runs})`, args);
      await c.query('delete from place_tiles where id = any($1::uuid[])', [tileIds]);
      await c.query(`delete from cost_ledger where run_id in (${runs})`, args);
      // A hold still open (an interrupted seed) goes back to the meter before its row goes.
      await c.query(
        `with freed as (
           delete from cost_reservations
            where run_id in (${runs}) and settled_at is null and released_at is null
          returning budget_period_id, est_micro_usd
         ), totals as (
           select budget_period_id, sum(est_micro_usd) as held from freed group by budget_period_id
         )
         update budget_periods b
            set reserved_micro_usd = b.reserved_micro_usd - t.held
           from totals t
          where b.id = t.budget_period_id and b.reserved_micro_usd >= t.held`,
        args,
      );
      await c.query(`delete from cost_reservations where run_id in (${runs})`, args);
      await c.query(`delete from runs where id in (${runs})`, args);
      await c.query(
        'update searches set current_version_id = null where org_id = $1 and display_name like $2',
        args,
      );
      await c.query(
        `delete from search_versions where search_id in (
           select id from searches where org_id = $1 and display_name like $2)`,
        args,
      );
      await c.query('delete from searches where org_id = $1 and display_name like $2', args);
    }),
  );
}

/** Refuses to measure anything in a window that cannot be showing a real page. */
async function assertWindowIsReal(page: Page) {
  expect(await page.evaluate(() => window.innerHeight)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.innerWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
}

/** Through the real control in the real user menu, as theme-tokens.spec.ts does. */
async function chooseTheme(page: Page, theme: 'light' | 'dark') {
  const trigger = page.locator('[data-testid="user-menu"]:visible');
  await expect(trigger).toHaveCount(1);
  await trigger.click();
  const option = page.locator(`[data-testid="theme-${theme}"]:visible`);
  await expect(option).toHaveCount(1);
  await option.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
}

/** Every visible tag's painted colour and font family. */
async function paintedTags(page: Page): Promise<{ color: string; fontFamily: string }[]> {
  const tags = page.locator('[data-testid="google-maps-attribution"]:visible');
  // Tiles and Outcomes each carry exactly one (Requests is our own ledger and carries none).
  await expect(tags).toHaveCount(2);
  for (const tag of await tags.all()) await expect(tag).toBeVisible();
  return tags.evaluateAll((nodes) =>
    nodes.map((n) => {
      const s = getComputedStyle(n);
      return { color: s.color, fontFamily: s.fontFamily };
    }),
  );
}

let orgId = '';
let fixture: Fixture;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage({ storageState: 'tests/e2e/.auth/storage-state.json' });
  orgId = await tenantId(page);
  await page.close();
  await teardown(orgId); // residue from an interrupted earlier run
  fixture = await seedFinishedRun(orgId);
});

test.afterAll(async () => {
  if (orgId) await teardown(orgId);
});

test('run report: a finished run shows its status, truncation and outcomes', async ({ page }) => {
  await page.goto(`/runs/${fixture.runId}`);
  const header = page.getByTestId('run-report-header');
  await expect(header).toBeVisible();
  await expect(header.locator('[data-testid="run-status-badge"]:visible')).toHaveAttribute(
    'data-status',
    'complete',
  );

  // Criterion 3: the truncated tile is reported on a COMPLETE run.
  await expect(page.locator('[data-testid="run-truncation-warning"]:visible')).toHaveAttribute(
    'data-count',
    '1',
  );
  await expect(page.locator('[data-testid="run-outcome-attached"]:visible')).toHaveAttribute(
    'data-count',
    '1',
  );
  await expect(page.locator('[data-testid="run-outcome-tentative"]:visible')).toHaveAttribute(
    'data-count',
    '1',
  );
  await expect(page.locator('[data-testid="run-outcome-unmatched"]:visible')).toHaveAttribute(
    'data-count',
    '1',
  );
  // Terminal: nothing to refresh.
  await expect(page.getByTestId('run-refresh-now')).toHaveCount(0);
});

test('run report: the Google Maps tag is painted in both themes', async ({ page }) => {
  await page.goto(`/runs/${fixture.runId}`);
  await expect(page.getByTestId('run-report-header')).toBeVisible();
  await assertWindowIsReal(page);

  await chooseTheme(page, 'light');
  for (const t of await paintedTags(page)) {
    expect(t.color).toBe(TAG_LIGHT);
    expect(t.fontFamily).toMatch(/^"?Roboto"?,/);
  }

  await chooseTheme(page, 'dark');
  for (const t of await paintedTags(page)) {
    expect(t.color).toBe(TAG_DARK);
    expect(t.fontFamily).toMatch(/^"?Roboto"?,/);
  }
});

test('run report: on a phone Presets is lit and the truncation toggle is a 44px target', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/runs/${fixture.runId}`);
  await expect(page.getByTestId('run-report-header')).toBeVisible();
  await assertWindowIsReal(page);

  // /runs/{id} is a child of a preset (04-UI-SPEC § 0): the Presets tab is the lit one.
  await expect(page.locator('[data-testid="nav-presets"]:visible')).toHaveAttribute(
    'aria-current',
    'page',
  );

  const toggle = page.locator('[data-testid="run-truncation-toggle"]:visible');
  await expect(toggle).toHaveCount(1);
  const box = await toggle.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test('preset detail: recent runs link the finished run to its report', async ({ page }) => {
  await page.goto(`/presets/${fixture.searchId}`);
  await expect(page.getByTestId('preset-recent-runs')).toBeVisible();
  const row = page.locator(`[data-testid="preset-run-row-${fixture.runId}"]:visible`);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('href', `/runs/${fixture.runId}`);
});
