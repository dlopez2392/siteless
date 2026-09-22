'use client';

import { Building2, CircleDollarSign, ListChecks, Settings, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserMenu } from '@/components/app-shell/user-menu';
import { NAV } from '@/lib/ui/copy';
import { cn } from '@/lib/utils';

/**
 * The desk chrome, and the single definition of what the three destinations ARE.
 *
 * 🔴 WHY THIS IS NOT BUILT ON THE `sidebar` PRIMITIVE. `src/components/ui/sidebar.tsx`
 * decides desk-versus-mobile in JavaScript, through `useIsMobile()`, at a hardcoded
 * 768px — and below that breakpoint it swaps the whole sidebar for its own `Sheet`.
 * 02-UI-SPEC.md § App shell specifies THREE breakpoints at 640 and 1024, with no sidebar
 * at all on a phone and a bottom tab bar instead. Adopting the primitive would have
 * meant a nav tree at the wrong breakpoint plus a second, always-mounted copy of every
 * nav testid, and `useIsMobile` returns false on the server so the first paint would be
 * the desk layout on a phone every time. The chrome is therefore composed from CSS
 * breakpoints (Tailwind's `sm` and `lg` are exactly 640 and 1024) over the sidebar
 * SURFACE TOKENS the primitive would have used — `bg-sidebar`, `border-sidebar-border`,
 * `text-sidebar-foreground` — which is what UI-SPEC actually pins. Every real surface in
 * this shell (Sheet, DropdownMenu, Avatar, Alert, Card, Item) is still the shared
 * primitive, per Executor Rule 6.
 *
 * 🔴 NO SERVER DATA IS IMPORTED HERE. Everything this file needs about the org and the
 * user arrives as props from `src/app/(app)/layout.tsx`. A `"use client"` module's
 * exports are client REFERENCES inside a server component and resolve to `undefined`
 * with every gate green (Executor Rule 5, two recorded BIS 500s) — so the traffic only
 * ever goes server -> client, as props.
 */

export type NavItem = {
  href: string;
  /** The path prefix that makes this row the active one. */
  base: string;
  label: string;
  Icon: LucideIcon;
  /**
   * The lucide icon id from UI-SPEC § App shell, rendered as `data-icon` on the glyph.
   * It is an attribute rather than a comment so a probe can assert the icon that
   * actually shipped without reaching into the SVG's path data.
   */
  iconName: string;
  testId: string;
};

/**
 * UI-SPEC § App shell: Presets (`list-checks`) · Spend (`circle-dollar-sign`) ·
 * Settings (`settings`). Defined once and consumed by both the desk sidebar and the
 * phone tab bar, so the two can never drift into showing different destinations.
 *
 * Settings points at `/settings/budget`, which plan 02-13 builds. The row is active for
 * the whole `/settings` subtree, so `/settings/organization` lights it too.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: '/presets',
    base: '/presets',
    label: NAV.presets,
    Icon: ListChecks,
    iconName: 'list-checks',
    testId: 'nav-presets',
  },
  {
    href: '/spend',
    base: '/spend',
    label: NAV.spend,
    Icon: CircleDollarSign,
    iconName: 'circle-dollar-sign',
    testId: 'nav-spend',
  },
  {
    href: '/settings/budget',
    base: '/settings',
    label: NAV.settings,
    Icon: Settings,
    iconName: 'settings',
    testId: 'nav-settings',
  },
];

/** `/presets` and `/presets/abc` both light Presets; `/presetsomething` does not. */
export function isNavActive(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + '/');
}

export type ShellIdentity = {
  /** The org's human handle. Clerk's slug when it has one, its id when it does not. */
  orgLabel: string;
  userName: string;
  userEmail: string;
  initials: string;
};

/**
 * The nav list itself, shared by the desk sidebar and the tablet off-canvas `Sheet`.
 *
 * Exactly one row carries accent — label, icon and a 2px left bar — which is the only
 * accent anywhere in the chrome besides the focus ring (Executor Rule 10, and § Color's
 * exhaustive accent list, item 2).
 *
 * The rows below render, in order, `data-testid="nav-presets"`, `data-testid="nav-spend"`
 * and `data-testid="nav-settings"` — from `NAV_ITEMS[n].testId`, so the three hooks have
 * one definition rather than one per breakpoint. They are spelled out here because they
 * are a CONTRACT, not an implementation detail: `tests/e2e/touch-targets.spec.ts`
 * measures all three and UI-SPEC § Accessibility fixes their names, so a rename has to be
 * a deliberate edit to a documented list instead of a quiet change to a string literal
 * that no longer appears anywhere a reader would look.
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 px-2">
      {NAV_ITEMS.map((item) => {
        const active = isNavActive(pathname, item.base);
        return (
          <Link
            key={item.testId}
            href={item.href}
            data-testid={item.testId}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
            className={cn(
              // 44px tall, 8px radius, 16px horizontal padding, 20px icon, 8px gap,
              // Body 16/400 — UI-SPEC § App shell, desk.
              'relative flex h-11 items-center gap-2 rounded-lg px-4 text-base font-normal',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              active
                ? 'bg-muted text-primary'
                : 'text-sidebar-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {active ? (
              <span
                aria-hidden="true"
                className="absolute inset-y-1 left-0 w-0.5 bg-primary"
              />
            ) : null}
            <item.Icon
              data-icon={item.iconName}
              aria-hidden="true"
              className={cn('size-5 shrink-0', active ? 'text-primary' : undefined)}
            />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Desk only, 1024px and up. 256px fixed, the `--sidebar` surface, a 1px right border.
 *
 * `hidden lg:flex` rather than a conditional render: the phone tab bar carries the same
 * three testids, and `display: none` is what keeps exactly one of them VISIBLE at any
 * viewport. `tests/e2e/touch-targets.spec.ts` asserts that count is 1 before it measures
 * anything, so the invariant is checked rather than assumed.
 */
export function AppSidebar({ orgLabel, userName, userEmail, initials }: ShellIdentity) {
  return (
    <aside
      data-testid="app-sidebar"
      className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex"
    >
      <div className="flex flex-col gap-1 px-4 py-6">
        <div className="flex items-center gap-2">
          <Building2 data-icon="building-2" aria-hidden="true" className="size-5 shrink-0" />
          {/* Heading 20/600, truncated to one line. */}
          <span className="truncate text-xl font-semibold leading-tight">{orgLabel}</span>
        </div>
        {/* Label 14/400 muted. */}
        <span className="truncate text-sm font-normal text-muted-foreground">{userEmail}</span>
      </div>

      <SidebarNav />

      <div className="mt-auto p-2">
        <UserMenu
          variant="full"
          userName={userName}
          userEmail={userEmail}
          initials={initials}
        />
      </div>
    </aside>
  );
}
