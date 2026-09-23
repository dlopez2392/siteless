import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

/**
 * SRCH-03, D-16, D-17 and BUDG-02's success criterion 5, driven through the browser.
 *
 * 🔴 ASSERTS ON `data-testid` AND ON NUMBERS, NEVER ON COPY. Every sentence this screen
 * renders lives in `src/lib/ui/copy.ts` or in UI-SPEC's copy table and is still being
 * restyled across Phase 2; an assertion on wording would break on a rewrite and prove
 * nothing about whether the version actually kept its run. Where a count matters the
 * markup carries `data-used-by-count`, so the test pins SRCH-03's real claim — which
 * version a finished run still points at — rather than the phrase that renders it.
 *
 * 🔴 THE FIXTURE IS INSERTED WITH SQL, AND THAT IS A DEPENDENCY, NOT A PREFERENCE. The
 * preset editor is plan 02-11's and is not on this branch, so there is no UI path that
 * creates a preset here. The budget-banner spec's rule — drive state through the product,
 * not through SQL — still holds for everything this file actually tests: the duplicate and
 * the run both go through the real server actions via the real UI. Only the starting row
 * is seeded. When 02-11 lands, the two-version fixture should be rebuilt through the
 * editor and this helper deleted.
 *
 * 🔴 THE DATABASE IS SHARED AND IS LEFT AS FOUND. `siteless_test` is one database for the
 * whole repo. Everything this file creates is prefixed, deleted in `afterAll` in FK order
 * (ledger -> reservations -> runs -> versions -> searches), and the reservations the run
 * test takes are released so `budget_periods.reserved_micro_usd` returns to what it was.
 * `runs.search_version_id` is `on delete no action` BY DESIGN — that is SRCH-03's
 * mechanism — so the runs must go before the versions or the teardown is refused.
 *
 * 🔴 THIS FILE ONLY RUNS AGAINST A LOCAL TARGET, AND THE SKIP BELOW IS DELIBERATE — SEE
 * `TARGET_IS_LOCAL`. Read that comment before assuming the skip is laziness.
 */

const PREFIX = 'e2e-02-12';

/**
 * 🔴 THE FIXTURE AND THE APP MUST BE THE SAME DATABASE, AND THEY ONLY ARE WHEN THE TARGET
 * IS LOCAL. THIS SKIP IS A SCOPE DECISION BY danlo (2026-09-22, plan 02-15 Task 2), NOT A
 * WORKAROUND FOR A RED TEST.
 *
 * This is the only spec in the suite that writes to a database directly. Two lines decide
 * which one: `withDb()` opens `TEST_DATABASE_URL` — always the LOCAL `siteless_test` — while
 * `tenantId()` reads the org id out of the app that `E2E_BASE_URL` points at. Against a
 * local dev server those are one database and the fixture seeds correctly (plan 02-12 ran
 * this file green that way, and so did the 02-15 orchestrator). Against a DEPLOYED url they
 * are two different databases: `beforeAll` inserts production's org id into local
 * `siteless_test`, where no such `orgs` row exists, and PostgreSQL refuses it with
 * `searches_org_id_orgs_id_fk`. That is a fixture that cannot work, not a product defect —
 * the three tests below never start.
 *
 * Pointing the fixture at the deployed app's database instead is the alternative, and it is
 * refused on security grounds: the only credential that can seed and tear down rows in
 * production Supabase is `SUPABASE_DB_URL`, the project OWNER, which bypasses row-level
 * security. `docs/deploy.md` §3 forbids that credential from ever leaving a developer
 * machine, and running this file in CI would mean adding it to GitHub Actions secrets.
 * No test is worth that trade. (The same two lines are also why CI has never executed this
 * file: `TEST_DATABASE_URL` is undefined on a runner, so `withDb` throws its own named
 * error. This skip closes that hole too, honestly, instead of leaving it to be discovered.)
 *
 * 🔴 WHAT CARRIES SRCH-03 WHEN THIS FILE IS SKIPPED — a permanently skipped test reads the
 * same as a passing one in a summary line, so name the replacement rather than implying it:
 *
 *     tests/db/versioned-presets.test.ts → 'run keeps its version after the preset moves on'
 *
 * It is the same claim at the layer that owns it — a finished run still points at the
 * version that produced it after the preset moves on — it is watched red under plan 02-06's
 * M12 grant mutation (`grant update on public.search_versions to authenticated` reds
 * `versions immutable` alone while `run keeps its version` stays green), and it runs on
 * EVERY push in CI's `db` job, which this file has never run in. The browser-level assertion
 * here is additional evidence, not the only evidence.
 *
 * Nothing below is weakened, deleted or made conditional. `pnpm test:e2e` against a local
 * server runs all three tests exactly as written.
 */
const TARGET_IS_LOCAL = ((): boolean => {
  const raw = process.env.E2E_BASE_URL;
  if (!raw) return false;
  try {
    // `new URL('http://[::1]:3000').hostname` is the bracketed form — match it as spelled.
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(raw).hostname);
  } catch {
    return false;
  }
})();

test.skip(
  !TARGET_IS_LOCAL,
  'preset-detail.spec seeds the LOCAL siteless_test database and therefore only runs against a ' +
    'local E2E_BASE_URL. Against a deployed target the fixture and the app are two different ' +
    'databases (the org id comes from the app, the rows go to local Postgres, and the FK ' +
    'searches_org_id_orgs_id_fk refuses it), and the only credential that could seed the ' +
    "deployed app's database is the project owner, which docs/deploy.md §3 forbids off this " +
    'machine. SRCH-03 is carried in CI by tests/db/versioned-presets.test.ts → "run keeps its ' +
    'version after the preset moves on", watched red under 02-06 M12 and run by the db job.',
);

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('preset-detail.spec: TEST_DATABASE_URL is not set');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** The tenant this signed-in session resolves to, read from the product's own answer
 *  rather than from a constant this file would have to keep in step with Clerk. */
async function tenantId(page: Page): Promise<string> {
  await page.goto('/settings/organization');
  const id = await page.getByTestId('org-row-id').innerText();
  expect(id).not.toHaveLength(0);
  return id.trim();
}

type Fixture = { searchId: string; v1: string; v2: string };

/**
 * A row that must exist, or the fixture is not what this file thinks it is.
 *
 * Spelled out rather than asserted away with `!`: a loosely typed fixture letting
 * `undefined` through is a recorded defect in this repo's history, and the failure it
 * produces here ("reference rows are not seeded") is one a reader can act on, where
 * `Cannot read properties of undefined` is one they have to debug.
 */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`preset-detail.spec: ${what} is missing`);
  return value;
}

/**
 * A preset with TWO versions and one finished run against version 1 — the exact shape
 * SRCH-03 is about. Version 2 drops a cluster and adds a city, so the diff sentence has
 * something concrete on both sides.
 */
async function seedTwoVersionPreset(orgId: string): Promise<Fixture> {
  return withDb(async (c) => {
    // `industry_clusters`, not `clusters` — the TypeScript export is `industryClusters`
    // and the table name follows it. Worth spelling out: the first run of this spec failed
    // on `relation "clusters" does not exist`, which is the only way that assumption was
    // ever going to be corrected.
    const clusters = await c.query<{ id: string }>(
      `select id from industry_clusters
        where key in ('home_services','food_hospitality') order by key`,
    );
    const cities = await c.query<{ id: string }>(
      `select id from cities order by name limit 3`,
    );
    const seeded = 'reference rows are not seeded; run db:seed';
    const c1 = must(clusters.rows[0], seeded).id;
    const c2 = must(clusters.rows[1], seeded).id;
    const city1 = must(cities.rows[0], seeded).id;
    const city2 = must(cities.rows[1], seeded).id;
    const city3 = must(cities.rows[2], seeded).id;

    const search = await c.query<{ id: string }>(
      `insert into searches (org_id, name_internal, display_name, status)
       values ($1, $2, $2, 'active') returning id`,
      [orgId, `${PREFIX} Hidalgo — home services`],
    );
    const searchId = must(search.rows[0], 'the inserted search').id;

    const insertVersion = async (n: number, clusterIds: string[], cityIds: string[]) => {
      const row = await c.query<{ id: string }>(
        `insert into search_versions (org_id, search_id, version, cluster_ids, geo_kind, geo_payload)
         values ($1, $2, $3, $4::uuid[], 'cities', $5::jsonb) returning id`,
        [orgId, searchId, n, clusterIds, JSON.stringify({ cityIds })],
      );
      return must(row.rows[0], `version ${n}`).id;
    };

    const v1 = await insertVersion(1, [c1, c2], [city1, city2]);
    // Version 2: one cluster removed, one city added. Both sides of the diff populated.
    const v2 = await insertVersion(2, [c1], [city1, city2, city3]);

    await c.query(`update searches set current_version_id = $1 where id = $2`, [v2, searchId]);

    // The run that must STAY on version 1 after the edit. Inserted `complete` so it reads
    // as history rather than as something the drawer is about to touch.
    await c.query(
      `insert into runs (org_id, search_version_id, status, cost_micro_usd, calls_count, finished_at)
       values ($1, $2, 'complete', 2310000, 4, now())`,
      [orgId, v1],
    );

    return { searchId, v1, v2 };
  });
}

/** Everything this file created, in FK order, plus the meter it moved. */
async function teardown(orgId: string) {
  await withDb(async (c) => {
    const scope = `select id from searches where org_id = $1 and display_name like $2`;
    const like = `%${PREFIX}%`;
    const versions = `select id from search_versions where search_id in (${scope})`;

    await c.query(
      `delete from cost_ledger where reservation_id in (
         select id from cost_reservations where run_id in (
           select id from runs where search_version_id in (${versions})))`,
      [orgId, like],
    );

    /**
     * 🔴 GIVE THE HOLD BACK BEFORE DELETING THE ROW THAT RECORDS IT.
     *
     * `budget_periods.reserved_micro_usd` is a running total; `cost_reservations` is the
     * detail behind it. Deleting the detail alone strands the total — the meter keeps
     * counting money nothing is holding — and the next caller's `app.reserve_budget`
     * self-heal then tries to free reservations that are no longer there and drives the
     * column negative, which `bp_non_negative` refuses with `23514`. That turns into
     * "Something broke on our side" for EVERY tenant of this database until somebody
     * fixes the row by hand.
     *
     * This is not hypothetical: it is the exact state a concurrent agent left
     * `siteless_test` in during 02-12, and it broke this suite's run test for one cycle.
     * Decrement and delete in one statement, and only by what these rows actually hold.
     */
    await c.query(
      `with freed as (
         delete from cost_reservations
          where run_id in (select id from runs where search_version_id in (${versions}))
            and settled_at is null and released_at is null
        returning budget_period_id, est_micro_usd
       ), totals as (
         select budget_period_id, sum(est_micro_usd) as held from freed group by budget_period_id
       )
       update budget_periods b
          set reserved_micro_usd = b.reserved_micro_usd - t.held
         from totals t
        where b.id = t.budget_period_id and b.reserved_micro_usd >= t.held`,
      [orgId, like],
    );
    // Anything already settled or released is not holding budget; remove the rows only.
    await c.query(
      `delete from cost_reservations where run_id in (
         select id from runs where search_version_id in (${versions}))`,
      [orgId, like],
    );
    await c.query(`delete from runs where search_version_id in (${versions})`, [orgId, like]);
    await c.query(`update searches set current_version_id = null where org_id = $1 and display_name like $2`, [orgId, like]);
    await c.query(`delete from search_versions where search_id in (${scope})`, [orgId, like]);
    await c.query(`delete from searches where org_id = $1 and display_name like $2`, [orgId, like]);
  });
}

let orgId = '';
let fixture: Fixture;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage({ storageState: 'tests/e2e/.auth/storage-state.json' });
  orgId = await tenantId(page);
  await page.close();
  await teardown(orgId); // any residue from an interrupted earlier run
  fixture = await seedTwoVersionPreset(orgId);
});

test.afterAll(async () => {
  if (orgId) await teardown(orgId);
});

test('preset detail: a saved edit shows two versions and the run keeps the old one', async ({
  page,
}) => {
  await page.goto(`/presets/${fixture.searchId}`);
  await expect(page.getByTestId('version-history')).toBeVisible();

  // Two versions, both listed.
  await expect(page.getByTestId('version-row-1')).toBeVisible();
  await expect(page.getByTestId('version-row-2')).toBeVisible();

  /**
   * 🔴 THE WHOLE OF SRCH-03, IN TWO ASSERTIONS. The run was made against version 1 and an
   * edit then created version 2. The count on version 1 must still be 1 and the count on
   * version 2 must be 0 — if an edit could re-point a finished run, these two numbers
   * would be the other way round. Asserting both is what makes it a test rather than a
   * coincidence: a query that counted ALL of a preset's runs would put 1 on both rows.
   */
  await expect(page.getByTestId('version-row-1-used-by')).toHaveAttribute(
    'data-used-by-count',
    '1',
  );
  await expect(page.getByTestId('version-row-2-used-by')).toHaveAttribute(
    'data-used-by-count',
    '0',
  );

  // And the diff cell says something concrete. Not WHAT it says — that is the unit test's
  // job, where it can be asserted exactly — only that the screen is not rendering a blank.
  await expect(page.getByTestId('version-row-2-diff')).not.toBeEmpty();
  // The current version carries the badge, and only one row does.
  await expect(page.getByTestId('version-row-2').getByText('Current')).toBeVisible();
});

test('preset detail: duplicate creates a new preset at version 1', async ({ page }) => {
  await page.goto(`/presets/${fixture.searchId}`);

  await page.getByTestId('version-row-1-duplicate').click();
  await expect(page.getByTestId('duplicate-dialog')).toBeVisible();

  // The name arrives pre-filled — D-17's "Copy of {name}", computed server-side.
  const name = page.getByTestId('duplicate-name');
  await expect(name).not.toHaveValue('');

  await page.getByTestId('duplicate-confirm').click();

  // Navigated to the COPY, not back to the source.
  //
  // 🔴 THE PREDICATE MUST EXCLUDE THE SOURCE ID. `/presets/{uuid}` matches the page we are
  // already on, so a shape-only predicate resolves instantly and waits for nothing — the
  // first version of this line passed the wait and then failed the assertion after it,
  // which is the good outcome of a bad wait and would have been a silent pass if the
  // assertion had been any weaker.
  await page.waitForURL(
    (url) =>
      /\/presets\/[0-9a-f-]{36}$/.test(url.pathname) && !url.pathname.includes(fixture.searchId),
  );

  // A copy starts at version 1 and has exactly one version.
  await expect(page.getByTestId('version-row-1')).toBeVisible();
  await expect(page.getByTestId('version-row-2')).toHaveCount(0);
  // ...which is also the single-version empty state UI-SPEC specifies.
  await expect(page.getByTestId('version-history-single')).toBeVisible();
});

/**
 * The Run button with Places switched off (D-02): the server action refuses before any row or
 * hold exists, and the drawer says so in place.
 *
 * 🔴 04-26 (UI-SPEC Rules 38, 39). Since `queueRun` starts the places-sweep workflow, a
 * confirmed run is a Places sweep, so no e2e spec may create one. The Phase 2 version of this
 * test confirmed a run and watched `version-row-2-used-by` move to 1; that claim now lives in
 * the DB lane, with `start()` as a double:
 *   tests/db/queue-run.test.ts → 'a confirmed run creates a runs row on the current version'
 *
 * This file runs only against a LOCAL target (see `TARGET_IS_LOCAL`), where `PLACES_MODE`
 * defaults to `off`. The skip below makes that an asserted precondition instead of an
 * assumption: if this machine's .env.local switches Places on, clicking confirm would start a
 * real run, so the test refuses to click. 04-27 replaces this again with the `off`-state
 * assertions (the notice and the aria-disabled actions).
 */
test('preset detail: run is refused while places is off', async ({ page }) => {
  const localMode = process.env.PLACES_MODE ?? '';
  test.skip(
    localMode !== '' && localMode !== 'off',
    `PLACES_MODE is "${localMode}" in .env.local, so confirming would start a real run — ` +
      'this spec never starts one (UI-SPEC Rule 39)',
  );

  await page.goto(`/presets/${fixture.searchId}`);
  const url = page.url();

  await page.getByTestId('run-preset').click();
  await expect(page.getByTestId('run-drawer')).toBeVisible();
  await page.getByTestId('run-confirm').click();

  // Refused in place: the destructive Alert replaces the confirm, and nothing navigated.
  await expect(page.getByTestId('run-mode-refused')).toBeVisible();
  await expect(page.getByTestId('run-confirm')).toHaveCount(0);
  expect(page.url()).toBe(url);

  // Nothing was queued on either version.
  await page.reload();
  await expect(page.getByTestId('version-row-2-used-by')).toHaveAttribute(
    'data-used-by-count',
    '0',
  );
  await expect(page.getByTestId('version-row-1-used-by')).toHaveAttribute(
    'data-used-by-count',
    '1',
  );
});
