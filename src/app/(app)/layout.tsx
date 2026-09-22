import { currentUser } from '@clerk/nextjs/server';
import { AppSidebar } from '@/components/app-shell/app-sidebar';
import { MobileTabBar } from '@/components/app-shell/mobile-tab-bar';
import { TopBar } from '@/components/app-shell/top-bar';
import { ensureOrgRow, orgClaims, requireOrg } from '@/lib/auth/require-org';
import { SKIP_LINK } from '@/lib/ui/copy';

export const dynamic = 'force-dynamic';

/**
 * The shell every screen in Phases 2 through 9 renders inside (02-UI-SPEC.md § App shell).
 *
 * 🔴 T-2-01: `requireOrg()` IS THE FIRST STATEMENT, so no page beneath this group can
 * render for a signed-out session or for one with no ACTIVE organization. `src/proxy.ts`
 * carries no authorization by design (CVE-2025-29927; STACK.md § What NOT to Use), so
 * this layout is the single gate — not a second line of defence, the only one.
 *
 * 🔴 D-03's just-in-time provisioning moved here from `src/app/page.tsx`. On the old
 * home page exactly one route provisioned the `orgs` row; every route under this group
 * now does, so a user whose first click is a deep link is not a tenant-less request.
 * `app.ensure_org` is select-then-do-nothing (migration 0009), so the common path writes
 * nothing and fires no audit trigger.
 *
 * 🔴 Everything the chrome needs about the org and the user is read HERE and passed DOWN
 * as props. The nav components are `"use client"`, and a client module's exports are
 * client references inside a server component — plain data included — resolving to
 * `undefined` at runtime with typecheck, lint and build all green (Executor Rule 5).
 * Props cross that boundary safely; imports of data do not.
 */

/**
 * Two letters for the avatar. Falls back through name -> email -> a single glyph, because
 * an empty avatar reads as a broken image rather than as a missing display name.
 */
function initialsOf(name: string, email: string): string {
  const source = (name.trim() || email.trim()).trim();
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
  const picked = last ? (first.charAt(0) + last.charAt(0)) : source.slice(0, 2);
  return picked.toUpperCase();
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { orgId, orgSlug } = await requireOrg();
  const claims = await orgClaims();
  await ensureOrgRow(claims, orgSlug ?? orgId); // D-03, just-in-time

  const user = await currentUser();
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? '';
  const userName = user?.fullName ?? user?.firstName ?? userEmail;

  // Clerk's slug is the org's human handle, and it is also exactly what `ensureOrgRow`
  // wrote into `orgs.display_name`, so the label on screen and the label in the database
  // cannot disagree.
  const orgLabel = orgSlug ?? orgId;

  return (
    <div data-testid="app-shell" className="flex min-h-svh w-full bg-background">
      {/* The first focusable element on every page in the product. */}
      <a
        href="#main"
        data-testid="skip-link"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:inline-flex focus:h-11 focus:items-center focus:rounded-lg focus:bg-primary focus:px-4 focus:text-base focus:text-primary-foreground"
      >
        {SKIP_LINK}
      </a>

      <AppSidebar
        orgLabel={orgLabel}
        userName={userName}
        userEmail={userEmail}
        initials={initialsOf(userName, userEmail)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          orgLabel={orgLabel}
          userName={userName}
          userEmail={userEmail}
          initials={initialsOf(userName, userEmail)}
        />

        {/* Gutters 16 / 24 / 32 and a 1120px reading-measure cap, per UI-SPEC § App shell.
            The bottom padding on phone is 16px PLUS the tab bar's 64px and its safe-area
            inset, so the last row of any screen is never under the thumb bar. */}
        <main
          id="main"
          className="mx-auto w-full max-w-[1120px] flex-1 px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pb-8 sm:pt-6 lg:px-8 lg:pt-8"
        >
          {children}
        </main>
      </div>

      <MobileTabBar />
    </div>
  );
}
