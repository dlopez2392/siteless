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
