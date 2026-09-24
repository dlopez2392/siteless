import { expect, test, type Page } from '@playwright/test';

/**
 * BUDG-04 / D-14, end to end: the spend view reads the meter and the ledger, and it never
 * hides a provider.
 *
 * 🔴 ASSERTS ON `data-testid` AND ON SHAPE, NEVER ON COPY. Every sentence on this screen
 * lives in `src/lib/ui/copy.ts` or in UI-SPEC's copy table, and Phase 2 is still restyling
 * the screens these appear on; a copy assertion here would break on a wording change while
 * proving nothing about whether the figure rendered.
 *
 * 🔴 AND NEVER ON A FIXED DOLLAR VALUE. Three plans run against this one local database
 * and the cap moves while they do, so an assertion on `$50.00` would be a flake dressed up
 * as a test. What is asserted is that the figure is money-shaped and present — the numbers
 * themselves are pinned by the unit tests over `formatUsd` and by the db tests over the
 * meter, where they are not shared state.
 */

const SPEND = '/spend';

test('spend: month-to-date, the gauge and all three providers render', async ({ page }) => {
  await page.goto(SPEND);

  // The shell has to be there, or every "is visible" below would also be true of a 404.
  await expect(page.getByTestId('app-shell')).toBeVisible();

  const figure = page.getByTestId('spend-mtd-figure');
  await expect(figure).toBeVisible();
  // Money-shaped and two decimals: `$47.60`, never `$47.6` and never `$48`.
  await expect(figure).toHaveText(/^\$[\d,]+\.\d{2}$/);

  await expect(page.getByTestId('spend-gauge')).toBeVisible();
  // Colour is never the only signal — the numeric label ships with the bar, always.
  await expect(page.getByTestId('spend-gauge-label')).toHaveText(/^\d+\.\d%$/);

  await expect(page.getByTestId('spend-tab-by-provider')).toBeVisible();
  await expect(page.getByTestId('spend-tab-by-run')).toBeVisible();

  /**
   * 🔴 THE POINT OF THIS TEST. `readSpendByProvider` builds its provider list from a
   * `values` clause so a provider with no spend still returns a row, and the screen
   * renders every row it is handed. In Phase 2 nothing has been called yet, so all three
   * are zero — which is exactly the state in which a filtered-out row would be invisible
   * to every other gate. An absent provider reads as "we are not spending there" when it
   * would actually mean "we are not measuring there".
   */
  const providerRows = page.locator('[data-testid="spend-by-provider"] [data-slot="item"]');
  await expect(providerRows).toHaveCount(3);
  for (const provider of ['places', 'firecrawl', 'anthropic']) {
    const row = page.getByTestId(`spend-provider-${provider}`);
    await expect(row, `${provider} must have a row even at zero spend`).toBeVisible();
    await expect(page.getByTestId(`spend-provider-${provider}-amount`)).toHaveText(
      /^\$[\d,]+\.\d{2}$/,
    );
  }
});

/**
 * 🔴 C-WR-11: THE BY-RUN TAB RENDERS ON CLICK. Radix Tabs mounts the inactive panel's content
 * on activation, so a `.count()` taken straight after the click can run before the panel paints
 * — the first test below then saw 0 rows and 0 empty states (a flake), and the second skipped
 * green on a deployment that HAS runs. Wait for exactly one of the three containers first, the
 * same anchor `budget-banner.spec.ts` waits on. Returns whether the tab says "no runs".
 */
async function openByRun(page: Page): Promise<{ empty: boolean }> {
  await page.getByTestId('spend-tab-by-run').click();
  const anchor = page.locator(
    [
      '[data-testid="spend-by-run-empty"]:visible',
      '[data-testid="spend-by-run-table"]:visible',
      '[data-testid="spend-by-run-cards"]:visible',
    ].join(', '),
  );
  await expect(anchor).toHaveCount(1);
  return { empty: (await anchor.getAttribute('data-testid')) === 'spend-by-run-empty' };
}

test('spend: the by-run tab reports its own state', async ({ page }) => {
  await page.goto(SPEND);
  await openByRun(page);

  const empty = page.getByTestId('spend-by-run-empty');
  const rows = page.locator('[data-testid="spend-run-row"]');

  // Exactly one of the two, never both and never neither: a tab that renders nothing at
  // all is the failure this asserts against, and it is what a bad join would produce.
  const emptyCount = await empty.count();
  const rowCount = await rows.count();
  expect(
    emptyCount === 1 ? rowCount === 0 : rowCount > 0,
    `by-run rendered ${rowCount} rows and ${emptyCount} empty states`,
  ).toBe(true);

  if (rowCount > 0) {
    // Every row carries the preset's PUBLIC display name and its version, never an
    // internal label (CONVENTIONS § Naming).
    await expect(rows.first().locator('td').first()).toHaveText(/\S.*·\s*version\s+\d+/);
  }
});

/**
 * Every listed run links to its own report.
 *
 * 🔴 THIS SPEC MUST NEVER CLICK A RUN CONFIRM AGAINST A DEPLOYED APP: ONCE PLACES_MODE IS
 * ENTERPRISE THAT IS A BILLED PLACES SWEEP FROM CI (04-UI-SPEC Rule 39, T-4-09). Its Phase 2
 * predecessor opened the most recently updated preset, opened its run drawer and confirmed;
 * since 04-26 that confirmation starts the places-sweep workflow, so on every e2e
 * run it would have spent real money — or, under D-18, been refused at admission on an
 * RGV-sized preset and gone red. This spec only READS: it creates no run, so when there is
 * none to read it skips and says why.
 *
 * The proof that a confirmed run lands as a `runs` row on the current version moved to the
 * DB lane, where `start()` is a double and no request can leave:
 *   tests/db/queue-run.test.ts → 'a confirmed run creates a runs row on the current version'
 *
 * Each run renders TWO links with its testid (the desk table and the phone cards, one hidden
 * by CSS), so every element is checked, not the first.
 */
test('spend: every listed run links to its report', async ({ page }) => {
  await page.goto(SPEND);
  // C-WR-11: the skip is decided by the PAINTED tab, never by a count taken before it paints.
  const { empty } = await openByRun(page);
  test.skip(
    empty,
    'no runs exist on this deployment yet — this spec never creates one (UI-SPEC Rule 39)',
  );

  const links = page.locator('[data-testid^="spend-run-link-"]');
  const count = await links.count();
  // The tab painted runs, so there are links to check — zero here is a failure, not a skip.
  expect(count, 'the by-run tab showed runs but no run links').toBeGreaterThan(0);
  await expect(page.locator('[data-testid^="spend-run-link-"]:visible').first()).toBeVisible();

  for (let i = 0; i < count; i += 1) {
    const link = links.nth(i);
    const testId = (await link.getAttribute('data-testid')) ?? '';
    const runId = testId.slice('spend-run-link-'.length);
    expect(runId, `${testId} must name a run id`).toMatch(/^[0-9a-f-]{36}$/);
    await expect(link).toHaveAttribute('href', `/runs/${runId}`);
  }
});
