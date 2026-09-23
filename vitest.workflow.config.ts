// Line 1, in the MAIN process, before any worker spawns — same reasoning as
// vitest.config.ts and vitest.db.config.ts. Pinned to UTC, deliberately not
// America/Chicago: this dev machine IS Chicago, so a Chicago-pinned lane cannot
// discriminate a forgotten explicit zone.
process.env.TZ = 'UTC';
process.env.LANG = 'en_US.UTF-8';

import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';
import { workflow } from '@workflow/vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The third lane (04-01, D-14): a real compiled workflow, run in-process against the
// local test database and msw-served Places payloads (04-RESEARCH § Validation
// Architecture, layering 3).
//
// TEST_DATABASE_URL / RUNTIME_DB_URL live in the gitignored local env file, exactly as
// for the db lane. In CI neither file exists and the values come from the db job's env —
// override:false keeps CI authoritative.
loadEnv({ path: '.env.local', override: false });

// Forced AFTER .env.local, so nothing there can win:
// - a real Places key can never reach a test (msw's Places handler requires the header);
// - the lane exercises the paid path, against msw only — D-01: no test ever spends;
// - src/env.ts requires a non-empty Clerk secret; Clerk is never dialled here, so a
//   placeholder is correct and a real secret would be exposure for nothing.
process.env.GOOGLE_PLACES_API_KEY = 'test-key-not-real';
process.env.PLACES_MODE = 'enterprise';
process.env.CLERK_SECRET_KEY =
  process.env.CLERK_SECRET_KEY || 'sk_test_placeholder_for_workflow_tests_only';

// The same `server-only` no-op twin the unit lane's node project uses — see the long
// comment in vitest.config.ts for why this is an alias and not a resolve condition.
// Step bundles do not need it (@workflow/builders treats `server-only` as an empty
// pseudo-package); the test files that import src/ modules directly do.
const serverOnlyNoop = join(
  dirname(createRequire(import.meta.url).resolve('server-only')),
  'empty.js',
);

export default defineConfig({
  plugins: [workflow()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': serverOnlyNoop,
    },
  },
  test: {
    include: ['tests/workflow/**/*.test.ts'],
    // Merged with the workflow() plugin's own setup file. See the file for why (04-22).
    setupFiles: ['tests/workflow/_json-imports.ts'],
    pool: 'forks',
    fileParallelism: false, // one file at a time: the lane shares the local test database
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
