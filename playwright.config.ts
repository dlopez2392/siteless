import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { assertRequiredEnv } from './tests/e2e/_required-env';

loadEnv({ path: '.env.local', override: false });
assertRequiredEnv();

// tests/e2e/.auth/ is gitignored — the storage state is a live Clerk session.
const AUTH_FILE = 'tests/e2e/.auth/storage-state.json';

// There is deliberately no local-server block below. Success criterion 1 runs this
// suite against the DEPLOYED Vercel URL, supplied as E2E_BASE_URL (plan 11). Starting a
// server here would test a build nobody shipped.

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // `list` writes nothing to disk, so a failed CI run used to leave the console output and
  // nothing else — while `trace: 'retain-on-failure'` below was quietly writing the traces
  // that show WHY a signed-in assertion failed against production, into outputDir
  // (`test-results/`), which the workflow did not upload. In CI, add the HTML report and
  // upload both. `open: 'never'` matters: the html reporter otherwise tries to spawn a
  // browser at the end of the run and hangs a headless agent.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  expect: { timeout: 10000 },
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
      dependencies: ['setup'],
    },
  ],
});
