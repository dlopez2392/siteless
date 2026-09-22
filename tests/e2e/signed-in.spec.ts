import { expect, test } from '@playwright/test';

/**
 * Success criterion 1, end to end: a signed-in user sees which user and which org the
 * request is scoped to, and the tenant uuid proves the orgs row was provisioned
 * just-in-time through app.ensure_org (D-03).
 *
 * Asserts on data-testid, never on copy — Phase 2 restyles every one of these screens.
 */
test('signs in and is org-scoped', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('signed-in-as')).toContainText('user_');
  await expect(page.getByTestId('org-id')).toContainText('org_');
  await expect(page.getByTestId('org-row-id')).not.toBeEmpty();
});
