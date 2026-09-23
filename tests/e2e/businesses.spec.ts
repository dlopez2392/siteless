import { expect, test } from '@playwright/test';

/**
 * `/businesses` against the DEPLOYED app (E2E_BASE_URL) — chrome only (03-21, DEDUP-01).
 *
 * 🔴 NO FIXTURE AND NO DATABASE CONNECTION. The search field and both filters render
 * immediately by design, whatever the org's spine holds, and the no-match state is reached
 * by typing a string nothing can match. Production's `businesses` table is EMPTY this phase
 * (D-01: ingests are desk scripts and the spine is loaded locally), so the screen's
 * data-dependent half is proven by the DB suite, not here. There is deliberately no
 * `TARGET_IS_LOCAL` self-skip.
 *
 * 🔴 ASSERTS ON `data-testid` AND ON VALUES THE TEST ITSELF TYPED, NEVER ON COPY. Every
 * sentence lives in `src/lib/ui/copy.ts`. The one string matched is the query this test
 * typed — test data, not product copy.
 *
 * 🔴 THE COUNT LINE ONLY EXISTS WHEN THERE ARE ROWS. `businesses-count` is rendered for
 * `total > 0`; an org with no businesses gets `businesses-empty` in its place (page.tsx
 * `BusinessRows`). So the unfiltered screen is asserted to show EXACTLY ONE of the two —
 * which holds on today's empty production and on the day it is loaded, and fails if the
 * list region renders neither (a swallowed error) or both.
 */

const DESK = { width: 1280, height: 800 };

/** Cannot match any business name, address or phone: letters that never co-occur in a
 *  name, plus a run-unique number so it is not even a stable string. */
const NO_MATCH = `zzqxj-e2e-${Date.now()}`;

test.use({ viewport: DESK });

test('businesses: search and filters render, and a no-match search keeps its query', async ({
  page,
}) => {
  await page.goto('/businesses');
  expect(await page.evaluate(() => window.innerHeight)).toBeGreaterThan(0);

  // The field is on screen and takes focus.
  const search = page.locator('[data-testid="businesses-search"]:visible');
  await expect(search).toHaveCount(1);
  await expect(search).toBeVisible();
  await search.focus();
  await expect(search).toBeFocused();

  // Both filters render immediately.
  await expect(page.getByTestId('businesses-filter-cluster')).toBeVisible();
  await expect(page.getByTestId('businesses-filter-status')).toBeVisible();

  // The unfiltered list region settled into exactly one of: the count line (rows exist) or
  // the empty state (none do). Never neither, never both, never the failure alert.
  const settled = page.getByTestId('businesses-count').or(page.getByTestId('businesses-empty'));
  await expect(settled).toHaveCount(1);
  await expect(settled).toBeVisible();
  await expect(page.getByTestId('businesses-search-failed')).toHaveCount(0);

  // A search that cannot match: Enter commits it now rather than after the debounce.
  await search.fill(NO_MATCH);
  await search.press('Enter');
  await page.waitForURL((url) => url.searchParams.get('q') === NO_MATCH);

  await expect(page.getByTestId('businesses-no-match')).toBeVisible();
  await expect(page.getByTestId('businesses-count')).toHaveCount(0);
  await expect(page.getByTestId('businesses-search-failed')).toHaveCount(0);

  // "A search that blanks its own input is the worst thing this screen could do."
  await expect(search).toHaveValue(NO_MATCH);
});
