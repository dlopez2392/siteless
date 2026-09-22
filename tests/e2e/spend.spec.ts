import { expect, test } from '@playwright/test';

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

test('spend: the by-run tab reports its own state', async ({ page }) => {
  await page.goto(SPEND);
  await page.getByTestId('spend-tab-by-run').click();

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
 * The plan's second spec: queue a run from a preset and watch the row appear.
 *
 * 🔴 IT SELF-SKIPS UNTIL PLAN 02-12 SHIPS THE RUN DRAWER, and that is the same arrangement
 * `budget-banner.spec.ts` used while waiting for this plan's own cap control — a skip that
 * names the owning plan, with no flag anybody has to remember to unset. Nothing in Phase 2
 * can queue a run until `run-confirm` exists.
 *
 * 🔴 IF 02-12 NAMES ITS DRAWER TRIGGER SOMETHING THIS PROBE DOES NOT FIND, THE SKIP
 * PERSISTS SILENTLY. Plan 02-15 runs this suite against the deployed build and must
 * re-check that this test actually executes; a permanently skipped test is indistinguishable
 * from a passing one in a summary line.
 */
test('spend: the by-run tab lists a queued run', async ({ page }) => {
  await page.goto('/presets');
  const presetLink = page.locator('[data-testid^="preset-card-"] a, a[href^="/presets/"]').first();
  const hasPreset = (await presetLink.count()) > 0;
  test.skip(!hasPreset, 'no preset to run; the preset list ships in plan 02-11');

  await presetLink.click();
  const confirm = page.getByTestId('run-confirm');
  const runTrigger = page.getByTestId('preset-run-cta');
  if ((await confirm.count()) === 0 && (await runTrigger.count()) > 0) {
    await runTrigger.click();
  }
  test.skip(
    (await confirm.count()) === 0,
    'the run drawer ships in plan 02-12; nothing can queue a run yet',
  );

  const presetName = (await page.locator('h1').first().innerText()).trim();
  await confirm.click();

  await page.goto(SPEND);
  await page.getByTestId('spend-tab-by-run').click();
  await expect(
    page.locator('[data-testid="spend-run-row"]', { hasText: presetName }).first(),
  ).toBeVisible();
});
