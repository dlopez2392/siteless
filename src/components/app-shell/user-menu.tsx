'use client';

import { useClerk } from '@clerk/nextjs';
import { ChevronUp } from 'lucide-react';
import Link from 'next/link';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeSwitch } from '@/components/app-shell/theme-switch';
import { cn } from '@/lib/utils';

/**
 * UI-SPEC § Copy Table → Shell: Theme (Light · Dark · System) · "Organization details" ·
 * "Sign out".
 *
 * Two shapes, one menu. `full` is the desk sidebar footer — avatar, name, chevron-up.
 * `compact` is the 44x44 avatar button in the phone and tablet top bar, which is
 * icon-only and therefore carries an `aria-label` (UI-SPEC § Accessibility → Names).
 *
 * Both shapes are rendered by the shell at once and CSS decides which is visible, so the
 * `user-menu` testid resolves to exactly one VISIBLE element at any viewport.
 */
export function UserMenu({
  variant,
  userName,
  userEmail,
  initials,
}: {
  variant: 'full' | 'compact';
  userName: string;
  userEmail: string;
  initials: string;
}) {
  const { signOut } = useClerk();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="user-menu"
        aria-label={variant === 'compact' ? `Account menu for ${userName}` : undefined}
        className={cn(
          'flex items-center gap-2 rounded-lg outline-none',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          variant === 'full'
            ? 'h-11 w-full px-2 text-left hover:bg-muted/60'
            : 'size-11 shrink-0 justify-center hover:bg-muted/60',
        )}
      >
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="text-sm">{initials}</AvatarFallback>
        </Avatar>
        {variant === 'full' ? (
          <>
            <span className="min-w-0 flex-1 truncate text-sm">{userName}</span>
            <ChevronUp data-icon="chevron-up" aria-hidden="true" className="size-4 shrink-0" />
          </>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{userName}</span>
          <span className="truncate text-sm font-normal text-muted-foreground">{userEmail}</span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-sm font-semibold">Theme</DropdownMenuLabel>
        {/* Not a DropdownMenuItem: the switch owns its own pressed state and must not
            close the menu when you change it. */}
        <div className="px-2 pb-2">
          <ThemeSwitch />
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild className="min-h-11">
          <Link href="/settings/organization" data-testid="user-menu-organization">
            Organization details
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="user-menu-sign-out"
          className="min-h-11"
          // Clerk's <SignOutButton> clones its child and attaches an onClick; nesting it
          // inside a menu item that also wants asChild is two Slots deep and drops one of
          // the handlers. Calling signOut directly is the same API with none of that.
          onSelect={() => void signOut({ redirectUrl: '/' })}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
