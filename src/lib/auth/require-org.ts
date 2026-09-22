import 'server-only';
import { auth } from '@clerk/nextjs/server';
import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { withOrg, type OrgClaims } from '@/db/with-org';

/**
 * Deny by default, and redirect rather than 403 — never confirm to a wrong-tenant caller
 * that the resource exists.
 *
 * orgId is null until an organization is ACTIVATED on the session, not merely joined.
 * BIS shipped that bug on 2026-09-16: a user who accepted a valid invitation and signed
 * in was told they had no company. Treating null as a routing decision here means no page
 * can ever render a query with a null org.
 */
export async function requireOrg() {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) redirect('/sign-in');
  if (!orgId) redirect('/no-access?reason=none');
  return { userId, orgId, orgSlug: orgSlug ?? null };
}

export async function orgClaims(): Promise<OrgClaims> {
  const { userId, orgId } = await requireOrg();
  return { o: { id: orgId }, sub: userId, role: 'authenticated' };
}

/**
 * D-03: provision the orgs row just-in-time on the first authenticated request carrying a
 * Clerk org claim not yet seen. app.ensure_org is SECURITY DEFINER and re-checks its
 * argument against the caller's claim, so `authenticated` never needs INSERT on the
 * tenant root and no caller can provision somebody else's org.
 *
 * Deliberately NOT ported from BIS: its guard reaches around RLS to a privileged client
 * here. BIS does that on purpose and carries a 24-line argued exception for it. Siteless
 * has no such key in this phase and must not acquire one, so the provisioning call goes
 * through withOrg like everything else. (The privileged client's two names are enforced
 * absent from src/ by a bare token grep, so neither is spelled here.)
 */
export async function ensureOrgRow(claims: OrgClaims, displayName: string): Promise<string> {
  return withOrg(claims, async (tx) => {
    const res = await tx.execute(sql`select app.ensure_org(${claims.o.id}, ${displayName}) as id`);
    const row = (res as unknown as Array<{ id: string }>)[0];
    if (!row?.id) throw new Error('ensureOrgRow: app.ensure_org returned no id');
    return row.id;
  });
}
