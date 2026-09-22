'use client';

import { useAuth, useOrganizationList } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { soleOrganizationToActivate } from '@/lib/auth/sole-organization';

/**
 * Gives a signed-in user with exactly one organization an ACTIVE one.
 *
 * Renders nothing. It exists because Clerk keeps the active organization on the SESSION,
 * and with no organization selected the token carries no org claim at all — so
 * app.current_org_id() returns NULL, every RLS policy evaluates false, and the caller is
 * indistinguishable from someone who belongs to nothing. The product is then EMPTY AND
 * ERROR-FREE, which is the worst possible shape for a bug.
 *
 * PORTED FROM BIS, where it shipped on 2026-09-16: 956 Woodworks accepted a valid
 * invitation, signed in, and were told they had no company, with no control anywhere to
 * fix it. D-02 makes Siteless invite-only and "users can create organizations" is off, so
 * every Siteless user arrives by the exact path that produced that incident and none of
 * them can create an organization to dig themselves out.
 *
 * Mounted in the root layout so it covers every surface a client can land on signed-in
 * but unactivated — /, /no-access and /sign-in — rather than only the one page someone
 * remembered to put it on. See lib/auth/sole-organization.ts for which organization gets
 * picked and why "more than one" is deliberately left alone.
 *
 * 🔴 `treatPendingAsSignedOut: false` on the useAuth() call below is load-bearing, and it
 * is the whole reason this component did nothing on the first deployed run (plan 11).
 *
 * This Clerk version (@clerk/nextjs 7.9.4, @clerk/react 6.16.1) implements "organization
 * required" as a SESSION TASK. A user who signs in without an active organization does
 * not get a signed-in session with a null org — they get a session whose status is
 * PENDING, parked on the `choose-organization` task, and Clerk's hooks report a pending
 * session as SIGNED OUT by default (`treatPendingAsSignedOut` defaults to `true`, in
 * @clerk/shared PendingSessionOptions). So `isSignedIn` was `false`,
 * soleOrganizationToActivate returned null on its very first line, and the component
 * that exists to rescue this exact user rescued nobody — while rendering, mounted, and
 * throwing no error. Deployed, danlo saw Clerk's "Choose an organization" screen: the
 * 2026-09-16 BIS incident again, in a new costume.
 *
 * Reading through the pending state is what lets us RESOLVE it: setActive({ organization })
 * is how the choose-organization task is completed, after which the session goes active
 * and the server's auth() sees a real org claim.
 *
 * The SERVER deliberately does NOT do this. requireOrg() calls a bare auth(), so a pending
 * session stays signed-out there and is redirected — deny by default, and no page can
 * render a query for a session Clerk has not finished. Seeing through pending is a
 * client-side repair affordance, never a server-side authorization decision.
 */
export function ActivateSoleOrganization() {
  const { isLoaded: authLoaded, isSignedIn, orgId } = useAuth({ treatPendingAsSignedOut: false });
  const {
    isLoaded: listLoaded,
    setActive,
    userMemberships,
  } = useOrganizationList({ userMemberships: true });
  const router = useRouter();
  // Once per mount. `setActive` resolving does not guarantee the next render sees an
  // `orgId` — the session token has to come back first — and without this the effect
  // would fire again on that in-between render and loop.
  const attempted = useRef(false);

  useEffect(() => {
    if (!authLoaded || !listLoaded || !setActive || attempted.current) return;

    const organization = soleOrganizationToActivate({
      signedIn: Boolean(isSignedIn),
      activeOrgId: orgId,
      memberships: (userMemberships?.data ?? []).map((mem) => ({
        organizationId: mem.organization.id,
      })),
    });
    if (!organization) return;

    attempted.current = true;
    void setActive({ organization })
      // A FULL NAVIGATION, deliberately not the soft client-side refresh the app router
      // offers (that token is grep-enforced absent from this file, so it is not spelled):
      // the new claim arrives in a RE-ISSUED SESSION COOKIE, which a soft refresh does
      // not pick up. `/` is the page that reads the resolved state. This runs once, on a
      // path that was previously a dead end, so the reload costs nothing anyone was
      // going to keep.
      .then(() => {
        window.location.assign('/');
      })
      .catch((e: unknown) => {
        // Leave the page as it was. A failure here is a worse day than it already was,
        // not a reason to replace one confusing screen with a blank one.
        console.error("could not activate the user's only organization:", String(e));
      });
  }, [authLoaded, listLoaded, setActive, isSignedIn, orgId, userMemberships, router]);

  return null;
}
