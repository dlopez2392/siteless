import { clerk, clerkSetup } from '@clerk/testing/playwright';
import { test as setup } from '@playwright/test';

const AUTH_FILE = 'tests/e2e/.auth/storage-state.json';

setup('authenticate', async ({ page }) => {
  await clerkSetup();
  const email = process.env.E2E_ADMIN_EMAIL;
  if (!email) throw new Error('auth.setup: E2E_ADMIN_EMAIL is not set');
  await page.goto('/');
  // The emailAddress overload, NOT { signInParams: { strategy: 'email_code' } }.
  // @clerk/testing's own JSDoc: the email_code strategy "requires a user with a TEST
  // email as an identifier (e.g. your_email+clerk_test@example.com)" and auto-fills the
  // fixed code; E2E_ADMIN_EMAIL is danlo's real address, so that path would wait on a
  // six-digit code from a real inbox and there is no unattended way to supply it. The
  // emailAddress overload looks the user up and mints a sign-in TICKET through the
  // Clerk Backend API — no password, no code, and no user created or modified.
  await clerk.signIn({ page, emailAddress: email });
  await page.context().storageState({ path: AUTH_FILE });
});

// Deliberately absent: any hand-rolled activation of the Clerk active organization
// through window.Clerk, and any org-selection click-through. That is the
// workaround-in-the-test that kept BIS's suite green while the product was broken — a
// user with a valid invitation was told they had no company. If a Siteless run lands on
// /no-access, the fix is ActivateSoleOrganization in the app (plan 08), never here.
