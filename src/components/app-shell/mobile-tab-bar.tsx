'use client';

import { Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { LEADS_NAV, OPERATIONS_NAV, isNavActive } from '@/components/app-shell/app-sidebar';
import { MoreSheet } from '@/components/app-shell/more-sheet';
import { NAV } from '@/lib/ui/copy';
import { cn } from '@/lib/utils';

/**
 * The phone's whole navigation (03-UI-SPEC § 0, extending 02-UI-SPEC § App shell, Phone).
 * Sticky to the bottom, 64px plus the OS safe area, the `--sidebar` surface, a 1px top
 * border, FOUR equal tabs: the three `LEADS_NAV` destinations and `More`.
 *
 * Why four and not six: at 390px six tabs are 65px wide and "Businesses" at Label 14/400
 * is ~72px — the labels would truncate or vanish. Four is the largest set that keeps every
 * label real text (97.5px per tab). The Operations destinations live in the More sheet.
 *
 * 🔴 NEVER ICON-ONLY. Each tab is a 24px glyph OVER a visible Label 14/400 text label —
 * the More tab included. The label is the fallback UI-SPEC § Accessibility requires of
 * every navigational control, and it is real text — there is no visually-hidden label
 * anywhere in this file standing in for one.
 *
 * 🔴 `env(safe-area-inset-bottom)` is ADDED to the 64px, never substituted for it
 * (UI-SPEC § Spacing exceptions). On an installed iOS PWA the home indicator sits in that
 * inset; without the padding the tab labels are under it.
 *
 * The active tab carries accent on the icon, on the label, and as a 2px bar along the
 * tab's TOP edge — the phone mirror of the sidebar's left bar.
 *
 * 🔴 WHEN AN OPERATIONS ROUTE IS ACTIVE, THE MORE TAB ITSELF IS LIT. Sources, Spend and
 * Settings have no tab of their own on a phone, so without this the user would stand on a
 * screen with no lit tab at all and no way to tell where they are.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const operationsActive = OPERATIONS_NAV.some((i) => isNavActive(pathname, i.base));

  return (
    <>
      <nav
        aria-label="Primary"
        data-testid="mobile-tab-bar"
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 grid grid-cols-4',
          'border-t border-sidebar-border bg-sidebar',
          'pb-[env(safe-area-inset-bottom)] sm:hidden',
        )}
      >
        {LEADS_NAV.map((item) => {
          const active = isNavActive(pathname, item.base);
          return (
            <Link
              key={item.testId}
              href={item.href}
              data-testid={item.testId}
              aria-current={active ? 'page' : undefined}
              className={tabClassName(active)}
            >
              <ActiveBar active={active} />
              <item.Icon data-icon={item.iconName} aria-hidden="true" className="size-6 shrink-0" />
              <span className="max-w-full truncate text-sm leading-5 font-normal">
                {item.label}
              </span>
            </Link>
          );
        })}

        {/*
         * A BUTTON, not a link: it opens a surface rather than going anywhere. It is not a
         * `SheetTrigger` because the sheet's open state lives here, beside the lit-state
         * rule above. `data-active` mirrors the accent state so a probe can assert it
         * without reading a colour.
         */}
        <button
          type="button"
          data-testid="nav-more"
          data-active={operationsActive ? 'true' : 'false'}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          className={tabClassName(operationsActive)}
        >
          <ActiveBar active={operationsActive} />
          <Ellipsis data-icon="ellipsis" aria-hidden="true" className="size-6 shrink-0" />
          <span className="max-w-full truncate text-sm leading-5 font-normal">{NAV.more}</span>
        </button>
      </nav>

      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </>
  );
}

/**
 * 64px tall; the 44px floor is stated explicitly so a future height change cannot drop it
 * below MOB-01 without deleting the constraint on purpose. Shared by the three links and
 * the More button so the four cells cannot drift apart.
 */
function tabClassName(active: boolean) {
  return cn(
    'relative flex h-16 min-h-11 min-w-11 flex-col items-center justify-center gap-1',
    'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
    active ? 'text-primary' : 'text-sidebar-foreground',
  );
}

function ActiveBar({ active }: { active: boolean }) {
  return active ? (
    <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
  ) : null;
}
