/**
 * Criterion 5 by TYPE: no Places call without a granted reservation.
 *
 * `searchText` (src/lib/places/client.ts) requires a `ReservedCall`, and a `ReservedCall`
 * cannot be written as an object literal — the `unique symbol` brand has no value anyone can
 * spell. The one way to obtain one is `mintReservedCall`, and the only module allowed to call
 * it is the meter (src/lib/places/meter.ts, plan 04-16), after the mode check and a granted
 * reservation. tests/unit/places-client.test.ts ('no module but the meter mints a reserved
 * call') holds every other file under src/ to that — a tool contract, not a prompt rule.
 *
 * Pure: no I/O. The token carries our own ids and the SKU it was reserved at, nothing else.
 */
import type { TextSearchSku } from '@/lib/budget/price-book';

declare const reservedBrand: unique symbol;

export type ReservedCall = {
  readonly [reservedBrand]: true;
  readonly reservationId: string;
  readonly requestId: string;
  readonly sku: TextSearchSku;
};

/** Minted ONLY by src/lib/places/meter.ts, after the mode check and a granted reservation (criterion 5). */
export function mintReservedCall(
  reservationId: string,
  requestId: string,
  sku: TextSearchSku,
): ReservedCall {
  return Object.freeze({ reservationId, requestId, sku }) as ReservedCall;
}
