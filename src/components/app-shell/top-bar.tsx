'use client';

import { Menu } from 'lucide-react';
import * as React from 'react';
import { SidebarNav, type ShellIdentity } from '@/components/app-shell/app-sidebar';
import { UserMenu } from '@/components/app-shell/user-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

/**
 * The sticky 64px top app bar, below 1024px (UI-SPEC § App shell, Tablet and Phone).
 *
 * Tablet (640–1023): a 44x44 `menu` button opens the sidebar as an off-canvas `Sheet`
 * from the left, with the org name beside it.
 * Phone (<640): no menu button at all — the bottom tab bar is the navigation — so the bar
 * is just the org name and the 44x44 user-menu avatar.
 *
 * The Sheet's nav is the SAME `SidebarNav` the desk sidebar renders. Radix mounts sheet
 * content only while it is open, so the duplicated nav testids exist for exactly as long
 * as the desk `<aside>` is `display: none` beside them.
 */
export function TopBar({ orgLabel, userName, userEmail, initials }: ShellIdentity) {
  const [navOpen, setNavOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-4 lg:hidden">
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        {/* Tablet only. The phone navigates from the bottom tab bar. */}
        <SheetTrigger
          data-testid="nav-menu"
          aria-label="Open navigation"
          className="hidden size-11 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:inline-flex lg:hidden"
        >
          <Menu data-icon="menu" aria-hidden="true" className="size-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetHeader className="px-4 py-6">
            <SheetTitle className="truncate text-xl font-semibold">{orgLabel}</SheetTitle>
          </SheetHeader>
          <SidebarNav onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Heading 20/600, truncated to one line. */}
      <span className="min-w-0 flex-1 truncate text-xl font-semibold leading-tight">
        {orgLabel}
      </span>

      <UserMenu variant="compact" userName={userName} userEmail={userEmail} initials={initials} />
    </header>
  );
}
