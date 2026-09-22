// Line 1, in the MAIN process, before any worker spawns.
//
// vitest's `test.env.TZ` does NOT change the zone in the threads/vmThreads pools —
// Node worker threads lock Intl's zone at thread creation — and `TZ=x pnpm test`
// does nothing at all in PowerShell. Setting it here, plus the forks pool declared
// below so every worker is a child process that inherits it, is what actually pins it.
//
// Pinned to UTC, DELIBERATELY NOT America/Chicago: this dev machine IS Chicago, so a
// Chicago-pinned suite cannot discriminate. In UTC, code that forgot an explicit zone
// renders UTC and the Chicago assertion goes red. See tests/unit/suite-zone.test.ts.
process.env.TZ = 'UTC';
process.env.LANG = 'en_US.UTF-8';

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    pool: 'forks',
    environment: 'node',
    testTimeout: 15000,
  },
});
