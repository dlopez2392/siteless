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
 * 🔴 THIS TEST HAD NEVER ONCE EXECUTED (WR-09), AND IT READ AS A PASS. Both of its hooks
 * were wrong, and each one alone was enough to skip it silently:
 *
 *   * `'[data-testid^="preset-card-"] a, a[href^="/presets/"]'` — the card IS the anchor
 *     (`preset-card.tsx`), so the first alternative matched nothing, and the second matched
 *     `href="/presets/new"` on the header Create-preset CTA, which precedes the cards in DOM
 *     order. The click landed on the new-preset form.
 *   * `preset-run-cta` exists nowhere in `src/`. The trigger plan 02-12 shipped is
 *     `run-preset`. So the drawer never opened, `run-confirm` — which is mounted only while
 *     the drawer is open — was always count 0, and the `test.skip` below fired every time.
 *
 * The file's own header warned about exactly this ("if 02-12 names its trigger something
 * this probe does not find, the skip persists silently") and it came true anyway, because a
 * skipped test and a passing test are the same line in a summary: the phase gate's
 * "15 passed, 6 skipped" included this one.
 *
 * 🔴 THE "SHIPS IN PLAN 02-12" SKIP IS GONE, DELIBERATELY. 02-12 has shipped. A conditional
 * that can no longer be false is a conditional nobody will ever revisit. What remains is the
 * one legitimate precondition — there is no preset to run — which is a real state of the
 * database this suite points at and not a statement about unfinished work.
 *
 * 🔴 THIS TEST QUEUES A REAL RUN AND TAKES A REAL RESERVATION against whatever
 * `E2E_BASE_URL` is. That is the point — the meter is exercised from the UI months before
 * the first billed call — but it means one `runs` row and one `cost_reservations` hold per
 * execution, the hold released by the TTL sweep (migration 0018). It belongs with the
 * `e2e-*` row cleanup already logged in deferred-items.md, and is the reason a teardown path
 * is owed alongside it.
 */
test('spend: the by-run tab lists a queued run', async ({ page }) => {
  await page.goto('/presets');

  // The card is the link. `data-preset-name` carries the user's own data, so the assertion
  // at the end matches on that rather than on rendered copy every other part of the phase is
  // still restyling — and it is read HERE, before the navigation, because it lives on the
  // list item and not on the detail page.
  const card = page.locator('[data-testid^="preset-card-"]').first();
  test.skip((await card.count()) === 0, 'no preset to run');
  const presetName = (await card.getAttribute('data-preset-name'))?.trim() ?? '';
  expect(presetName, 'the card must carry the preset name as an attribute').not.toBe('');

  await card.click();

  // No `if (count > 0)` around this. A probe that tolerates a missing trigger is how the
  // previous version of this test passed for a fortnight without opening anything: if
  // `run-preset` is not there, this must FAIL and name it.
  await page.getByTestId('run-preset').click();
  const confirm = page.getByTestId('run-confirm');
  await expect(confirm).toBeVisible();

  await confirm.click();

  await page.goto(SPEND);
  await page.getByTestId('spend-tab-by-run').click();
  await expect(
    page.locator('[data-testid="spend-run-row"]', { hasText: presetName }).first(),
  ).toBeVisible();
});
