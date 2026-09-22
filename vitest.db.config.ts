// Line 1, in the MAIN process, before any worker spawns — same reasoning as
// vitest.config.ts. The DB suite renders timestamptz values, so an unpinned zone
// here would make every America/Chicago assertion vacuous on this Chicago machine.
process.env.TZ = 'UTC';
process.env.LANG = 'en_US.UTF-8';

import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// TEST_DATABASE_URL lives in the gitignored local env file. `dotenv/config` only reads
// plain `.env`, so the local file has to be named explicitly, below. In CI neither file
// exists and TEST_DATABASE_URL comes from the job env — override:false keeps CI
// authoritative.
loadEnv({ path: '.env.local', override: false });

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/db/**/*.test.ts'],
    pool: 'forks',
    // vitest 5 deleted `poolOptions.forks.singleFork` and its CLI twin — the run now
    // aborts with `CACError: Unknown option --poolOptions`. Its two effects, stated
    // directly with the options vitest 5 does have:
    fileParallelism: false, // one test file at a time; this also forces maxWorkers to 1
    isolate: false, // reuse the one forked child rather than spawn a fresh one per file
    environment: 'node',
    // 60s, not 20s. In BIS a 20s ceiling made the gate fail on wall clock
    // ("Test timed out in 20000ms") rather than on behaviour, and which file lost the
    // race moved between runs. withRollback opens a real connection per test.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
