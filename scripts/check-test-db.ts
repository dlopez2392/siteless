/**
 * Connection + server-version probe for TEST_DATABASE_URL.
 *
 *   pnpm db:check              server reachable, PostgreSQL >= 18
 *   pnpm db:check --bootstrap  the above, plus proof that migration 0000 took and that the
 *                              applied set still matches the journal
 *
 * Prints only the server banner and `ok` lines. The connection string, the password
 * and the claims payload are never echoed (T-1-22).
 */
import { readFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

loadEnv({ path: '.env.local', override: false, quiet: true });

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('check-test-db: TEST_DATABASE_URL is not set. See docs/local-postgres.md.');
if (/supabase\.(co|com)|pooler\.supabase/.test(url)) {
  throw new Error('check-test-db: TEST_DATABASE_URL points at a Supabase host. D-04.');
}

const checkBootstrap = process.argv.slice(2).includes('--bootstrap');

const c = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
await c.connect();
try {
  const { rows } = await c.query<{ version: string; num: string }>(
    "select version() as version, current_setting('server_version_num') as num",
  );
  const row = rows[0];
  if (!row) throw new Error('check-test-db: select version() returned no row');
  const major = Math.floor(Number(row.num) / 10000);
  if (major < 18) {
    throw new Error('check-test-db: expected PostgreSQL 18 or newer, got major ' + major);
  }
  console.log('check-test-db: ok — ' + row.version.split(',')[0]);

  if (checkBootstrap) {
    // 1. The four Supabase-shaped roles exist and nothing else was created by accident.
    const roles = await c.query<{ rolname: string }>(
      "select rolname from pg_roles where rolname in ('anon','authenticated','service_role','app_user') order by 1",
    );
    const found = roles.rows.map((r) => r.rolname).join(',');
    if (found !== 'anon,app_user,authenticated,service_role') {
      throw new Error('check-test-db: expected the four bootstrap roles, got [' + found + ']');
    }
    console.log('ok — roles anon, app_user, authenticated, service_role exist');

    // 2. app_user is a LOGIN role and is NOINHERIT (D-11b). A forgotten `set local role`
    //    must raise 42501, not read every tenant.
    const appUser = await c.query<{ rolcanlogin: boolean; rolinherit: boolean }>(
      "select rolcanlogin, rolinherit from pg_roles where rolname = 'app_user'",
    );
    const au = appUser.rows[0];
    if (!au) throw new Error('check-test-db: role app_user not found');
    if (au.rolcanlogin !== true || au.rolinherit !== false) {
      throw new Error(
        'check-test-db: app_user must be login + NOINHERIT, got login=' +
          au.rolcanlogin +
          ' inherit=' +
          au.rolinherit,
      );
    }
    console.log('ok — app_user is login + NOINHERIT');

    // 3. The app schema exists.
    const nsp = await c.query("select 1 from pg_namespace where nspname = 'app'");
    if (nsp.rowCount !== 1) throw new Error('check-test-db: schema app does not exist');
    console.log('ok — schema app exists');

    // 4. app.jwt() returns an empty object when no claims are set.
    const emptyJwt = await c.query<{ jwt: unknown }>('select app.jwt() as jwt');
    const jwtValue = JSON.stringify(emptyJwt.rows[0]?.jwt);
    if (jwtValue !== '{}') {
      throw new Error('check-test-db: app.jwt() with no claims returned ' + jwtValue);
    }
    console.log('ok — app.jwt() returns {} with no claims set');

    // 5. The GUC path works under the Clerk session-token v2 claim shape ({ o: { id } }).
    const claimed = await c.query<{ org: string | null }>(
      "select set_config('request.jwt.claims', '{\"o\":{\"id\":\"org_X\"}}', true) as _cfg, app.jwt()->'o'->>'id' as org",
    );
    const org = claimed.rows[0]?.org;
    if (org !== 'org_X') {
      throw new Error('check-test-db: expected org_X from the v2 claim path, got ' + String(org));
    }
    console.log('ok — app.jwt() v2 claim path returns ' + org);

    // 6. app_user can reach schema public (its only path to a table is `set local role`).
    const usage = await c.query<{ has: boolean }>(
      "select has_schema_privilege('app_user','public','usage') as has",
    );
    if (usage.rows[0]?.has !== true) {
      throw new Error('check-test-db: app_user lacks USAGE on schema public');
    }
    console.log('ok — app_user has USAGE on schema public');

    // 7. drizzle-kit — and nothing else — recorded the migrations (D-09).
    //    `hash` is a SHA-256 of the SQL text, not the filename, so a row is tied back to
    //    its tag through the journal's `when`, which drizzle-kit writes verbatim into
    //    created_at.
    //
    //    This used to assert `rowCount === 1` and then read `rows[0]`, which was true only
    //    on the day 0000 was the only migration. With nine entries in the journal it threw
    //    `expected exactly 1 ... row, got 9` on every CORRECTLY migrated database — the
    //    `--bootstrap` mode that docs/local-postgres.md and docs/deploy.md point new setups
    //    at proved the opposite of what it claims. The unordered `rows[0]` was the second
    //    half of the bug: with no ORDER BY, "the bootstrap row" was whichever row the heap
    //    happened to return first.
    //
    //    Both halves are now counted rather than indexed. Counting 0000 by its `when`
    //    keeps the original claim (the bootstrap migration is recorded, exactly once), and
    //    comparing the total against the journal length keeps the stronger one the old
    //    rowCount check was reaching for: nothing but drizzle-kit has written here, and no
    //    migration is missing.
    const journal = JSON.parse(
      readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: { tag: string; when: number }[] };
    const bootstrapEntry = journal.entries.find((e) => e.tag === '0000_bootstrap');
    if (!bootstrapEntry) throw new Error('check-test-db: no 0000_bootstrap entry in the journal');

    const applied = await c.query<{ n: number }>(
      'select count(*)::int as n from drizzle.__drizzle_migrations where created_at = $1',
      [String(bootstrapEntry.when)],
    );
    if (applied.rows[0]?.n !== 1) {
      throw new Error(
        'check-test-db: 0000_bootstrap is recorded ' +
          String(applied.rows[0]?.n) +
          ' times in drizzle.__drizzle_migrations, expected exactly 1',
      );
    }
    const total = await c.query<{ n: number }>(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );
    if (total.rows[0]?.n !== journal.entries.length) {
      throw new Error(
        'check-test-db: ' +
          String(total.rows[0]?.n) +
          ' migrations applied, the journal has ' +
          String(journal.entries.length) +
          ' — run pnpm db:migrate',
      );
    }
    console.log(
      'ok — drizzle.__drizzle_migrations holds the 0000_bootstrap row and all ' +
        String(journal.entries.length) +
        ' journal entries',
    );
  }
} finally {
  await c.end();
}
