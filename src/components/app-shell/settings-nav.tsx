'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { tabsListVariants } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/**
 * The Settings sub-nav: Budget · Organization (UI-SPEC § Screen Inventory 4 and 6).
 *
 * 🔴 LINKS IN A `<nav>`, WEARING THE `Tabs` VARIANT — not a Radix `Tabs` root. UI-SPEC
 * calls this "Tabs on phone, a secondary nav list on desk", and these two entries are
 * ROUTES, not panels on one page. A Radix `Trigger` publishes `aria-controls` pointing at
 * a `TabsContent` that would never exist here, so a screen reader would be told to look
 * for a panel that is not in the document. Reusing `tabsListVariants` keeps the shared
 * visual contract (Executor Rule 6) while the semantics stay honest — the same treatment
 * at both breakpoints, full width on phone so each target clears 44px.
 *
 * `/settings/budget` is plan 02-13's screen and does not exist yet. The link is real
 * anyway: pointing the nav at a route that is about to land beats teaching people a
 * second place to find the cap.
 */

const SETTINGS_TABS = [
  { href: '/settings/budget', label: 'Budget', testId: 'settings-nav-budget' },
  { href: '/settings/organization', label: 'Organization', testId: 'settings-nav-organization' },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Settings"
      data-testid="settings-nav"
      className={cn(tabsListVariants({ variant: 'default' }), 'h-auto w-full p-1 sm:w-fit')}
    >
      {SETTINGS_TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + '/');
        return (
          <Link
            key={tab.testId}
            href={tab.href}
            data-testid={tab.testId}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-11 flex-1 items-center justify-center rounded-lg px-4 text-sm font-semibold whitespace-nowrap',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              active ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
