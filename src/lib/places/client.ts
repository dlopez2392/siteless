import 'server-only';

/**
 * D-03 — the ONE sanctioned reader of the Places key and the only module that names the host,
 * the API-key header and the field-mask header. Server-only; the key is API-restricted to
 * Places API (New) and never NEXT_PUBLIC_ (Vercel functions have no fixed egress IP, so no
 * application restriction).
 *
 * Criterion 1: `searchText` is the only call this module exports, and the Text Search verb is
 * the only resource path it spells — Place Details has no code path to reach it. The mask is
 * whatever the one builder (src/lib/places/request.ts) put on the request, priced by
 * `fieldMaskTier`; this module never composes a mask of its own.
 *
 * Criterion 5 by type: the first parameter is a `ReservedCall`, which only the meter can mint
 * (src/lib/places/reserved-call.ts). The token is otherwise read for one sanity check — a
 * reservation made at one SKU must not carry a request priced at another.
 *
 * 🔴 NEVER A THROWN ERROR, NEVER RESPONSE TEXT (Pitfall 1d, T-4-05). Every outcome is a named
 * reason plus a status code. Nothing from a response body — not the error message, not a zod
 * issue — reaches the outcome, a log or an error message: a Google business name in a thrown
 * message would land in the workflow's step_failed event, which lives outside our database.
 *
 * 🔴 `timeout` IS AN UNKNOWN OUTCOME (Pitfall 9). The transport failed after the request may
 * have reached Google, so the caller settles it as CHARGED. Every non-OK HTTP status is a
 * known outcome (Google does not bill error responses [ASSUMED — confirm on the first
 * invoice]) and is released.
 *
 * Analog: src/lib/geocode/census.ts — hard-coded origin and path, a bounded fetch, zod
 * `safeParse`, named reasons.
 */
import { classifyGoogleError, SearchTextResponse, type ParsedPlace } from '@/lib/places/response';
import type { PlacesRequest } from '@/lib/places/request';
import type { ReservedCall } from '@/lib/places/reserved-call';

/** Hard-coded. No caller-supplied value ever reaches the host or the path. */
const PLACES_ORIGIN = 'https://places.googleapis.com';
const SEARCH_TEXT_PATH = '/v1/places:searchText';

/** Bounded: an unbounded fetch inside a workflow step is a step that never settles its hold. */
const PLACES_TIMEOUT_MS = 10_000;

/** A per-minute 429 without a usable Retry-After waits one minute (the quota's own window). */
const DEFAULT_RETRY_AFTER_MS = 60_000;

/** Read per call, never cached: a key rotated or removed takes effect on the next request.
 *  An empty string is no key (an unset CI secret arrives as ''). */
function readKey(): string | undefined {
  return process.env.GOOGLE_PLACES_API_KEY || undefined;
}

/** True when a Places key is present. Says nothing about whether Google accepts it. */
export function placesKeyConfigured(): boolean {
  return readKey() !== undefined;
}

export type SearchTextFailure =
  'daily_quota' | 'rate_limited' | 'rejected' | 'unavailable' | 'timeout' | 'bad_shape' | 'no_key';

export type SearchTextOutcome =
  | { ok: true; places: ParsedPlace[]; nextPageToken: string | null }
  | { ok: false; reason: SearchTextFailure; status: number | null; retryAfterMs?: number };

/** `Retry-After` in delta-seconds → ms. An HTTP-date or anything unreadable → the default. */
function retryAfterMsOf(header: string | null): number {
  if (header === null || !/^\s*\d+(\.\d+)?\s*$/.test(header)) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(header);
  return seconds > 0 ? Math.ceil(seconds * 1000) : DEFAULT_RETRY_AFTER_MS;
}

/** One Text Search page. Never rejects: every outcome is a value. */
export async function searchText(
  call: ReservedCall,
  req: PlacesRequest,
): Promise<SearchTextOutcome> {
  // A reservation priced at one SKU carrying a request priced at another is a caller bug —
  // and a ledger that would disagree with the invoice. Refused before anything is sent.
  if (call.sku !== req.sku) return { ok: false, reason: 'rejected', status: null };

  const key = readKey();
  if (key === undefined) return { ok: false, reason: 'no_key', status: null };

  let response: Response;
  try {
    response = await fetch(`${PLACES_ORIGIN}${SEARCH_TEXT_PATH}`, {
      method: 'POST',
      signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': req.mask.join(','),
      },
      body: JSON.stringify(req.body),
    });
  } catch {
    // Timeout, reset, DNS: the request may or may not have reached Google.
    return { ok: false, reason: 'timeout', status: null };
  }

  if (!response.ok) {
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      // A non-JSON error body classifies on the status alone (a 429 becomes daily_quota).
    }
    const reason = classifyGoogleError(response.status, json);
    if (reason === 'rate_limited') {
      return {
        ok: false,
        reason,
        status: response.status,
        retryAfterMs: retryAfterMsOf(response.headers.get('retry-after')),
      };
    }
    return { ok: false, reason, status: response.status };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: 'bad_shape', status: response.status };
  }
  const parsed = SearchTextResponse.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: 'bad_shape', status: response.status };

  return { ok: true, places: parsed.data.places, nextPageToken: parsed.data.nextPageToken ?? null };
}
