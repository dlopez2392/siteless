import 'server-only';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/env';
import * as schema from './schema';

/**
 * The database for anything a signed-in human can reach. RLS applies.
 *
 * Connects as app_user — NOT the owner. A table owner bypasses RLS, so a code path that
 * skips withOrg on an owner connection reads every tenant's rows and nothing complains.
 * As a NOINHERIT non-owner it gets 42501 instead, which is the whole point.
 *
 * prepare:false is mandatory on the transaction pooler and is the most common
 * Supabase + Drizzle production failure. max:1 because each serverless invocation owns
 * its own pool — and because it is what makes tests/db/with-org.test.ts a real
 * pooled-reuse test rather than a lucky one.
 *
 * Do NOT reach around withOrg() to use `db` directly. The database backstop is what
 * turns a missed org scope into zero rows instead of another tenant's data. The one
 * exception in the whole codebase is /api/health's `select 1`, which carries no claims
 * and reads no table.
 */
const client = postgres(env.SUPABASE_DB_POOL_URL, { prepare: false, max: 1 });

export const db = drizzle({ client, schema });
