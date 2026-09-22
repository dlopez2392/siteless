/**
 * 🔴 PLACEHOLDER — the real spend view is plan 02-12's (UI-SPEC § Screen Inventory 5,
 * BUDG-04, D-14).
 *
 * Same reasoning as `/presets`: `nav-spend` points here and the 80% banner's primary
 * action — "See spend by provider" — links here, so the route has to resolve for either
 * to be verifiable. The month-to-date figure, the gauge and the By provider / By run tabs
 * are 02-12's and are deliberately not mocked: a $0.00 that is a placeholder rather than
 * a reading is the one number this product must never show.
 */
export default function SpendPage() {
  return (
    <>
      <h1 className="text-xl font-semibold leading-tight">Spend</h1>
      <p className="mt-2 max-w-[60ch] text-sm text-muted-foreground">
        The spend view ships in plan 02-12. Until then the budget meter is read by the
        banner in this shell, which is server-rendered from the same query.
      </p>
    </>
  );
}
