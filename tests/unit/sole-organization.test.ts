/**
 * D-02 and the Clerk active-organization trap, all five branches.
 *
 * Pure TypeScript with no Clerk import, so this runs in the unit suite with no mocking at
 * all — which is the whole reason the decision was extracted from the component in the
 * first place. Plan 08 mounts the client half.
 *
 * Mutations, each RUN and each observed to kill exactly one test, then reverted:
 *   - `if (!input.signedIn) return null;` deleted   → 'returns null when not signed in'
 *   - `if (input.activeOrgId) return null;` deleted → 'returns null when an organization
 *                                                     is already active'
 *   - `length !== 1` -> `length < 1`                → 'returns null with two memberships'
 *   - `return memberships[0]!.organizationId`
 *       -> `return null`                            → 'activates when there is exactly
 *                                                     one membership'
 *
 * Two mutations that do NOT behave as you would guess, which is why they were run rather
 * than reasoned about:
 *   - `length !== 1` -> `length === 0` kills 'returns null with two memberships', NOT the
 *     activation test: two memberships also fail `=== 0`, so the function falls through
 *     and returns the FIRST of them. Same red test as `< 1`, so it is not a fourth
 *     independent mutation — the happy-path one above is.
 *   - `memberships[0]` -> `memberships.at(-1)` survives all five, and that is correct:
 *     with exactly one membership they are the same element. Nothing here pins index 0,
 *     and nothing should — "the first of several" is a state the length guard forbids.
 */
import { describe, expect, it } from 'vitest';
import { soleOrganizationToActivate } from '@/lib/auth/sole-organization';

const base = {
  signedIn: true,
  activeOrgId: null as string | null | undefined,
  memberships: [] as { organizationId: string }[],
};

describe('sole organization', () => {
  /**
   * The case this exists for: an invited BIS staffer, signed in, belonging to the one
   * org danlo created, with no active organization — so no org claim, so NULL from
   * app.current_org_id(), so every policy false and an empty, error-free product.
   */
  it('sole organization: activates when there is exactly one membership', () => {
    expect(
      soleOrganizationToActivate({ ...base, memberships: [{ organizationId: 'org_siteless' }] }),
    ).toBe('org_siteless');

    // Clerk reports "not loaded / not set" as undefined rather than null, and a user
    // waiting on that must still be activated once it settles. Both spellings of "no
    // active organization" are the same answer, and an implementation that only checked
    // `=== null` would strand every user during that window.
    expect(
      soleOrganizationToActivate({
        ...base,
        activeOrgId: undefined,
        memberships: [{ organizationId: 'org_siteless' }],
      }),
    ).toBe('org_siteless');

    // An empty string is none, not set. A truthiness check gets this right and an
    // `!= null` check gets it wrong.
    expect(
      soleOrganizationToActivate({
        ...base,
        activeOrgId: '',
        memberships: [{ organizationId: 'org_siteless' }],
      }),
    ).toBe('org_siteless');
  });

  it('sole organization: returns null when not signed in', () => {
    // A signed-out visitor has memberships only in the sense that the component has
    // stale state. Activating anything here would be acting on a session that is gone.
    expect(
      soleOrganizationToActivate({
        ...base,
        signedIn: false,
        memberships: [{ organizationId: 'org_siteless' }],
      }),
    ).toBeNull();
  });

  it('sole organization: returns null when an organization is already active', () => {
    // Nothing to fix, and re-activating would fight whatever set it.
    expect(
      soleOrganizationToActivate({
        ...base,
        activeOrgId: 'org_already',
        memberships: [{ organizationId: 'org_siteless' }],
      }),
    ).toBeNull();
  });

  it('sole organization: returns null with zero memberships', () => {
    // Genuinely unlinked. D-02's no-access screen is the right answer; inventing an
    // organization for them would be the wrong one.
    expect(soleOrganizationToActivate({ ...base, memberships: [] })).toBeNull();
  });

  it('sole organization: returns null with two memberships', () => {
    // THE SAFETY PROPERTY that lets this be mounted app-wide. Ambiguity is never
    // resolved silently: if this picked the first of several, a multi-org user would be
    // dropped into whichever tenant happened to sort first, on any request whose session
    // had no active org — a tenant boundary crossed by a default, with no error anywhere.
    expect(
      soleOrganizationToActivate({
        ...base,
        memberships: [{ organizationId: 'org_a' }, { organizationId: 'org_b' }],
      }),
    ).toBeNull();
  });
});
