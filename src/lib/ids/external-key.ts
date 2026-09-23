/**
 * D-19 / DEDUP-03: the external lead key — `SL-` plus six Crockford base32 characters, the
 * handle a person reads aloud on a phone call or types into a CSV filter.
 *
 * 🔴 DISPLAY-ONLY. Never a foreign key, never a route parameter, never a query key (UI-SPEC
 * Executor Rule 18). Every FK targets `businesses(id)`, the `/businesses/[id]` segment is the
 * uuid (see `src/lib/ids.ts`), and a key resolves to its business only through
 * `coalesce(merged_into_id, id)` in one org-scoped lookup. A key that became a join key would
 * turn a merge into a rewrite.
 *
 * 🔴 SIX CHARACTERS, NOT FIVE. D-19 permits 5–6. For n keys in N = 32^k slots the expected
 * number of colliding pairs is ≈ n² / 2N. At RGV scale (n = 92,000 pre-merge keys):
 *   - 5 chars: N = 33,554,432    → n²/2N ≈ 126  — collisions are a certainty
 *   - 6 chars: N = 1,073,741,824 → n²/2N ≈ 3.9  — about four over the whole RGV spine
 * The insert path retries on conflict against the `(org_id, external_key)` unique index, so
 * a handful of collisions costs a handful of retries. Five would cost a hundred-odd, and grow
 * quadratically from there.
 *
 * 🔴 `crypto.getRandomValues`, NEVER the non-cryptographic `Math` PRNG (ASVS V6): the key is
 * guessable in exact proportion to how predictable the draw is. (That PRNG's name is not
 * spelled in this file on purpose — the plan's acceptance grep refuses it anywhere here.)
 *
 * NO `"use client"` IN THIS FILE — same reason as `src/lib/ids.ts`: a client directive would
 * turn these exports into client references that arrive `undefined` in a server component.
 */

/** Crockford base32: 32 symbols, no I, L, O or U — the four that get misread aloud. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The shape the database CHECK also enforces. Kept here so the generator and the constraint
 *  cannot drift; `tests/db/external-key.test.ts` asserts the constraint separately. */
export const EXTERNAL_KEY_PATTERN = /^SL-[0-9A-HJKMNP-TV-Z]{6}$/;

export function newExternalKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  // `b % 32` over a uniform byte is EXACTLY uniform here because 256 = 8 × 32: every symbol
  // is hit by exactly eight byte values. A 36-symbol alphabet would NOT be (256 = 7 × 36 + 4,
  // so four symbols would be drawn 8/256 of the time and the rest 7/256) — which is one more
  // reason the alphabet is Crockford's 32 and not A–Z plus digits.
  return 'SL-' + Array.from(bytes, (b) => CROCKFORD[b % 32]).join('');
}
