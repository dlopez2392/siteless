'use client';

import {
  Building2,
  CircleDollarSign,
  Database,
  GitCompare,
  ListChecks,
  Settings,
  Store,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { UserMenu } from '@/components/app-shell/user-menu';
import { Separator } from '@/components/ui/separator';
import { NAV, NAV_GROUP } from '@/lib/ui/copy';
import { cn } from '@/lib/utils';

/**
 * The desk chrome, and the single definition of what the six destinations ARE.
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
 * 03-UI-SPEC § 0: six destinations, ONE partition used at both breakpoints.
 *
 * **Leads** — the daily work — are the desk sidebar's first group AND the phone's three
 * bottom tabs. **Operations** — the desk work — are the sidebar's second group AND the
 * three rows inside the phone's More sheet. Both groups are defined here, once, and every
 * nav surface (sidebar, tablet off-canvas, tab bar, More sheet) maps over them, so no two
 * surfaces can drift into showing different destinations or different testids.
 *
 * 🔴 The `Building2` glyph is the ORG mark in the sidebar header and is deliberately NOT reused
 * for Businesses — two meanings on one glyph in one sidebar is a defect. Businesses is
 * `store`, Review is `git-compare` (literally the side-by-side decision), Sources is
 * `database` (03-UI-SPEC Open Question 4).
 */
export const LEADS_NAV: readonly NavItem[] = [
  {
    href: '/presets',
    base: '/presets',
    label: NAV.presets,
    Icon: ListChecks,
    iconName: 'list-checks',
    testId: 'nav-presets',
  },
  {
    href: '/review',
    base: '/review',
    label: NAV.review,
    Icon: GitCompare,
    iconName: 'git-compare',
    testId: 'nav-review',
  },
  {
    href: '/businesses',
    base: '/businesses',
    label: NAV.businesses,
    Icon: Store,
    iconName: 'store',
    testId: 'nav-businesses',
  },
];

/**
 * Settings points at `/settings/budget`, which plan 02-13 builds. The row is active for
 * the whole `/settings` subtree, so `/settings/organization` lights it too.
 */
export const OPERATIONS_NAV: readonly NavItem[] = [
  {
    href: '/sources',
    base: '/sources',
    label: NAV.sources,
    Icon: Database,
    iconName: 'database',
    testId: 'nav-sources',
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

/** Every destination, Leads first. Kept for anything that enumerates the whole set. */
export const NAV_ITEMS: readonly NavItem[] = [...LEADS_NAV, ...OPERATIONS_NAV];

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
 * Two groups, in the order 03-UI-SPEC § 0 fixes: the "Leads" eyebrow, the `LEADS_NAV`
 * rows, a shared `Separator`, the "Operations" eyebrow, the `OPERATIONS_NAV` rows. The
 * eyebrows are Label 14/600 muted TEXT — group labels, not links, not tab stops.
 *
 * Every row's `data-testid` comes from its `NavItem.testId`, so each hook has one
 * definition rather than one per breakpoint. The hooks are a CONTRACT, not an
 * implementation detail: `tests/e2e/touch-targets.spec.ts` measures every one of them and
 * 03-UI-SPEC § Accessibility fixes their names, so a rename has to be a deliberate edit to
 * the two lists above rather than a quiet change to a string nobody reads.
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const leadsId = React.useId();
  const operationsId = React.useId();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 px-2">
      <div role="group" aria-labelledby={leadsId} className="flex flex-col gap-1">
        <NavGroupEyebrow id={leadsId} testId="nav-group-leads" label={NAV_GROUP.leads} />
        {LEADS_NAV.map((item) => (
          <SidebarNavRow
            key={item.testId}
            item={item}
            active={isNavActive(pathname, item.base)}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      <Separator className="my-2" />

      <div role="group" aria-labelledby={operationsId} className="flex flex-col gap-1">
        <NavGroupEyebrow
          id={operationsId}
          testId="nav-group-operations"
          label={NAV_GROUP.operations}
        />
        {OPERATIONS_NAV.map((item) => (
          <SidebarNavRow
            key={item.testId}
            item={item}
            active={isNavActive(pathname, item.base)}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </nav>
  );
}

/** Label 14/600 in `--muted-foreground`, aligned with the rows' 16px text inset. */
function NavGroupEyebrow({ id, testId, label }: { id: string; testId: string; label: string }) {
  return (
    <span
      id={id}
      data-testid={testId}
      className="px-4 pt-2 pb-1 text-sm leading-5 font-semibold text-muted-foreground"
    >
      {label}
    </span>
  );
}

/**
 * One nav row. Geometry is 02-UI-SPEC § App shell's and must not drift: 44px tall, 8px
 * radius, 16px horizontal padding, 20px icon, 8px gap, Body 16/400. The active row carries
 * accent on the label and icon plus a 2px bar on its left edge.
 *
 * Exported because the phone More sheet renders the Operations rows with the same row
 * treatment — the accent rule is one rule, not one per surface.
 */
export function SidebarNavRow({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      data-testid={item.testId}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(
        'relative flex h-11 items-center gap-2 rounded-lg px-4 text-base font-normal',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active
          ? 'bg-muted text-primary'
          : 'text-sidebar-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      {active ? (
        <span aria-hidden="true" className="absolute inset-y-1 left-0 w-0.5 bg-primary" />
      ) : null}
      <item.Icon
        data-icon={item.iconName}
        aria-hidden="true"
        className={cn('size-5 shrink-0', active ? 'text-primary' : undefined)}
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

/**
 * Desk only, 1024px and up. 256px fixed, the `--sidebar` surface, a 1px right border.
 *
 * `hidden lg:flex` rather than a conditional render: the phone tab bar carries the Leads
 * testids and the More sheet the Operations ones, and `display: none` (plus Radix mounting
 * sheet content only while open) is what keeps at most one of each VISIBLE at any
 * viewport. `tests/e2e/touch-targets.spec.ts` asserts that count is exactly 1 before it
 * measures anything, so the invariant is checked rather than assumed.
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
        <UserMenu variant="full" userName={userName} userEmail={userEmail} initials={initials} />
      </div>
    </aside>
  );
}
