import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from './client';

/** Never interpolate a role that came from input. */
const ROLES = new Set(['authenticated', 'anon']);

/**
 * The claims a request hands the database.
 *
 * 🔴 `org_role` CARRIES THE PREFIXED CLERK SPELLING, VERBATIM, AND IS NOT OPTIONAL IN
 * PRACTICE — it is optional in the type only because Phase 1 shipped without it. Every
 * role-gated function in the database reads the role out of these claims, and until plan
 * 02-13 nothing put one in: `orgClaims()` synthesized `{ o: { id } }` with no role at all,
 * so `app.current_org_role()` returned NULL for everybody and `app.set_budget_cap` raised
 * `42501` at danlo — a verified org ADMIN — on every attempt. The db tests could not see
 * it because their fixtures supply the role directly; the defect lives in the claims the
 * APP builds, and it only became reachable when a screen first called the action
 * (plan 02-13, deviation 2).
 *
 * 🔴 THE PREFIX IS STRIPPED IN SQL, NEVER IN TYPESCRIPT. Clerk session token v2 nests the
 * BARE role under `o.rol` ('admin'), while `@clerk/shared` builds `auth().orgRole` as
 * `org:${o.rol}` ('org:admin'). `app.current_org_role()` (migration 0016) exists precisely
 * to normalise both spellings, and its flat `org_role` branch does the `org:` strip. So
 * what goes in here is whatever `auth()` returned, untouched: any `.replace('org:', '')`
 * on this side would be a second place to get the trap wrong, and the trap is a silent
 * pass-or-fail rather than an error.
 */
export type OrgClaims = {
  o: { id: string };
  sub: string;
  role: 'authenticated';
  /** `auth().orgRole` as Clerk spells it — `'org:admin'`, `'org:basic_member'`. */
  org_role?: string;
};

/**
 * THE runtime database entry point. Everything a request touches goes through here.
 *
 * The Drizzle docs' Supabase recipe interpolates the serialized claims into the
 * statement as raw SQL text — that breaks, or injects, the moment a claim value contains
 * a single quote. Bind the parameter instead. (The forbidden form is enforced by a bare
 * token grep over this file, so it is not spelled here; the one raw() call below carries
 * a role that was allow-listed against a Set two lines earlier, never a claim value.)
 *
 * The `true` on set_config is the LOCAL form: it dies with the transaction. The non-local
 * form survives the commit, and on a transaction-mode pooler the connection is handed to
 * the next request with the previous tenant's claims still set (verified).
 *
 * Both of those are load-bearing and invisible to typecheck, so they are pinned by
 * tests/db/with-org.test.ts, not by a one-time grep. Changing the `true` below to `false`
 * is mutation M4 in 01-VALIDATION.md and must turn that one test red.
 */
export async function withOrg<T>(
  claims: OrgClaims,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  if (!ROLES.has(claims.role)) throw new Error('withOrg: refusing role ' + claims.role);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`);
    await tx.execute(sql.raw('set local role ' + claims.role)); // safe: allow-listed above
    return fn(tx);
  });
}
