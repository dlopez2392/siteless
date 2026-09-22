/**
 * The env vars WITHOUT WHICH THIS SUITE LIES, checked before a single test runs.
 *
 * What the mechanism cost BIS on 2026-09-19: one missing public key made every
 * in-account page 500, which read on screen as an empty table rather than as a
 * configuration error — and the conclusion drawn was "main is red and the e2e gate is
 * untrustworthy". The gate was fine; the machine running it was not.
 *
 * Reports NAMES only, never values: this error text reaches CI logs, which anyone with
 * repository access can read.
 */
const REQUIRED_ENV = [
  'E2E_BASE_URL',
  'E2E_ADMIN_EMAIL',
  'CLERK_SECRET_KEY',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
] as const;

export function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      'e2e: missing environment variable(s): ' +
        missing.join(', ') +
        '. Set them in .env.local (local) or repository secrets (CI). Values are never printed.',
    );
  }
}
