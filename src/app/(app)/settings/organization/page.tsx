import { auth, currentUser } from '@clerk/nextjs/server';
import { SettingsNav } from '@/components/app-shell/settings-nav';
import { ThemeSwitch } from '@/components/app-shell/theme-switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from '@/components/ui/item';
import { ensureOrgRow, orgClaims, requireOrg } from '@/lib/auth/require-org';
import { APP_TZ } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * UI-SPEC § Screen Inventory 6. A definition list of who you are and which tenant this
 * request resolved to.
 *
 * 🔴 EXECUTOR RULE 7 — THIS SCREEN CARRIES PHASE 1'S e2e HOOKS. `signed-in-as`, `org-id`
 * and `org-row-id` moved here VERBATIM from `src/app/page.tsx`, and
 * `tests/e2e/signed-in.spec.ts` moved with them in the same commit. A retired testid
 * fails SILENTLY — the spec keeps passing against nothing at all — so the hook and the
 * assertion travel together or neither moves.
 *
 * 🔴 T-2-10: every identifier below comes from Clerk's server-verified `auth()` or from
 * `app.ensure_org`, which re-checks its argument against the caller's own claim. None of
 * it is read from a header, a query parameter or a cookie the client can write.
 */
export default async function OrganizationSettingsPage() {
  const { userId, orgId, orgSlug } = await requireOrg();
  const claims = await orgClaims();
  // Idempotent and cheap: migration 0009 made ensure_org select-then-do-nothing, so the
  // common path takes no row lock and fires no audit trigger.
  const orgRowId = await ensureOrgRow(claims, orgSlug ?? orgId);

  const { orgRole } = await auth();
  const user = await currentUser();
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? '';
  const orgLabel = orgSlug ?? orgId;

  // Clerk spells the admin role `org:admin` in a session claim. The label is for reading,
  // never for deciding anything — every authorization check in this product happens in
  // SQL, against `app.current_org_role()`.
  const roleLabel = orgRole === 'org:admin' ? 'Admin' : orgRole ? 'Member' : 'Unknown';

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold leading-tight">Settings</h1>

      <SettingsNav />

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Organization</CardTitle>
        </CardHeader>
        <CardContent>
          <ItemGroup>
            <Item>
              <ItemContent>
                <ItemTitle className="text-sm font-semibold">Organization</ItemTitle>
              </ItemContent>
              <ItemActions className="min-w-0">
                <span className="truncate text-base font-normal">{orgLabel}</span>
              </ItemActions>
            </Item>
            <ItemSeparator />

            <Item>
              <ItemContent>
                <ItemTitle className="text-sm font-semibold">Clerk organization ID</ItemTitle>
              </ItemContent>
              <ItemActions className="min-w-0">
                <span data-testid="org-id" className="break-all text-right text-sm font-normal">
                  {orgId}
                </span>
              </ItemActions>
            </Item>
            <ItemSeparator />

            <Item>
              <ItemContent>
                <ItemTitle className="text-sm font-semibold">Tenant ID</ItemTitle>
              </ItemContent>
              <ItemActions className="min-w-0">
                <span
                  data-testid="org-row-id"
                  className="break-all text-right text-sm font-normal tabular-nums"
                >
                  {orgRowId}
                </span>
              </ItemActions>
            </Item>
            <ItemSeparator />

            <Item>
              <ItemContent>
                <ItemTitle className="text-sm font-semibold">Signed in as</ItemTitle>
              </ItemContent>
              <ItemActions className="min-w-0">
                <span
                  data-testid="signed-in-as"
                  className="break-all text-right text-sm font-normal"
                >
                  {userId}
                </span>
              </ItemActions>
            </Item>
            <ItemSeparator />

            <Item>
              <ItemContent>
                <ItemTitle className="text-sm font-semibold">Your role</ItemTitle>
              </ItemContent>
              <ItemActions className="min-w-0">
                <span className="text-base font-normal">{roleLabel}</span>
              </ItemActions>
            </Item>
            <ItemSeparator />

            <Item>
              <ItemContent>
                <ItemTitle className="text-sm font-semibold">Time zone</ItemTitle>
              </ItemContent>
              <ItemActions className="min-w-0">
                {/* Resolved from src/lib/time.ts rather than typed here: it is the only
                    file in src/ that names a zone, and a second copy on the one screen
                    whose job is telling you which zone you are in would be the first
                    place they could disagree. */}
                <span className="text-base font-normal">{APP_TZ}</span>
              </ItemActions>
            </Item>
            <ItemSeparator />

            <Item className="flex-col items-start gap-2 sm:flex-row sm:items-center">
              <ItemContent>
                <ItemTitle className="text-sm font-semibold">Theme</ItemTitle>
              </ItemContent>
              <ItemActions className="w-full min-w-0 sm:w-64">
                {/* Its own testid prefix: the shell's switch in the user menu keeps the
                    canonical `theme-switch` / `theme-light` names, and on a phone both
                    instances can be on screen at once. */}
                <ThemeSwitch testIdPrefix="settings-theme" />
              </ItemActions>
            </Item>
          </ItemGroup>

          {userEmail ? (
            <p className="mt-4 text-sm font-normal text-muted-foreground">
              Signed in with {userEmail}.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
