'use server';

import { z } from 'zod';
import { requireOrg } from '@/lib/auth/require-org';
import { geocodeAddress as geocodeWithCensus } from '@/lib/geocode/census';
import { GEOCODE_NO_MATCH, GEOCODE_NOT_TEXAS, GEOCODE_UNREACHABLE } from '@/lib/ui/copy';
import type { GeocodeHit } from '@/server/queries/presets';
import { fail, ok, type ActionResult } from './_result';

/**
 * SRCH-01 / D-02. An address becomes a radius centre.
 *
 * 🔴 GEOCODING IS FREE. The US Census Geocoder takes no key and costs nothing, so this path
 * never reserves budget, never writes a ledger row and never touches the meter. A future
 * reader seeing "an external call" inside a server action will reach for `app.reserve_budget`
 * — do not. The one module in Phase 2 that can cause spend is `./queue-run.ts`.
 *
 * 🔴 IT ALSO NEVER THROWS. `src/lib/geocode/census.ts` returns one of four named reasons for
 * every outcome, including an HTTP 200 carrying an empty match list, which is how that
 * service reports "not found". Each reason maps below onto a result the UI already has copy
 * for; nothing here can become a 500 the screen has no sentence for.
 */
/** C0 and C1 control characters, by code point: U+0000–U+001F and U+007F–U+009F. */
function isControl(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return c < 0x20 || (c >= 0x7f && c <= 0x9f);
}

const addressSchema = z
  .string()
  .trim()
  .min(3)
  .max(200)
  // T-2-13, the outer bound. `census.ts` bounds this again for its own reasons — it is a
  // library and must not trust its caller — and the two are deliberately not one check.
  // Control characters are the only class that can corrupt an HTTP request (CRLF splitting);
  // everything else is made harmless by POSITION, as the value of a query parameter on a
  // constant host and a constant path.
  //
  // 🔴 THE CLASS IS A CODE-POINT COMPARISON, NOT A CHARACTER CLASS IN A REGEX LITERAL, and
  // that is a deliberate choice about BYTES rather than about matching. Plan 02-07 shipped
  // a module holding two raw U+0000 bytes: git classified the whole file as binary,
  // `git diff` printed `Bin 0 -> 10333 bytes`, and every gate stayed green because the
  // character was right and only the encoding was not. A source file nobody can diff is a
  // source file nobody reviews. A numeric bound cannot regress that way; a hand-typed
  // character class can, and did, twice in one afternoon.
  .refine((s) => ![...s].some(isControl), {
    message: 'address contains a control character',
  });

export async function geocodeAddress(address: string): Promise<ActionResult<GeocodeHit>> {
  // 🔴 T-2-01. First statement, same reason as every other action in this directory: a
  // Server Function is a POST to the page's route and `src/proxy.ts` carries no
  // authorization by design (CVE-2025-29927).
  await requireOrg();

  const parsed = addressSchema.safeParse(address);
  if (!parsed.success) {
    // An unusable address IS, to the person who typed it, an address we could not find, and
    // UI-SPEC's no-match copy ("Try a street address with a city and ZIP") is exactly the
    // right instruction for it. `census.ts` makes the same call for the same reason.
    return fail('validation', GEOCODE_NO_MATCH(typeof address === 'string' ? address : ''));
  }

  const result = await geocodeWithCensus(parsed.data);
  if (result.ok) {
    // 🔴 The five fields are named one by one rather than spread, because this list IS the
    // retention decision: `census.ts` § header — persist only these, never the raw payload,
    // which carries TIGER line ids and address components that are not ours to keep and
    // that nothing downstream reads. A spread would silently widen it the day the upstream
    // shape grows.
    return ok({
      lat: result.lat,
      lng: result.lng,
      countyFips: result.countyFips,
      countyName: result.countyName,
      matchedAddress: result.matchedAddress,
    });
  }

  switch (result.reason) {
    case 'no_match':
      // 🔴 The address the USER typed, not a matched one — there is no match to quote back.
      // Everywhere else in this flow the address shown is `matchedAddress`, because a bad
      // ZIP is silently corrected upstream. This is the single exception.
      return fail('validation', GEOCODE_NO_MATCH(parsed.data));
    case 'not_texas':
      // The geocoder resolved it and then refused it, so the only address available to quote
      // back is still the typed one — `census.ts` returns a reason and nothing else on a
      // failure, deliberately, so a rejected match's details are never ours to keep.
      return fail('validation', GEOCODE_NOT_TEXAS(parsed.data));
    case 'unreachable':
    case 'bad_shape':
      // A free federal service that did not answer, or answered in a shape it has never sent
      // before. Both read to a user as "the service didn't answer", and both cost nothing.
      return fail('upstream', GEOCODE_UNREACHABLE);
  }
}
