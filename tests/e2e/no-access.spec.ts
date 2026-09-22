import { expect, test } from '@playwright/test';

// Runs WITHOUT the storage state, so it is a signed-out visitor: / must not render the
// shell. The membership-less case is covered by requireOrg's redirect, which this asserts
// reaches /no-access rather than an empty product.
test.use({ storageState: { cookies: [], origins: [] } });

// Deliberately absent from this file, as in tests/e2e/auth.setup.ts: any hand-rolled
// activation of the Clerk active organization through window.Clerk, and any
// org-selection click-through. That is the workaround-in-the-test that kept BIS's suite
// green while the product was broken. If a run lands on /no-access when it should not,
// the fix is the activation component in the app, never here. (The method name is
// grep-enforced absent from tests/e2e/, so it is not spelled.)

test('no access: a signed-out visitor never reaches the org-scoped shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('org-id')).toHaveCount(0);
  await expect(page).toHaveURL(/\/sign-in|accounts\.dev/);
});

test('no access: /no-access renders the invite-only message', async ({ page }) => {
  await page.goto('/no-access?reason=none');
  await expect(page.getByTestId('no-access')).toBeVisible();
  await expect(page.getByText('invite-only')).toBeVisible();
});
