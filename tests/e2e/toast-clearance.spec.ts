import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * C-WR-07: on a phone, a toast must clear the fixed chrome at the bottom of the screen — the
 * `/review` thumb bar above all, because the success toast after a decision ("Merged — …",
 * two or three lines) fires exactly when the reviewer reaches for the next pair.
 *
 * sonner's default mobile placement is a full-width bottom stack 16px off the viewport edge:
 * inside the 64px tab bar, and under the thumb bar's lower row. Measured here on the real
 * screens, never inferred from sonner's defaults.
 *
 * 🔴 NOTHING HERE WRITES. `/review` has no toast that does not record a decision, and the
 * decision buttons are never pressed (the queue is real data). The toast comes from "Copy
 * lead key" on a detail page — read-only — and is carried to `/review` by a CLIENT-SIDE
 * navigation (the Toaster lives in the root layout and survives it) while the pointer rests on
 * the toast, which pauses sonner's dismiss timer.
 *
 * 🔴 DATA-DEPENDENT, SAID OUT LOUD. It needs one business (for the toast) and one pending pair
 * (for the thumb bar). Production's spine is empty this phase, so there it SKIPS with a named
 * reason; the measurement was taken against a local build of the loaded spine
 * (03-REVIEW-FIX-partC.md).
 */

const PHONE = { width: 390, height: 844 };

test.use({ viewport: PHONE });

async function rect(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('toast-clearance: element has no layout box');
  return { top: box.y, bottom: box.y + box.height };
}

async function paintingPhone(page: Page) {
  expect(page.viewportSize()).toEqual(PHONE);
  expect(await page.evaluate(() => window.innerHeight)).toBeGreaterThan(0);
}

test('a toast clears the tab bar and the review thumb bar on a phone', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  // A pending pair is what puts the thumb bar on screen.
  await page.goto('/review');
  await paintingPhone(page);
  const settled = page
    .getByTestId('review-thumb-bar')
    .or(page.getByTestId('review-queue-clear'))
    .or(page.getByTestId('review-empty'));
  await expect(settled.first()).toBeVisible();
  test.skip(
    !(await page.getByTestId('review-thumb-bar').isVisible()),
    'no pending review pair on this target, so there is no thumb bar to clear',
  );

  // Any business, for a read-only toast.
  await page.goto('/businesses');
  const firstCard = page.locator('[data-testid="businesses-cards"] a[href^="/businesses/"]').first();
  test.skip((await firstCard.count()) === 0, 'no business on this target to copy a lead key from');
  await firstCard.click();
  await expect(page.getByTestId('business-lead-key-copy')).toBeVisible();

  await page.getByTestId('business-lead-key-copy').click();
  const toast = page.locator('[data-sonner-toast]').first();
  await expect(toast).toBeVisible();
  // Rest the pointer on the toast: sonner pauses its dismiss timer while hovered.
  await toast.hover();

  const tabBar = page.getByTestId('mobile-tab-bar');
  const onDetail = await rect(toast);
  const tabBarBox = await rect(tabBar);
  expect(onDetail.bottom, 'toast bottom vs tab bar top (detail page)').toBeLessThanOrEqual(
    tabBarBox.top,
  );

  // Client-side navigation by keyboard, so the pointer stays where it is.
  // The tab bar's own Review tab (the sidebar carries the same testid, hidden on a phone).
  await tabBar.getByTestId('nav-review').focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/review$/);
  const bar = page.getByTestId('review-thumb-bar');
  await expect(bar).toBeVisible();
  await expect(toast).toBeVisible();
  await paintingPhone(page);

  // Let the bar's measured height land (ResizeObserver → CSS var) before reading.
  await expect
    .poll(async () => (await rect(toast)).bottom <= (await rect(bar)).top + 0.5, {
      message: 'toast bottom must sit at or above the thumb bar top',
      timeout: 2000,
    })
    .toBe(true);

  const t = await rect(toast);
  const b = await rect(bar);
  test.info().annotations.push({
    type: 'measurement',
    description: `390x844: toast ${t.top.toFixed(1)}–${t.bottom.toFixed(1)}px, thumb bar top ${b.top.toFixed(1)}px, tab bar top ${tabBarBox.top.toFixed(1)}px`,
  });
});
