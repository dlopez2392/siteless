import { expect, test, type Page } from '@playwright/test';

/**
 * MOB-01 and UI-SPEC Executor Rule 9: every primary control is at least 44x44 CSS px in
 * the thumb zone.
 *
 * 🔴 THE VIEWPORT IS ASSERTED BEFORE ANYTHING IS MEASURED. At the project's default
 * Desktop Chrome size the desk sidebar is the visible nav and its rows are wider than a
 * phone's whole screen, so every assertion below would pass without testing the thing it
 * names. A run that is not actually 390px wide is a run that proves nothing.
 *
 * 🔴 AND THE WINDOW HAS TO BE REAL. A hidden or zero-height Chrome window reports
 * zero-sized boxes for everything (recorded BIS defect), which would fail loudly here —
 * but the explicit check says why.
 *
 * 🔴 EXACTLY ONE VISIBLE MATCH PER HOOK. The shell renders the desk nav and the phone tab
 * bar together and lets CSS decide, so `nav-presets` exists twice in the DOM and is
 * `display: none` once. `toHaveCount(1)` on the `:visible` locator turns that into a
 * checked invariant: if a breakpoint change ever leaves both showing, this fails instead
 * of quietly measuring whichever one came first.
 */

const PHONE = { width: 390, height: 844 };

test.use({ viewport: PHONE });

/** UI-SPEC § Accessibility → Touch targets. Width AND height, not the larger of the two. */
const MIN_TARGET = 44;

async function expectTargetAtLeast44(page: Page, testId: string) {
  const control = page.locator(`[data-testid="${testId}"]:visible`);
  await expect(control, `${testId} should have exactly one visible match`).toHaveCount(1);
  await expect(control).toBeVisible();

  /**
   * The smallest side, so one assertion covers width AND height.
   *
   * 🔴 POLLED RATHER THAN SAMPLED ONCE. Radix opens a dropdown with a 100ms
   * `zoom-in-95`, and a bounding box read mid-transform reports the SCALED box — this
   * first ran red at 43.07px for a control that is exactly 44, which is a measurement
   * artifact and not a spacing defect. Polling settles on the painted value without a
   * fixed wait, and it cannot hide a real violation: an undersized control never grows
   * past its own size, so the poll times out and fails with the number it saw.
   */
  await expect
    .poll(
      async () => {
        const box = await control.boundingBox();
        return box ? Math.min(box.width, box.height) : 0;
      },
      { message: `${testId}: smallest side in CSS px` },
    )
    .toBeGreaterThanOrEqual(MIN_TARGET);
}

test('touch targets: every primary control clears 44px at 390x844', async ({ page }) => {
  await page.goto('/settings/organization');

  // The viewport really is a phone, and the window really is painting.
  expect(page.viewportSize()).toEqual(PHONE);
  expect(await page.evaluate(() => window.innerWidth)).toBe(PHONE.width);
  expect(await page.evaluate(() => window.innerHeight)).toBeGreaterThan(0);

  // The bottom tab bar is the phone's navigation; the desk sidebar must not be showing.
  await expect(page.getByTestId('mobile-tab-bar')).toBeVisible();
  await expect(page.getByTestId('app-sidebar')).toBeHidden();

  for (const testId of ['nav-presets', 'nav-spend', 'nav-settings', 'user-menu']) {
    await expectTargetAtLeast44(page, testId);
  }

  // The theme switch lives inside the user menu, so it has to be open to be measured.
  await page.locator('[data-testid="user-menu"]:visible').click();
  await expectTargetAtLeast44(page, 'theme-switch');
  for (const testId of ['theme-light', 'theme-dark', 'theme-system']) {
    await expectTargetAtLeast44(page, testId);
  }
});
