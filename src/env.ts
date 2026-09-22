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

const parsed = serverSchema.safeParse(process.env);

if (!parsed.success) {
  const missing = Object.keys(parsed.error.flatten().fieldErrors).join(', ');
  throw new Error(
    `src/env.ts: missing or invalid server environment variable(s): ${missing}. ` +
      `Set them in .env.local for local dev, or in the Vercel project for deploys. ` +
      `Never commit values.`,
  );
}

export const env = parsed.data;
