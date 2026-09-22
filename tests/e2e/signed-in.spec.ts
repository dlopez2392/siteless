import { expect, test } from '@playwright/test';

/**
 * Success criterion 1, end to end: a signed-in user sees which user and which org the
 * request is scoped to, and the tenant uuid proves the orgs row was provisioned
 * just-in-time through app.ensure_org (D-03).
 *
 * Asserts on data-testid, never on copy — Phase 2 restyles every one of these screens.
 *
 * The three hooks moved from `/` to `/settings/organization` in plan 02-10, when `/`
 * became a redirect to the preset list. This spec moved in the SAME commit as the page
 * that carries them: a retired testid fails silently, so a spec left pointing at the old
 * route would have gone on passing against a page that no longer renders any of them
 * (UI-SPEC Executor Rule 7).
 */
test('signs in and is org-scoped', async ({ page }) => {
  await page.goto('/settings/organization');
  await expect(page.getByTestId('signed-in-as')).toContainText('user_');
  await expect(page.getByTestId('org-id')).toContainText('org_');
  await expect(page.getByTestId('org-row-id')).not.toBeEmpty();
});
