/**
 * Which organization to make active for a signed-in user who has none.
 *
 * Clerk keeps the active organization on the SESSION, not on the user. A member of an
 * organization whose session has no active one gets a token with no org claim at all —
 * neither v2's `o.id` nor v1's flat `org_id` — so `app.current_org_id()` returns NULL,
 * every RLS policy evaluates false, and the caller is indistinguishable from someone who
 * belongs to nothing. The product is then EMPTY AND ERROR-FREE, which is the worst
 * possible shape for a bug: nothing to grep for, nothing in the logs, a 200 on every
 * request. 01-RESEARCH.md Pitfall 2 calls the claim-path version of this the single
 * highest-probability silent failure in the whole build.
 *
 * PORTED FROM BIS, where it shipped on 2026-09-16. With
 * `force_organization_selection` off, nothing sets the active organization. Clerk's
 * <OrganizationSwitcher/> would, but BIS's topbar rendered that for the agency only, so
 * a client had no way to reach it at all: 956 Woodworks accepted a valid invitation,
 * signed in, and were told they had no company.
 *
 * It applies to Siteless unchanged. D-02 makes Siteless INVITE-ONLY — danlo creates the
 * org in the Clerk dashboard and invites BIS staff — so every single user arrives by the
 * exact path that produced the incident, and none of them can create an organization to
 * dig themselves out.
 *
 * THE META-LESSON, which is the part worth more than the function:
 *
 *   The e2e client fixture had always called `setActive` by hand to get past this
 *   (e2e/auth.setup.ts), with a comment explaining exactly why. The suite therefore
 *   passed while the product was broken — the workaround was in the test rather than
 *   in the app.
 *
 * That is why Siteless's e2e must never call `setActive` to make a test green.
 * tests/e2e/auth.setup.ts (plan 01-03) is deliberately written without one.
 *
 * Zero dependencies, and nothing pulled in from Clerk's SDK — which is why this is
 * unit-testable with no mocking at all. Plan 08 mounts the client component that feeds
 * it Clerk's values.
 *
 * Both of those are enforced by a bare token grep over this file, so this comment does
 * not spell either token: naming them here would trip the guards it is describing.
 */

/** One membership, reduced to the only field this decision needs. */
export interface Membership {
  organizationId: string;
}

/**
 * The organization to activate, or `null` to leave the session alone.
 *
 * Exactly one membership, and no active organization already. Each condition is doing
 * work:
 *
 *   - **Zero** memberships is a genuinely unlinked user. There is nothing to activate
 *     and D-02's no-access screen is the correct answer. Inventing an organization for
 *     them would be the wrong one.
 *   - **More than one** is ambiguous, and picking for someone is worse than asking. It
 *     is also what stops this being a tenant-spoofing hole: a user who belongs to two
 *     orgs can never be dropped into the wrong one by a function that guessed. Siteless
 *     has one org in v1, but the schema does not assume it (D-03) and neither does this.
 *   - **An active organization already** means there is nothing to fix, and
 *     re-activating it would fight whatever set it.
 */
export function soleOrganizationToActivate(input: {
  signedIn: boolean;
  activeOrgId: string | null | undefined;
  memberships: readonly Membership[];
}): string | null {
  if (!input.signedIn) return null;
  if (input.activeOrgId) return null;
  if (input.memberships.length !== 1) return null;
  return input.memberships[0]!.organizationId;
}
