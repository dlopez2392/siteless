import { timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { withCronRole } from '@/db/with-cron-role';
import { env } from '@/env';

export const dynamic = 'force-dynamic';

/**
 * The daily coordinate purge (D-12, 04-RESEARCH Pattern 10) — Vercel Cron's target, scheduled
 * in `vercel.json` at `17 9 * * *` (09:17 UTC ≈ 04:17 Chicago).
 *
 * Vercel Cron delivery is best-effort and may duplicate or skip; the purge is an idempotent
 * reconciliation ("delete everything expired") and the database already refuses to read any
 * coordinate, so a skipped day is visible on /sources (purge-overdue), never a silent breach.
 * Second non-withOrg DB path in the app — through withCronRole, which can execute exactly one
 * function (drizzle/0028: `siteless_cron` holds EXECUTE on the purge and no table privilege).
 *
 * 🔴 THE GATE (T-4-08, M50). Anyone on the internet can GET this URL; only Vercel Cron holds
 * the bearer. `clerkMiddleware()` in src/proxy.ts sets session context only and protects no
 * route, so an unauthenticated GET reaches this handler — this check IS the authorization.
 *   - `CRON_SECRET` unset → 503 `not_configured`. Never "run unauthenticated because nothing
 *     was configured": an unset secret must fail closed.
 *   - The header must be exactly `Bearer ${CRON_SECRET}`, compared with `timingSafeEqual`.
 *     `timingSafeEqual` THROWS on buffers of unequal length, so the length is checked first
 *     (the length of the expected header is not a secret worth hiding; its bytes are).
 *
 * 🔴 FIXED-ENUM BODIES (T-4-05). `{ ok, reason }` or `{ ok, orgs, rowsPurged }` and nothing
 * else: never the secret, never an error message, never a DSN. A failure is logged by error
 * NAME only, the same rule as /api/health.
 *
 * 🔴 SUM, NEVER COUNT. The purge returns ONE ROW PER ORG, orgs with nothing to purge included
 * (so "last purge" on /sources is true per tenant); `rowsPurged` is the sum of `purged_rows`,
 * `orgs` the number of rows.
 */
type PurgeRow = { purged_org: string; purged_rows: number | string };

export async function GET(request: Request) {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 503 });
  }

  const got = Buffer.from(request.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await withCronRole((tx) =>
      tx.execute(
        sql`select purged_org, purged_rows from app.purge_expired_place_coordinates('cron')`,
      ),
    );
    const rows = result as unknown as PurgeRow[];
    const rowsPurged = rows.reduce((sum, row) => sum + Number(row.purged_rows), 0);
    return NextResponse.json({ ok: true, orgs: rows.length, rowsPurged }, { status: 200 });
  } catch (e) {
    console.error('purge-places: purge failed', e instanceof Error ? e.name : 'unknown');
    return NextResponse.json({ ok: false, reason: 'purge_failed' }, { status: 500 });
  }
}
