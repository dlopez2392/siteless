/**
 * D-11 / PLACE-06. Google's text attribution, exactly "Google Maps" (policy page, 2026-09-23).
 *
 * Text, never a badge (Executor Rule 22). One implementation (Executor Rule 29): every
 * container that renders a Places-derived value renders this component, never a hand-written
 * copy. The date beside it is a SIBLING muted span rendered by the caller, so this colour and
 * font never extend to it.
 *
 * No client directive — server-safe, importable from RSC and client islands alike.
 * `translate="no"` stops browser translation rewriting a mark Google requires verbatim.
 * Colour and font come from `.google-maps-attribution` in globals.css (painted literals).
 */
export function GoogleMapsTag() {
  return (
    <span translate="no" className="google-maps-attribution" data-testid="google-maps-attribution">
      {/* 04-07 moves this literal into copy.ts as GOOGLE_MAPS_TAG */}
      {'Google Maps'}
    </span>
  );
}
