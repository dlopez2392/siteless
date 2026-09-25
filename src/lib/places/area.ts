/**
 * B-CR-01. Is a Places `formattedAddress` outside the United States?
 *
 * 🔴 THE TEST IS POSITIVE. request.ts sends `regionCode: 'US'` on every request, and Google
 * documents what that does to the address: "If the country name of the formattedAddress field in
 * the response matches the regionCode, the country code is omitted from formattedAddress." A real
 * McAllen result arrives as `"1200 N 10th St, McAllen, TX 78501"` — no `, USA`. So the ABSENCE of
 * a US suffix is the normal domestic shape and proves nothing; only the PRESENCE of a foreign
 * country tail makes a listing out of area (Google renders the country for a region that does not
 * match, in the request's `languageCode: 'en'` — "Mexico" — though a Spanish "México" is accepted
 * too).
 *
 * The list is the countries a Rio Grande Valley rectangle can plausibly reach, plus Canada. An
 * unlisted foreign country would read as domestic, which is the safe direction here: an
 * in-area listing still has to clear the candidate query (phone, trigram name + ZIP, or
 * 150 m) and the scorer against a TEXAS spine before anything attaches.
 *
 * Pure: no I/O, no `server-only` — the recorder's anonymizer (scripts/lib/anonymize-places.ts)
 * uses the same rule, so a recording can never turn a US place into a synthetic foreign one.
 */

const FOREIGN_COUNTRY = new Set(
  [
    'mexico',
    'méxico',
    'canada',
    'guatemala',
    'belize',
    'honduras',
    'el salvador',
    'nicaragua',
    'costa rica',
    'panama',
    'panamá',
    'cuba',
  ].map((c) => c.normalize('NFC')),
);

/** The last comma-separated segment, trimmed; `undefined` for an empty address. */
function tailOf(formatted: string): string | undefined {
  const trimmed = formatted.trim();
  if (trimmed === '') return undefined;
  return trimmed.split(',').at(-1)?.trim();
}

/** True only when the address ends in a foreign country's name. No address → false (absence is
 *  not evidence). */
export function isOutOfAreaAddress(formatted: string | undefined): boolean {
  if (formatted === undefined) return false;
  const tail = tailOf(formatted);
  if (tail === undefined || tail === '') return false;
  return FOREIGN_COUNTRY.has(tail.normalize('NFC').toLowerCase());
}
