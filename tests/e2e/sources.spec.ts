import { expect, test } from '@playwright/test';

/**
 * `/sources` against the DEPLOYED app (E2E_BASE_URL) — chrome only (03-21, DATA-01..03).
 *
 * 🔴 NO FIXTURE AND NO DATABASE CONNECTION. Everything asserted here renders with no ingest
 * run at all: UI-SPEC Executor Rule 27 makes the four source rows STATIC STRUCTURE (the
 * ledger is driven by `LEDGER_SOURCES` and the query's rows are looked up by key), so a
 * production database the ingests have never touched (D-01 — the spine is loaded locally
 * this phase) still shows four rows. That is exactly why this screen was chosen for e2e and
 * `/review` and `/businesses/[id]` were not. There is deliberately no `TARGET_IS_LOCAL`
 * self-skip: a spec that always skips proves nothing, and this one does not need one.
 *
 * 🔴 ASSERTS ON `data-testid` AND ON NUMBERS, NEVER ON COPY. Every sentence lives in
 * `src/lib/ui/copy.ts`. The counts are read from `data-count`, and only as "a
 * non-negative integer" — pinning 0 would red the day a production ingest first runs.
 *
 * 🔴 DESK AND PHONE CARRY DIFFERENT TESTIDS, because both trees are in the DOM and CSS
 * hides one (source-ledger.tsx header). Desk: `sources-table` / `sources-row-{key}`.
 * Phone: `sources-cards` / `sources-card-{key}`. The phone rows are matched by EXACT key,
 * never by the `sources-card-` prefix, which also matches `sources-card-count-{key}-{kind}`.
 */

/** The four sources, in ledger order (`LEDGER_SOURCES` in source-ledger.tsx). */
const SOURCE_KEYS = ['tx_comptroller', 'tx_comptroller_closures', 'overture', 'census_geocoder'];
const COUNT_KINDS = ['added', 'changed', 'unchanged', 'gone'];

const PHONE = { width: 390, height: 844 };
/** Above the 1024px `lg` breakpoint, where the desk sidebar is the only visible nav. */
const DESK = { width: 1280, height: 800 };

test.describe('sources: desk', () => {
  test.use({ viewport: DESK });

  test('sources: four static rows, the attribution block and the six-row sidebar', async ({
    page,
  }) => {
    await page.goto('/sources');
    expect(await page.evaluate(() => window.innerHeight)).toBeGreaterThan(0);

    // The ledger loaded rather than failing — a load failure replaces the table entirely.
    await expect(page.getByTestId('sources-table')).toBeVisible();
    await expect(page.getByTestId('sources-load-failed')).toHaveCount(0);

    // Exactly four rows, one per source key, whether or not any run has happened.
    await expect(page.locator('[data-testid^="sources-row-"]')).toHaveCount(SOURCE_KEYS.length);
    for (const key of SOURCE_KEYS) {
      await expect(page.getByTestId(`sources-row-${key}`)).toBeVisible();
      for (const kind of COUNT_KINDS) {
        await expect(page.getByTestId(`sources-count-${key}-${kind}`)).toHaveAttribute(
          'data-count',
          /^\d+$/,
        );
      }
    }

    await expect(page.getByTestId('sources-attribution')).toBeVisible();

    // The six-destination nav: on a desk `nav-sources` is a sidebar row, visible with no
    // sheet interaction, and the phone tab bar (and so the More sheet) is not showing.
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await expect(page.getByTestId('mobile-tab-bar')).toBeHidden();
    await expect(page.locator('[data-testid="nav-sources"]:visible')).toHaveCount(1);
    // Sidebar rows mark the current route with `aria-current="page"` (SidebarNavRow).
    await expect(page.locator('[data-testid="nav-sources"]:visible')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

test.describe('sources: phone', () => {
  test.use({ viewport: PHONE });

  test('sources: at 390x844 the screen is reached only through the More sheet', async ({
    page,
  }) => {
    await page.goto('/businesses');
    expect(page.viewportSize()).toEqual(PHONE);
    expect(await page.evaluate(() => window.innerHeight)).toBeGreaterThan(0);

    await expect(page.getByTestId('mobile-tab-bar')).toBeVisible();
    await expect(page.getByTestId('app-sidebar')).toBeHidden();

    // Sources is an Operations destination: no tab of its own, and no visible hook at all
    // until the More sheet is open (Radix mounts sheet content only while open).
    await expect(page.locator('[data-testid="nav-sources"]:visible')).toHaveCount(0);

    await page.locator('[data-testid="nav-more"]:visible').click();
    await expect(page.getByTestId('more-sheet')).toBeVisible();
    const navSources = page.locator('[data-testid="nav-sources"]:visible');
    await expect(navSources).toHaveCount(1);
    await navSources.click();

    await page.waitForURL('**/sources');
    // The sheet closes on navigation so it cannot cover the screen it opened.
    await expect(page.getByTestId('more-sheet')).toHaveCount(0);

    // The phone tree, not the desk table.
    await expect(page.getByTestId('sources-cards')).toBeVisible();
    await expect(page.getByTestId('sources-table')).toBeHidden();
    for (const key of SOURCE_KEYS) {
      await expect(page.getByTestId(`sources-card-${key}`)).toBeVisible();
    }
    await expect(page.getByTestId('sources-attribution')).toBeVisible();

    // Operations has no tab of its own on a phone, so More carries the lit state.
    await expect(page.locator('[data-testid="nav-more"]:visible')).toHaveAttribute(
      'data-active',
      'true',
    );
  });
});
