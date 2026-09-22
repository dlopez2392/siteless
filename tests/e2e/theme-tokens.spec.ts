import { expect, test, type Page } from '@playwright/test';

/**
 * UI-SPEC Executor Rules 2 and 8: prove the painted palette actually shipped.
 *
 * 🔴 THE COMPUTED VALUE IS PINNED, NEVER A VARIABLE NAME AND NEVER A SUBSTRING. Asserting
 * that a class list mentions `text-primary`, or that a colour string contains "15",
 * passes just as happily when the token resolved to nothing. `getComputedStyle` returns
 * what the browser actually painted, and it is compared with `toBe`.
 *
 * 🔴 THESE RUN AGAINST THE BUILT APP. Next's own docs warn that CSS ordering can differ
 * between `next dev` and `next build`, which is the whole reason Rule 8 exists — a
 * styleguide page in dev mode proves nothing about the artifact that ships.
 *
 * 🔴 A HIDDEN OR ZERO-HEIGHT CHROME WINDOW MAKES EVERY MEASUREMENT LIE (recorded BIS
 * defect). Each test asserts the window is real and the probed element is visible before
 * it reads a single value.
 */

/** UI-SPEC § Color, light. */
const LIGHT_ACCENT = 'rgb(15, 118, 110)';
const LIGHT_BACKGROUND = 'rgb(244, 246, 247)';
/** UI-SPEC § Color, dark. */
const DARK_ACCENT = 'rgb(45, 212, 191)';
const DARK_BACKGROUND = 'rgb(14, 20, 22)';

/**
 * Drive the real control in the real user menu, rather than writing the class onto
 * <html> from the test. next-themes owns that class; a test that set it directly would
 * still pass on a build where the switch was wired to nothing.
 */
async function chooseTheme(page: Page, theme: 'light' | 'dark') {
  const trigger = page.locator('[data-testid="user-menu"]:visible');
  await expect(trigger).toHaveCount(1);
  await trigger.click();

  const option = page.locator(`[data-testid="theme-${theme}"]:visible`);
  await expect(option).toHaveCount(1);
  await option.click();

  // Close the menu so nothing overlays the elements about to be measured.
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
}

/** Refuses to measure anything in a window that cannot be showing a real page. */
async function assertWindowIsReal(page: Page) {
  const height = await page.evaluate(() => window.innerHeight);
  const width = await page.evaluate(() => window.innerWidth);
  expect(height).toBeGreaterThan(0);
  expect(width).toBeGreaterThan(0);
}

/**
 * The accent is probed on the ACTIVE nav item, which is the real screen's real carrier of
 * `--primary` (§ Color's accent list, item 2) — not on a swatch added for the test.
 * `/settings/organization` lights the Settings row, and the desk viewport keeps exactly
 * one of the two nav trees visible.
 */
function activeNavItem(page: Page) {
  return page.locator('[data-testid="nav-settings"]:visible');
}

test('theme tokens: the accent resolves in light', async ({ page }) => {
  await page.goto('/settings/organization');
  await assertWindowIsReal(page);
  await chooseTheme(page, 'light');

  const probe = activeNavItem(page);
  await expect(probe).toHaveCount(1);
  await expect(probe).toBeVisible();

  const color = await probe.evaluate((node) => getComputedStyle(node).color);
  expect(color).toBe(LIGHT_ACCENT);
});

test('theme tokens: the accent resolves in dark', async ({ page }) => {
  await page.goto('/settings/organization');
  await assertWindowIsReal(page);
  await chooseTheme(page, 'dark');

  const probe = activeNavItem(page);
  await expect(probe).toHaveCount(1);
  await expect(probe).toBeVisible();

  const color = await probe.evaluate((node) => getComputedStyle(node).color);
  expect(color).toBe(DARK_ACCENT);
});

test('theme tokens: the page background matches the painted token', async ({ page }) => {
  await page.goto('/settings/organization');
  await assertWindowIsReal(page);

  // globals.css paints the page background on <body>; the shell root carries the same
  // token, and both are asserted so a change to either one cannot pass unnoticed.
  const shell = page.getByTestId('app-shell');
  await expect(shell).toBeVisible();

  await chooseTheme(page, 'light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    LIGHT_BACKGROUND,
  );
  expect(await shell.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
    LIGHT_BACKGROUND,
  );

  await chooseTheme(page, 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    DARK_BACKGROUND,
  );
  expect(await shell.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
    DARK_BACKGROUND,
  );
});
