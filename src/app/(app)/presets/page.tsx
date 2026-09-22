/**
 * 🔴 PLACEHOLDER — the real preset list is plan 02-11's (UI-SPEC § Screen Inventory 1).
 *
 * It exists in this plan because the shell is useless without it: `/` redirects here,
 * `nav-presets` points here, and `tests/e2e/budget-banner.spec.ts` asserts the banner
 * renders on this route. A nav bar whose every destination 404s cannot be verified at
 * all, which is why this is a page rather than a deferral.
 *
 * It renders the real page title from UI-SPEC's copy table and says plainly what is not
 * here yet. It does NOT stub the card list, the empty state or the "Create preset" CTA —
 * those are 02-11's contract and a fake one would be worse than none.
 */
export default function PresetsPage() {
  return (
    <>
      <h1 className="text-xl font-semibold leading-tight">Search presets</h1>
      <p className="mt-2 max-w-[60ch] text-sm text-muted-foreground">
        The preset list ships in plan 02-11. The shell, the navigation and the budget
        banner around it are live now.
      </p>
    </>
  );
}
