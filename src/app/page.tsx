import { ensureOrgRow, orgClaims, requireOrg } from '@/lib/auth/require-org';

export const dynamic = 'force-dynamic';

/**
 * Success criterion 1's application half: who is signed in, and which tenant the request
 * resolved to. The org id comes only from Clerk's server-verified auth(), never from a
 * header, query param or cookie the app set.
 *
 * The data-testid attributes are how the e2e spec asserts org scoping without depending
 * on copy. There is no CSS here at all, which is the point — Phase 1 is an unstyled shell.
 */
export default async function Home() {
  const { userId, orgId, orgSlug } = await requireOrg();
  const claims = await orgClaims();
  const orgRowId = await ensureOrgRow(claims, orgSlug ?? orgId); // D-03, just-in-time
  return (
    <main>
      <h1>Siteless</h1>
      <p data-testid="signed-in-as">Signed in as {userId}</p>
      <p data-testid="org-id">Org {orgId}</p>
      <p data-testid="org-row-id">Tenant {orgRowId}</p>
    </main>
  );
}
