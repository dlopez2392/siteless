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
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Assigned AFTER .env.local so a real key there can never reach a test; msw's Places
// handler requires the header. This lane loads no env file itself, but the assignment is
// unconditional on purpose: a key exported in the shell is overwritten just the same.
process.env.GOOGLE_PLACES_API_KEY = 'test-key-not-real';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

// The node lane additionally resolves `server-only` to its no-op twin.
//
// `server-only` exports TWO modules: `empty.js` under the `react-server` condition, and
// `index.js` — whose entire body is a `throw` — under every other. That IS the mechanism:
// importing a server module from a client bundle is meant to explode. Next compiles
// server code with `react-server` set; Vitest does not, so `import 'server-only'` on
// line 1 of src/env.ts, src/db/with-org.ts or src/lib/geocode/census.ts makes those
// modules unimportable from a unit test — the import throws before a single test runs.
//
// 🔴 Why an alias and not `resolve.conditions: ['react-server', ...]`: Vitest EXTERNALISES
// node_modules dependencies, so `server-only` is imported by Node's own resolver, which
// never sees Vite's conditions. Adding the condition looks right, changes nothing, and
// leaves the same error — which is why this comment exists.
//
// The target is resolved through `require.resolve` rather than spelled as a path: the
// package's `exports` map does not expose `./empty.js`, so a bare `server-only/empty.js`
// specifier is refused, and hard-coding `node_modules/...` would assume a hoisting layout
// pnpm does not promise.
//
// Applied to the NODE lane only, deliberately: the dom lane simulates the client, where
// that throw is a real guard and must stay armed.
const serverOnlyNoop = join(
  dirname(createRequire(import.meta.url).resolve('server-only')),
  'empty.js',
);
const nodeAlias = { ...alias, 'server-only': serverOnlyNoop };

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
        resolve: { alias: nodeAlias },
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
