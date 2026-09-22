import { SignOutButton } from '@clerk/nextjs';

/**
 * D-02's landing for a session with no active organization. Structure only, plain HTML,
 * SignOutButton as the only affordance — a user who lands here cannot fix it themselves
 * (Siteless is invite-only and users cannot create organizations), so offering anything
 * else would be a dead end dressed up as a control.
 *
 * Reaching this screen is the CORRECT outcome for a membership-less session. The failure
 * this page exists to prevent is the empty, error-free product.
 */
export default async function NoAccess({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return (
    <main>
      <h1 data-testid="no-access">No access</h1>
      <p>
        {reason === 'none'
          ? 'Your account is not a member of a Siteless organization yet. Siteless is invite-only.'
          : 'You do not have access to this workspace.'}
      </p>
      <SignOutButton>Sign out</SignOutButton>
    </main>
  );
}
