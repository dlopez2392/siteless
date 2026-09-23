import 'server-only';
import { z } from 'zod';

/**
 * Parsed once, at module load, on the server only.
 *
 * Why it throws instead of defaulting: in BIS a missing Supabase anon key made every
 * in-account page return 500, which read on screen as an empty table, and the
 * conclusion drawn was "main is red and the e2e gate is untrustworthy". A boot-time
 * throw naming the variable costs one deploy; a silent undefined costs a day.
 *
 * NEXT_PUBLIC_* names are deliberately absent below — Next inlines them into the
 * client bundle at build time, so client modules read them directly and nothing
 * server-side needs to re-validate them. Only names that must never cross the client
 * boundary live in this file, and `import 'server-only'` is what makes importing it
 * from a "use client" module a build error rather than a leak.
 */
const serverSchema = z.object({
  CLERK_SECRET_KEY: z.string().min(1),
  SUPABASE_DB_POOL_URL: z.string().url(),
  /**
   * OPTIONAL, server-only. A Socrata app token buys the app its own request pool on the
   * Comptroller's open-data host; unauthenticated requests are throttled per IP but were never throttled
   * in measurement, so the project runs without one. `src/lib/socrata/client.ts` reads it
   * directly (it is imported by tsx scripts that cannot load this module) and sends it as
   * `X-App-Token` only when present.
   */
  SOCRATA_APP_TOKEN: z.string().min(1).optional(),
  /**
   * D-02. The Places kill switch. `off` refuses before any reservation; `ids_only` permits only
   * the free Essentials mask (change detection); `enterprise` permits the full mask. Changing it
   * is a Vercel env edit plus a redeploy — deliberately; there is no in-app toggle. An unknown
   * value fails this parse, loudly. Read on the server only and passed to components as a prop
   * (UI-SPEC Rule 33).
   */
  PLACES_MODE: z.enum(['off', 'ids_only', 'enterprise']).default('off'),
  /** Vercel Cron's bearer secret for /api/cron/purge-places. Optional here because the route
   *  refuses when it is unset — "open when unset" is the failure mode this avoids. */
  CRON_SECRET: z.string().min(16).optional(),
  /*
   * Deliberately ABSENT: the places provider's API key (D-03). Like SOCRATA_APP_TOKEN above,
   * it is read directly by the one module that sends it — src/lib/places/client.ts — and by
   * nothing else, so there is exactly one sanctioned reader to audit. Declaring it here would
   * make every importer of `env` a potential reader. Its name is not spelled in this file on
   * purpose: tests/unit/no-google-credential.test.ts scans this source and refuses it.
   */
});

/**
 * One concept, two names. SUPABASE_DB_POOL_URL is what Vercel and .env.local carry;
 * RUNTIME_DB_URL is the vendor-neutral alias GitHub Actions uses, because T-1-19 asserts
 * `.github/workflows/ci.yml` is greppable-clean of the production project's vendor name —
 * CI must never be able to reach that project, and a workflow that cannot even spell it
 * is a stronger guarantee than one that promises not to.
 *
 * Both name the NON-OWNER runtime pool (app_user), never the migration owner. The alias is
 * inert wherever the primary is set, which is everywhere the application actually runs, so
 * this changes no deployed behaviour. tests/unit/env-alias.test.ts is the guard.
 *
 * `||`, not `??`: GitHub Actions substitutes an ABSENT secret or variable as the empty
 * string rather than leaving it unset, so a nullish check would accept '' as "present" and
 * hand zod a value that fails with a message about the wrong variable.
 */
const parsed = serverSchema.safeParse({
  ...process.env,
  SUPABASE_DB_POOL_URL: process.env.SUPABASE_DB_POOL_URL || process.env.RUNTIME_DB_URL,
  // Same `||` reasoning: an absent GitHub Actions secret arrives as '', which `.optional()`
  // would treat as present and `.min(1)` would then refuse at boot.
  SOCRATA_APP_TOKEN: process.env.SOCRATA_APP_TOKEN || undefined,
  // Same again: '' must mean "unset" → `off`, not an enum refusal about an empty string.
  PLACES_MODE: process.env.PLACES_MODE || undefined,
  CRON_SECRET: process.env.CRON_SECRET || undefined,
});

if (!parsed.success) {
  const missing = Object.keys(parsed.error.flatten().fieldErrors).join(', ');
  throw new Error(
    `src/env.ts: missing or invalid server environment variable(s): ${missing}. ` +
      `Set them in .env.local for local dev, or in the Vercel project for deploys. ` +
      `Never commit values.`,
  );
}

export const env = parsed.data;
