/**
 * The coordinate purge, by hand (D-12) — the desk fallback for the daily Vercel Cron job.
 *
 *   pnpm purge:places [--target=test|prod]
 *   (= tsx scripts/purge-places.ts ...)
 *
 * WHEN: /sources shows the purge-overdue alert (the last purge is more than 36 hours old, or
 * expired coordinates are waiting), and the Vercel cron log for `/api/cron/purge-places` does
 * not explain it. docs/runbooks/places.md § Coordinate purge.
 *
 * WHAT: `select * from app.purge_expired_place_coordinates('desk')` — the same definer the cron
 * route runs, with trigger `desk`, so `place_purge_runs` records which path ran it. It deletes
 * every `place_coordinates` row with `expires_at <= now()` across all orgs and writes one
 * `place_purge_runs` row per org (zero included). Idempotent: a second run purges 0.
 *
 * 🔴 CONNECTS AS THE MIGRATION OWNER, never through `siteless_cron`. The owner owns the
 * function and can always execute it (drizzle/0028 § 4); no role is assumed and no claims are
 * set — the purge takes no org.
 *
 * 🔴 THE TARGET GATE is `scripts/resolve.ts`'s (D-04): `--target` defaults to `test`, production
 * demands the explicit `--target=prod` AND the Supabase SESSION pooler URL; `--target=test`
 * refuses any Supabase host. An unknown flag is refused rather than ignored.
 *
 * No `server-only` import and no app DB client anywhere in the graph: this runs under `tsx`.
 */
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

export interface PurgeArgs {
  target: 'test' | 'prod';
}

const KNOWN_FLAGS = ['--target='] as const;

/** Pure. An unknown flag is refused rather than ignored. */
export function parsePurgeArgs(argv: readonly string[]): PurgeArgs {
  for (const arg of argv) {
    if (!KNOWN_FLAGS.some((f) => arg.startsWith(f))) {
      throw new Error(
        `purge-places: unknown argument ${JSON.stringify(arg)} (expected --target=test|prod)`,
      );
    }
  }
  const target = argv.find((a) => a.startsWith('--target='))?.slice('--target='.length) ?? 'test';
  if (target !== 'test' && target !== 'prod') {
    throw new Error('purge-places: unknown target ' + target + ' (test | prod)');
  }
  return { target };
}

/** `resolveResolveUrl`'s checks (scripts/resolve.ts), verbatim in shape. D-04. */
export function resolvePurgeUrl(target: 'test' | 'prod'): string {
  const url = target === 'prod' ? process.env.SUPABASE_DB_URL : process.env.TEST_DATABASE_URL;
  const varName = target === 'prod' ? 'SUPABASE_DB_URL' : 'TEST_DATABASE_URL';
  if (!url) throw new Error('purge-places: ' + varName + ' is not set. See docs/local-postgres.md.');
  const looksLikeSupabase = /supabase\.(co|com)|pooler\.supabase/.test(url);
  if (target === 'test' && looksLikeSupabase) {
    throw new Error('purge-places: --target=test refuses a Supabase host. D-04.');
  }
  if (target === 'prod' && !looksLikeSupabase) {
    throw new Error('purge-places: --target=prod expects the Supabase session pooler URL.');
  }
  if (target === 'prod' && !url.includes(':5432')) {
    throw new Error(
      'purge-places: --target=prod must use the SESSION pooler (port 5432). The transaction pooler (6543) is not the desk-script path.',
    );
  }
  return url;
}

async function main(): Promise<void> {
  // The gate. Throws before any I/O at all.
  const args = parsePurgeArgs(process.argv.slice(2));
  loadEnv({ path: '.env.local', override: false, quiet: true });
  const url = resolvePurgeUrl(args.target);
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    console.log(`purge-places: target=${args.target}`);
    const r = await client.query<{ purged_org: string; purged_rows: number }>(
      "select purged_org, purged_rows from app.purge_expired_place_coordinates('desk')",
    );
    // One row PER ORG, zero included — sum the rows, never count them.
    let total = 0;
    for (const row of r.rows) {
      total += Number(row.purged_rows);
      console.log(`  org ${row.purged_org}: ${row.purged_rows} coordinate rows purged`);
    }
    console.log(`purge-places: done · ${r.rows.length} orgs · ${total} rows purged`);
  } finally {
    await client.end();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
