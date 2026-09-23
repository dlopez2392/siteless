'use client';

import { usePathname } from 'next/navigation';
import { OPERATIONS_NAV, SidebarNavRow, isNavActive } from '@/components/app-shell/app-sidebar';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { MORE_SHEET_TITLE } from '@/lib/ui/copy';

/**
 * The phone's More sheet (03-UI-SPEC § 0): the three Operations destinations — Sources ·
 * Spend · Settings — behind the fourth bottom tab.
 *
 * Composed exactly like `top-bar.tsx`'s tablet off-canvas, from the SHARED shadcn `Sheet`
 * (Executor Rule 6 — no hand-rolled surface), only `side="bottom"` so the rows land in the
 * thumb zone the tab that opened them lives in.
 *
 * 🔴 THE ROWS KEEP THEIR ORIGINAL TESTIDS. They are the same `OPERATIONS_NAV` items the
 * desk sidebar renders, through the same `SidebarNavRow`, so the Spend and Settings hooks
 * that `tests/e2e/touch-targets.spec.ts` has always measured are still those hooks — they
 * moved surface, not name. Radix mounts sheet content only while it is open, so on a phone
 * each hook exists exactly once in the visible tree, and only after the sheet opens. That
 * is 03-UI-SPEC Executor Rule 21, and it is why the spec opens this sheet before measuring.
 *
 * The open state is OWNED by the tab bar (the More tab is a plain button there, not a
 * `SheetTrigger`), because the tab also has to show the accent state whenever an Operations
 * route is active — and that is the tab bar's concern, not the sheet's.
 *
 * Rows close the sheet on navigate, exactly as `SidebarNav`'s `onNavigate` does in the
 * tablet off-canvas; `env(safe-area-inset-bottom)` is ADDED below the last row so an
 * installed iOS PWA's home indicator never sits on top of Settings.
 */
export function MoreSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        data-testid="more-sheet"
        className="pb-[env(safe-area-inset-bottom)]"
      >
        <SheetHeader className="px-4 pt-4 pb-0">
          {/* Heading 20/600. */}
          <SheetTitle className="text-xl font-semibold">{MORE_SHEET_TITLE}</SheetTitle>
        </SheetHeader>
        <nav aria-label={MORE_SHEET_TITLE} className="flex flex-col gap-1 px-2 pb-4">
          {OPERATIONS_NAV.map((item) => (
            <SidebarNavRow
              key={item.testId}
              item={item}
              active={isNavActive(pathname, item.base, item.alsoActiveUnder)}
              onNavigate={() => onOpenChange(false)}
            />
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
