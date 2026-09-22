import { SignOutButton } from '@clerk/nextjs';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

/**
 * D-02's landing for a session with no active organization, restyled onto the shared
 * `Empty` primitive. The copy and the behaviour are unchanged from Phase 1 — only the
 * surface is new.
 *
 * 🔴 THIS PAGE SITS OUTSIDE THE `(app)` GROUP ON PURPOSE. A user with no active
 * organization cannot pass `requireOrg()`, so it cannot render inside the shell without
 * the shell's own gate redirecting them straight back here. It still inherits the fonts,
 * the painted tokens and the theme from the root layout, which is why it looks like the
 * product rather than like an error page from somewhere else.
 *
 * `SignOutButton` is the only affordance, as before: Siteless is invite-only and users
 * cannot create organizations, so any other control would be a dead end dressed up as a
 * way out. Reaching this screen is the CORRECT outcome for a membership-less session —
 * the failure it exists to prevent is the empty, error-free product.
 */
export default async function NoAccess({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[1120px] items-center px-4 py-12 sm:px-6 lg:px-8">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon" className="size-12 rounded-full">
            <ShieldAlert data-icon="shield-alert" aria-hidden="true" className="size-6" />
          </EmptyMedia>
          <EmptyTitle data-testid="no-access" className="text-xl font-semibold">
            No access
          </EmptyTitle>
          <EmptyDescription className="text-base font-normal">
            {reason === 'none'
              ? 'Your account is not a member of a Siteless organization yet. Siteless is invite-only.'
              : 'You do not have access to this workspace.'}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <SignOutButton>
            <Button variant="outline" data-testid="no-access-sign-out" className="h-11 w-full">
              Sign out
            </Button>
          </SignOutButton>
        </EmptyContent>
      </Empty>
    </main>
  );
}
