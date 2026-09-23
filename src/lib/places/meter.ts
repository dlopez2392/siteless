import 'server-only';
import type { TextSearchSku } from '@/lib/budget/price-book';

/**
 * D-15 / criterion 5. The ONLY minter of ReservedCall. Reserve → call → settle; the reservation
 * and the request ceiling are one transaction.
 */

/** `PLACES_MODE` (src/env.ts, D-02). Passed in by the caller; this module never reads env. */
export type PlacesMode = 'off' | 'ids_only' | 'enterprise';

export type ModeRefusal = 'places_off' | 'mode_forbids_sku' | 'places_key_missing';

/**
 * The mode gate (D-02, M28, M29). Pure, and the FIRST thing `reservePage` does — before any SQL,
 * so a refusal leaves no reservation behind.
 *
 * Order matters: `off` wins over everything (it is the answer an operator set on purpose), then
 * the SKU the mode permits, then the key. `ids_only` permits only the free IDs-only mask;
 * `enterprise` permits exactly the two masks the adapter builds (ts_essentials, ts_enterprise) —
 * a Pro or Atmosphere request is one the estimate never priced. An unknown mode (a value that
 * slipped past env parsing) refuses as `off` rather than defaulting open.
 */
export function modeAllows(
  mode: PlacesMode,
  sku: TextSearchSku,
  keyConfigured: boolean,
): true | ModeRefusal {
  if (mode !== 'ids_only' && mode !== 'enterprise') return 'places_off';
  if (mode === 'ids_only' && sku !== 'ts_essentials') return 'mode_forbids_sku';
  if (mode === 'enterprise' && sku !== 'ts_essentials' && sku !== 'ts_enterprise') {
    return 'mode_forbids_sku';
  }
  if (!keyConfigured) return 'places_key_missing';
  return true;
}
