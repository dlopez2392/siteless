import { auth } from '@clerk/nextjs/server';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db/client';

export const dynamic = 'force-dynamic';

/**
 * Liveness only. It reports UP or DOWN and nothing else: never the database error text,
 * never the DSN, never a claim payload. This endpoint is unauthenticated by design and
 * reachable by anyone, so the response shape is a fixed set of enum values plus the
 * commit sha, and the cause is logged server-side by error NAME alone.
 *
 * The `proxy` field is the canary from RESEARCH Pitfall 7 — with proxy.ts in the wrong
 * directory, clerkMiddleware() never runs, auth() throws auth_signature_invalid, and this
 * route is the first place that shows up. Plan 10 hits it in CI after deploy.
 *
 * 🔴 The select 1 below is the ONE database call outside withOrg() in the whole codebase.
 * It is allowed here because it carries no claims and reads no table. It is NOT a
 * precedent: everything that touches a tenant's rows goes through withOrg(), which is
 * what turns a missed org scope into zero rows instead of another tenant's data.
 */
export async function GET() {
  let dbState: 'up' | 'down' = 'down';
  let proxyState: 'up' | 'down' = 'down';
  try {
    await db.execute(sql`select 1`);
    dbState = 'up';
  } catch (e) {
    console.error('health: database probe failed', e instanceof Error ? e.name : 'unknown');
  }
  try {
    await auth();
    proxyState = 'up';
  } catch {
    console.error(
      'health: clerkMiddleware did not run — check that proxy.ts is at src/, level with app/',
    );
  }
  const ok = dbState === 'up' && proxyState === 'up';
  return NextResponse.json(
    { ok, db: dbState, proxy: proxyState, commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local' },
    { status: ok ? 200 : 503 },
  );
}
