import { expect, test, type Page } from '@playwright/test';
import { SHEET_CLOSE_LABEL } from '../../src/lib/ui/copy';

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
 *
 * 🔴 SOME HOOKS ONLY EXIST ONCE A SURFACE IS OPEN (03-UI-SPEC Executor Rule 21). On a phone
 * the Operations destinations — `nav-sources`, `nav-spend`, `nav-settings` — live inside
 * the More sheet, and Radix mounts sheet content only while it is open, so their visible
 * count is 0 until `nav-more` is tapped. The invariant above is NOT relaxed for them: the
 * spec opens the sheet first and then demands exactly one visible match, the same way it
 * has always opened the user menu before measuring `theme-switch`. Changing the
 * PRECONDITION is honest; loosening `toHaveCount(1)` would not be.
 */

const PHONE = { width: 390, height: 844 };
/** Above the 1024px `lg` breakpoint, where the desk sidebar is the only visible nav. */
const DESK = { width: 1280, height: 800 };
/** Between `sm` (640) and `lg` (1024): the top bar's off-canvas nav is the navigation. */
const TABLET = { width: 800, height: 1024 };

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

  // The four always-visible phone tabs — the three Leads destinations and More — plus the
  // avatar. `nav-spend` and `nav-settings` are NOT here: they moved into the More sheet.
  for (const testId of ['nav-presets', 'nav-review', 'nav-businesses', 'nav-more', 'user-menu']) {
    await expectTargetAtLeast44(page, testId);
  }

  // /settings/organization is an Operations route, and Operations has no tab of its own on
  // a phone — so the More tab itself must carry the lit state, or no tab is lit at all.
  await expect(page.locator('[data-testid="nav-more"]:visible')).toHaveAttribute(
    'data-active',
    'true',
  );

  // The theme switch lives inside the user menu, so it has to be open to be measured.
  await page.locator('[data-testid="user-menu"]:visible').click();
  await expectTargetAtLeast44(page, 'theme-switch');
  for (const testId of ['theme-light', 'theme-dark', 'theme-system']) {
    await expectTargetAtLeast44(page, testId);
  }

  // Close the menu so its overlay cannot swallow the next tap.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="theme-switch"]:visible')).toHaveCount(0);

  // The Operations rows live inside the More sheet, so it has to be open to be measured —
  // the same open-then-measure precondition as the user menu above.
  await page.locator('[data-testid="nav-more"]:visible').click();
  await expect(page.getByTestId('more-sheet')).toBeVisible();
  for (const testId of ['nav-sources', 'nav-spend', 'nav-settings']) {
    await expectTargetAtLeast44(page, testId);
  }

  // The shared Sheet's close button (03-22: it was a 28x28 icon-only ghost). One sheet is
  // open, so exactly one close button is visible; it carries a real accessible name.
  await expectTargetAtLeast44(page, 'sheet-close');
  await expect(page.locator('[data-testid="sheet-close"]:visible')).toHaveAccessibleName(
    SHEET_CLOSE_LABEL,
  );
});

test.describe('tablet', () => {
  test.use({ viewport: TABLET });

  test('touch targets: the off-canvas nav sheet closes from a 44px button at 800x1024', async ({
    page,
  }) => {
    await page.goto('/settings/organization');

    expect(page.viewportSize()).toEqual(TABLET);
    expect(await page.evaluate(() => window.innerHeight)).toBeGreaterThan(0);

    // The same shared SheetContent as the phone More sheet, opened from the tablet top bar.
    await expectTargetAtLeast44(page, 'nav-menu');
    await page.locator('[data-testid="nav-menu"]:visible').click();
    await expectTargetAtLeast44(page, 'sheet-close');
    await expect(page.locator('[data-testid="sheet-close"]:visible')).toHaveAccessibleName(
      SHEET_CLOSE_LABEL,
    );
  });
});

test.describe('desk', () => {
  test.use({ viewport: DESK });

  test('touch targets: all six sidebar rows clear 44px at 1280x800', async ({ page }) => {
    await page.goto('/settings/organization');

    expect(page.viewportSize()).toEqual(DESK);
    expect(await page.evaluate(() => window.innerHeight)).toBeGreaterThan(0);

    // The sidebar is the desk's navigation; the tab bar (and so the More sheet) is not.
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await expect(page.getByTestId('mobile-tab-bar')).toBeHidden();

    // All six rows, with no sheet interaction — the desk shows both groups at once.
    for (const testId of [
      'nav-presets',
      'nav-review',
      'nav-businesses',
      'nav-sources',
      'nav-spend',
      'nav-settings',
    ]) {
      await expectTargetAtLeast44(page, testId);
    }
  });
});
