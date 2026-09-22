/**
 * The single gate deciding which database any migration reaches.
 *
 * Windows has no `VAR=x cmd` syntax and this repo runs from both Git Bash and
 * PowerShell, so target selection lives here rather than in a shell prefix.
 *
 *   pnpm db:generate     -> tsx scripts/db.ts generate
 *   pnpm db:custom       -> tsx scripts/db.ts custom
 *   pnpm db:migrate      -> tsx scripts/db.ts migrate --target=test
 *   pnpm db:migrate:prod -> tsx scripts/db.ts migrate --target=prod
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', override: false, quiet: true });

const [command, ...rest] = process.argv.slice(2);
const targetArg = rest.find((a) => a.startsWith('--target='));
const target = targetArg ? targetArg.slice('--target='.length) : 'test';
const passthrough = rest.filter((a) => !a.startsWith('--target='));

if (command !== 'generate' && command !== 'migrate' && command !== 'custom') {
  throw new Error('scripts/db.ts: unknown command ' + command + ' (generate | migrate | custom)');
}
if (target !== 'test' && target !== 'prod') {
  throw new Error('scripts/db.ts: unknown target ' + target + ' (test | prod)');
}

const url = target === 'prod' ? process.env.SUPABASE_DB_URL : process.env.TEST_DATABASE_URL;
const varName = target === 'prod' ? 'SUPABASE_DB_URL' : 'TEST_DATABASE_URL';
if (!url) throw new Error('scripts/db.ts: ' + varName + ' is not set. See docs/local-postgres.md.');

// D-04: the cloud project jahgeqshuesndyscnmjo is production only. A test-target URL
// that reaches it would run the RLS suite's DDL against production.
const looksLikeSupabase = /supabase\.(co|com)|pooler\.supabase/.test(url);
// --target=test must never reach a supabase host, whatever the variable happens to hold.
if (target === 'test' && looksLikeSupabase) {
  throw new Error('scripts/db.ts: --target=test refuses a Supabase host. D-04.');
}
// --target=prod is the only target allowed to reach a supabase host, and only the session pooler.
if (target === 'prod' && !looksLikeSupabase) {
  throw new Error('scripts/db.ts: --target=prod expects the Supabase session pooler URL.');
}
if (target === 'prod' && !url.includes(':5432')) {
  throw new Error(
    'scripts/db.ts: --target=prod must use the SESSION pooler (port 5432). The transaction pooler (6543) cannot run migrations.',
  );
}

const args =
  command === 'custom' ? ['generate', '--custom', ...passthrough] : [command, ...passthrough];

// Spawn drizzle-kit's own entry point with this process's node binary.
// NOT `pnpm exec`: a bare `pnpm` on the dev machine's PATH resolves to 11.9.0 whose
// self-switch shim to 12.5.1 is broken (01-01-SUMMARY deviation 1), so a child process
// named `pnpm` dies before drizzle-kit ever runs. Resolving the bin relative to this
// file keeps it correct under pnpm's symlinked store and needs no shell.
const drizzleKitBin = fileURLToPath(new URL('../node_modules/drizzle-kit/bin.cjs', import.meta.url));

const run = spawnSync(process.execPath, [drizzleKitBin, ...args], {
  stdio: 'inherit',
  env: { ...process.env, DRIZZLE_DB_URL: url },
});
if (run.error) throw run.error;
if (run.status !== 0) process.exit(run.status ?? 1);

// After a successful local migrate, give app_user a password so the dev server and CI
// can connect as the non-owner runtime role (D-11b). Localhost only — never the pooler.
if (command === 'migrate' && target === 'test' && /@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  const { Client } = await import('pg');
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  await c.connect();
  try {
    await c.query("alter role app_user with login password 'app_user'");
    console.log('scripts/db.ts: local app_user password set (dev/CI only).');
  } finally {
    await c.end();
  }
}
