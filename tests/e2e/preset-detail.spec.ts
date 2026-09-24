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
 * not through SQL — still holds for everything this file actually tests: the duplicate goes
 * through the real server action via the real UI, and (since 04-27) no test here starts a run
 * at all. Only the starting rows are seeded. When 02-11 lands, the two-version fixture should be rebuilt through the
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
 * The three ways to run with Places switched off (D-02; 04-UI-SPEC § Screen 2, Rules 33, 38).
 *
 * 🔴 THIS SPEC CANNOT START A RUN (Rules 38, 39). It never opens a drawer and never clicks a
 * confirm: it asserts the `off` state the local target renders — the notice, and three
 * `aria-disabled`, focusable actions — and clicks nothing that could spend. "A confirmed run
 * creates a runs row on the current version" lives in the DB lane, with `start()` as a double:
 *   tests/db/queue-run.test.ts → 'a confirmed run creates a runs row on the current version'
 *
 * This file runs only against a LOCAL target (see `TARGET_IS_LOCAL`), where `PLACES_MODE`
 * defaults to `off`. Playwright and the local dev server read the same .env.local, so if it
 * switches Places on the page renders a different mode and these assertions do not apply — the
 * skip says so instead of failing on a correct screen.
 */
test('preset detail: with places off, all three run actions are disabled and explained', async ({
  page,
}) => {
  const localMode = process.env.PLACES_MODE ?? '';
  test.skip(
    localMode !== '' && localMode !== 'off',
    `PLACES_MODE is "${localMode}" in .env.local, so the page renders that mode, not off — ` +
      'this spec asserts the off state only and never starts a run (UI-SPEC Rule 39)',
  );

  await page.goto(`/presets/${fixture.searchId}`);

  const notice = page.getByTestId('places-mode-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('data-mode', 'off');
  const noticeId = await notice.getAttribute('id');
  expect(noticeId).not.toBeNull();

  for (const id of ['run-preset', 'run-partition', 'run-check-changes']) {
    // Exactly one visible element per action (Rule 40) — `:visible` so the phone's sticky
    // placement and the desk's title row can never both count.
    const action = page.locator(`[data-testid="${id}"]:visible`);
    await expect(action, id).toHaveCount(1);
    await expect(action, id).toHaveAttribute('data-enabled', 'false');
    await expect(action, id).toHaveAttribute('aria-disabled', 'true');
    await expect(action, id).not.toHaveAttribute('disabled');
    await expect(action, id).toHaveAttribute('aria-describedby', new RegExp(`\\b${noticeId}\\b`));
    // Focusable, so a keyboard user reaches the control and hears why it is inert.
    await action.focus();
    await expect(action, id).toBeFocused();
  }

  // C-CR-02: every version's "Run version N" — desk row or phone card, whichever is visible —
  // is inert too, described by the same notice. Before this, each one opened a live drawer
  // whose confirm answered "switched off after this page loaded" and looped on reload.
  const versionRuns = page.locator(
    '[data-testid^="version-row-"][data-testid$="-run"]:visible, ' +
      '[data-testid^="version-card-"][data-testid$="-run"]:visible',
  );
  const versionRunCount = await versionRuns.count();
  expect(versionRunCount, 'at least one visible version run button').toBeGreaterThan(0);
  for (let i = 0; i < versionRunCount; i += 1) {
    const button = versionRuns.nth(i);
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAttribute('data-enabled', 'false');
    await expect(button).not.toHaveAttribute('disabled');
    await expect(button).toHaveAttribute('aria-describedby', new RegExp(`\\b${noticeId}\\b`));
  }
  // Nothing opened a drawer, and this spec clicked nothing that could.
  await expect(page.getByTestId('run-drawer')).toHaveCount(0);

  // No accent anywhere among the run actions in off mode (Rule 34).
  await expect(page.locator('[data-testid^="run-"][data-variant="default"]')).toHaveCount(0);

  await expect(page.getByTestId('preset-other-runs')).toBeVisible();
  await expect(page.getByTestId('preset-recent-runs')).toBeVisible();
  // The fixture's one finished run is listed and links to its report.
  const row = page.locator('[data-testid^="preset-run-row-"]');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('href', /^\/runs\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('summary-last-run-link')).toHaveAttribute(
    'href',
    /^\/runs\/[0-9a-f-]{36}$/,
  );
});
