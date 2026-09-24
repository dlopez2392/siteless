/**
 * The Places Text Search response, as zod schemas (T-4-10). Untrusted, versioned third-party
 * JSON: `safeParse` only, and zod's default strip drops every key not named here.
 *
 * Hand-authored from the documented shape (04-RESEARCH § Code Examples) until D-04's first
 * recording is anonymized into fixtures (04-19).
 *
 * 🔴 PITFALL 1(d). Nothing parsed here is ever interpolated into an error message or a log.
 * The client returns NAMED REASONS; `classifyGoogleError` returns a reason, never the message.
 * A thrown message carrying a business name would land in the workflow's step_failed event,
 * which is retained outside our database.
 *
 * D-21: `rating` and `userRatingCount` are parsed (they are in the mask) and are memory-only —
 * nothing in Phase 4 uses or persists them.
 *
 * `PlaceSchema` is a plain `z.object` (strip mode, NOT `.strict()` / `.passthrough()`): an
 * unknown key is dropped at parse, never kept and never an error.
 */
import { z } from 'zod';

const LatLng = z.object({ latitude: z.number(), longitude: z.number() });

export const PlaceSchema = z.object({
  id: z.string().min(1),
  displayName: z.object({ text: z.string(), languageCode: z.string().optional() }).optional(),
  // Absent on a pure service-area business (docs).
  formattedAddress: z.string().optional(),
  location: LatLng.optional(),
  // `types` and `businessStatus` are neither requested nor parsed (2026-09-23). Were Google to
  // send them anyway, zod's default strip drops them here — and with them the strict
  // businessStatus enum that made an unexpected BUSINESS_STATUS_UNSPECIFIED a `bad_shape`.
  pureServiceAreaBusiness: z.boolean().optional(),
  websiteUri: z.string().optional(),
  nationalPhoneNumber: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().int().optional(),
});

export type ParsedPlace = z.infer<typeof PlaceSchema>;

export const SearchTextResponse = z.object({
  // Zero results arrive as `{}` [ASSUMED; the replay fixture places-empty.json is `{}`].
  places: z.array(PlaceSchema).optional().default([]),
  nextPageToken: z.string().optional(),
});

export const GoogleErrorEnvelope = z.object({
  error: z.object({
    code: z.number(),
    message: z.string(),
    status: z.string(),
    details: z.array(z.unknown()).optional(),
  }),
});

/**
 * Only what the 429 split reads. Deliberately looser than `GoogleErrorEnvelope`: a 429 that
 * is missing `message` must still be scanned for quota metadata, not fall to "ambiguous".
 */
const QuotaErrorShape = z.object({
  error: z.object({ details: z.array(z.unknown()).optional() }),
});
const QuotaDetail = z.object({
  metadata: z
    .object({ quota_limit: z.string().optional(), quota_metric: z.string().optional() })
    .optional(),
});

export type GoogleErrorReason = 'daily_quota' | 'rate_limited' | 'rejected' | 'unavailable';

/**
 * A non-OK Places response → the reason the caller acts on.
 *
 * 429 (D-19, Pitfall 3): a DAILY quota ends the run `partial` / `google_daily_quota`; a
 * PER-MINUTE quota is retried with backoff. Told apart by the quota metadata on the error's
 * `details` (`quota_limit`, `quota_metric`). If both kinds appear, or neither, it is DAILY —
 * stopping is the safe direction, a retry loop against a spent daily quota is not.
 *
 * 400 → `rejected` (our request was wrong; retrying it cannot help). 401 / 403 / 404 →
 * `rejected` too (B-WR-06): a bad or restricted key, Places API (New) not enabled, or billing
 * disabled answers 403 PERMISSION_DENIED, and retrying it three times per run only hides the
 * cause behind `places_unavailable`. 5xx and anything else → `unavailable`.
 */
export function classifyGoogleError(status: number, json: unknown): GoogleErrorReason {
  if (status === 429) {
    const parsed = QuotaErrorShape.safeParse(json);
    const details = parsed.success ? (parsed.data.error.details ?? []) : [];
    let perMinute = false;
    for (const raw of details) {
      const detail = QuotaDetail.safeParse(raw);
      if (!detail.success || !detail.data.metadata) continue;
      const { quota_limit: limit, quota_metric: metric } = detail.data.metadata;
      for (const value of [limit, metric]) {
        if (value === undefined) continue;
        if (/PerDay/i.test(value)) return 'daily_quota';
        if (/PerMinute/i.test(value)) perMinute = true;
      }
    }
    return perMinute ? 'rate_limited' : 'daily_quota';
  }
  if (status === 400 || status === 401 || status === 403 || status === 404) return 'rejected';
  return 'unavailable';
}
