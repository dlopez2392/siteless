'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS, isNavActive } from '@/components/app-shell/app-sidebar';
import { cn } from '@/lib/utils';

/**
 * The phone's whole navigation (UI-SPEC § App shell, Phone). Sticky to the bottom,
 * 64px plus the OS safe area, the `--sidebar` surface, a 1px top border, three equal
 * tabs.
 *
 * 🔴 NEVER ICON-ONLY. Each tab is a 24px glyph OVER a visible Label 14/400 text label.
 * The label is the fallback UI-SPEC § Accessibility requires of every navigational
 * control, and it is real text — there is no visually-hidden label anywhere in this file
 * standing in for one.
 *
 * 🔴 `env(safe-area-inset-bottom)` is ADDED to the 64px, never substituted for it
 * (UI-SPEC § Spacing exceptions). On an installed iOS PWA the home indicator sits in that
 * inset; without the padding the third tab's label is under it.
 *
 * The active tab carries accent on the icon, on the label, and as a 2px bar along the
 * tab's TOP edge — the phone mirror of the sidebar's left bar.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      data-testid="mobile-tab-bar"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 grid grid-cols-3',
        'border-t border-sidebar-border bg-sidebar',
        'pb-[env(safe-area-inset-bottom)] sm:hidden',
      )}
    >
      {NAV_ITEMS.map((item) => {
        const active = isNavActive(pathname, item.base);
        return (
          <Link
            key={item.testId}
            href={item.href}
            data-testid={item.testId}
            aria-current={active ? 'page' : undefined}
            className={cn(
              // 64px tall; the 44px floor is stated explicitly so a future height change
              // cannot drop it below MOB-01 without deleting the constraint on purpose.
              'relative flex h-16 min-h-11 min-w-11 flex-col items-center justify-center gap-1',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              active ? 'text-primary' : 'text-sidebar-foreground',
            )}
          >
            {active ? (
              <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
            ) : null}
            <item.Icon data-icon={item.iconName} aria-hidden="true" className="size-6 shrink-0" />
            <span className="text-sm font-normal leading-5">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
