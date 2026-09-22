import { expect, test, type Page } from '@playwright/test';

/**
 * SRCH-01 end to end: a preset is definable as one or more clusters crossed with cities, a
 * county, or a geocoded radius, and it saves as a named version.
 *
 * 🔴 HOOKS ONLY, NEVER COPY. Every locator below is a `data-testid` or a data attribute.
 * The one string these tests match on is the preset NAME they typed themselves, which is
 * test data rather than product copy — UI-SPEC's sentences are free to change without
 * touching this file (Executor Rule 7).
 *
 * 🔴 THE DATABASE IS SHARED. These tests create real `searches` and `search_versions` rows
 * in the same `siteless_test` database and the same Clerk test org that every other spec
 * and every parallel plan uses. So:
 *   * every preset is named with a unique run prefix, and every assertion is scoped to
 *     that prefix;
 *   * nothing here asserts a LIST COUNT or that the list is empty. A sibling creating a
 *     preset mid-run would red such an assertion for a reason that has nothing to do with
 *     the behaviour under test.
 *
 * 🔴 `spend` AND `budget banner` ARE NOT WRITTEN HERE. They belong to plans 02-13 and
 * 02-10 respectively.
 */

const RUN = `e2e-${Date.now()}`;
const nameFor = (kind: string) => `${RUN}-${kind}`;

/** Empty list -> the Empty component's CTA; non-empty -> the header CTA. Both lead to
 *  `/presets/new`, and which one is on screen depends on rows this run does not own. */
function createCta(page: Page) {
  return page.getByTestId('presets-create-cta').or(page.getByTestId('presets-empty-cta'));
}

/**
 * Wait for the live estimate to SETTLE — a real figure on screen with `aria-busy="false"`.
 *
 * Both halves matter. `aria-busy` alone would pass during the 400 ms debounce window before
 * the first request is even issued; the dollar figure alone would pass while an older
 * preset's number was still on screen at 60 % opacity, which is exactly the state the panel
 * is designed to hold rather than blank.
 */
async function settleEstimate(page: Page) {
  const region = page.getByTestId('preset-editor-estimate');
  await expect(page.getByTestId('preset-editor-estimate-dollars')).toBeVisible({
    timeout: 20000,
  });
  await expect(region).toHaveAttribute('aria-busy', 'false', { timeout: 20000 });
}

async function startPreset(page: Page, name: string) {
  await page.goto('/presets');
  await createCta(page).first().click();
  await expect(page.getByTestId('preset-editor-form')).toBeVisible();

  await page.getByTestId('preset-editor-name').fill(name);
  await page.getByTestId('preset-editor-cluster-home_services').click();
  await page.getByTestId('preset-editor-cluster-food_hospitality').click();
}

async function saveAndExpectOnList(page: Page, name: string) {
  await page.getByTestId('preset-editor-save').click();
  await page.waitForURL('**/presets');
  await expect(
    page.locator(`[data-testid^="preset-card-"][data-preset-name="${name}"]`),
  ).toHaveCount(1);
}

test('create preset: cities', async ({ page }) => {
  const name = nameFor('cities');
  await startPreset(page, name);

  await page.getByTestId('preset-editor-mode-cities').click();
  const cities = page.getByTestId('preset-editor-city-option');
  await expect(cities.first()).toBeVisible();
  await cities.nth(0).click();
  await cities.nth(1).click();

  await settleEstimate(page);
  await saveAndExpectOnList(page, name);
});

test('create preset: county', async ({ page }) => {
  const name = nameFor('county');
  await startPreset(page, name);

  await page.getByTestId('preset-editor-mode-county').click();
  const counties = page.getByTestId('preset-editor-county-option');
  await expect(counties.first()).toBeVisible();
  await counties.first().click();

  await settleEstimate(page);
  await saveAndExpectOnList(page, name);
});

test('create preset: radius', async ({ page }) => {
  const name = nameFor('radius');
  await startPreset(page, name);

  await page.getByTestId('preset-editor-mode-radius').click();
  // A real RGV street address. The same one `tests/unit/msw/fixtures/census-mcallen.json`
  // was recorded against, so a failure here is the live federal service and not a bad
  // input — the recorded payload proves this address resolves.
  await page.getByTestId('preset-editor-address').fill('1400 N 10th St, McAllen, TX 78501');
  await page.getByTestId('preset-editor-geocode').click();
  // The geocoder is a free federal service and it does go down; 30s before calling it.
  await expect(page.getByTestId('preset-editor-geocode-result')).toBeVisible({
    timeout: 30000,
  });

  await settleEstimate(page);
  await saveAndExpectOnList(page, name);
});

test('preset editor: the Texas row carries a computed multiplier, not a literal', async ({
  page,
}) => {
  // D-04 + Executor Rule 16. The chip is asserted to be a NUMBER rather than a specific
  // one: the multiplier moves the moment the seeded city or cluster lists move, and a spec
  // pinning today's value would have to be edited every time the seed is refreshed — which
  // is how a computed value quietly becomes a constant again.
  await page.goto('/presets/new');
  await page.getByTestId('preset-editor-mode-county').click();

  const chip = page.getByTestId('preset-editor-texas-multiplier');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(/^×\d+\.\d+ vs RGV$/);
});
