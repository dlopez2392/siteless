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
//
// This assignment covers BOTH projects declared below. They are inline projects in
// this one file, so they share this main process and inherit this pin — which is the
// reason this shape was chosen over a separate vitest.dom.config.ts, where the pin
// would have had to be duplicated and could drift.
process.env.TZ = 'UTC';
process.env.LANG = 'en_US.UTF-8';

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    // Two lanes, split by file extension.
    //
    // The node lane's `environment: 'node'` is load-bearing and must not be widened:
    // tests/unit/suite-zone.test.ts and tests/unit/time.test.ts both assert against
    // the process zone and would go vacuous under jsdom.
    //
    // The dom lane exists because a `.test.tsx` had a glob but no DOM and no JSX
    // transform, so it could only ever fail (02-RESEARCH.md § Validation Architecture,
    // harness change 2).
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          pool: 'forks',
          testTimeout: 15000,
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'dom',
          include: ['tests/unit/**/*.test.tsx'],
          environment: 'jsdom',
          pool: 'forks',
          setupFiles: ['tests/unit/_setup-dom.ts'],
          testTimeout: 15000,
        },
      },
    ],
  },
});
