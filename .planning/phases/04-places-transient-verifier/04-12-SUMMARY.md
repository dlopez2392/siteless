---
phase: 04-places-transient-verifier
plan: 12
subsystem: places-adapter
tags: [places, field-mask, client, reserved-call, guards, place-01, place-05, budg-03]
requires:
  - "04-02: tests/unit/_walk.ts (shared walker), PLACES_MODE in src/env.ts (key NOT there)"
  - "04-04: isTableAType (src/lib/places/place-types.ts)"
  - "04-05: Rect (src/lib/places/tiling.ts)"
  - "04-10: msw Places harness (PLACES_ENDPOINT, PLACES_PAGES, setPlacesRoutes, placesRequests, resetPlaces)"
provides:
  - "src/lib/budget/field-mask-tier.ts: places.pureServiceAreaBusiness in PRO + the Enterprise mask; PLACES_IDS_ONLY_FIELD_MASK"
  - "src/lib/places/request.ts: buildFirstPage, buildNextPage, SearchTextBody, PlacesRequest, PlacesMaskMode"
  - "src/lib/places/response.ts: PlaceSchema, SearchTextResponse, GoogleErrorEnvelope, ParsedPlace, classifyGoogleError, GoogleErrorReason"
  - "src/lib/places/reserved-call.ts: ReservedCall (unique-symbol brand), mintReservedCall"
  - "src/lib/places/client.ts: searchText, placesKeyConfigured, SearchTextOutcome, SearchTextFailure"
affects: [04-16 meter, 04-18 sweep steps, 04-19 recorder, 04-22, 04-33 gate mutations]
tech-stack:
  added: []
  patterns:
    - "Invariant request fields as module constants; page N = frozen page-1 body + pageToken"
    - "Branded token type (unique symbol) as the tool contract for 'no call without a reservation'"
    - "Per-pattern allow-list in the credential guard, with a positive control that the allowance is exercised"
key-files:
  created:
    - src/lib/places/request.ts
    - src/lib/places/response.ts
    - src/lib/places/reserved-call.ts
    - src/lib/places/client.ts
    - tests/unit/places-request.test.ts
    - tests/unit/places-client.test.ts
  modified:
    - src/lib/budget/field-mask-tier.ts
    - tests/unit/field-mask-tier.test.ts
    - tests/unit/no-google-credential.test.ts
    - tests/unit/no-network.test.ts
decisions:
  - "The credential guard's allowance is per PATTERN (key var, key header, Places host) and only for client.ts; GOOGLE_API_KEY, NEXT_PUBLIC_GOOGLE and the Maps host stay forbidden even there"
  - "The builder refuses an inverted or non-finite rectangle (Google would read an inverted longitude range as an antimeridian crossing: a valid, billed, wrong search)"
  - "searchText refuses (rejected, status null, nothing sent) when the ReservedCall's sku differs from the request's sku"
  - "429 classification: PerDay anywhere wins over PerMinute; no quota metadata or non-JSON body means daily_quota"
  - "The field-mask header grep is now 'exactly one module' (client.ts), not 'at most one'"
metrics:
  duration: "~45 min"
  completed: 2026-09-23
  tasks: 3
  files: 10
---

# Phase 4 Plan 12: The Places adapter (builder, schema, client, reservation token) Summary

This plan adds the Places adapter. There is one request builder, and it always sets the service-area flag and the fixed parameters. There is a zod response schema. There is one sanctioned `searchText` client: it reads the key, needs a `ReservedCall` token that only the meter may mint, and returns a named reason for every outcome without ever throwing. The three repo guards were changed (not deleted) so that `src/lib/places/client.ts` is the one file allowed to name the key, the headers and the host. No real Google call was made; the msw harness answered every request.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 RED | 7e8a53c | test(04-12): add failing tests for the SAB mask field, ids-only mask and request builder |
| 1 GREEN | 3b048a5 | feat(04-12): SAB field in the Places mask, the ids-only mask, and the one request builder |
| 2 RED | f30cfc6 | test(04-12): add failing tests for the one sanctioned Places client |
| 2 GREEN | 846ff92 | feat(04-12): Places response schema, ReservedCall brand, and the one sanctioned client |
| 3 | fe81164 | test(04-12): move the three repo guards onto src/lib/places/client.ts (amended, never deleted) |
| style | e67544b | style(04-12): prettier on the Places client and the credential guard |

## Exported API (later plans call this)

```ts
// src/lib/budget/field-mask-tier.ts (additions)
export const PLACES_TEXT_SEARCH_FIELD_MASK: readonly PlacesField[]; // now 12 fields, adds 'places.pureServiceAreaBusiness'; tier ts_enterprise
export const PLACES_IDS_ONLY_FIELD_MASK: readonly PlacesField[];     // ['places.id', 'nextPageToken'] → ts_essentials

// src/lib/places/request.ts (pure, no server-only)
export type SearchTextBody = {
  textQuery: string; includedType: string; strictTypeFiltering: true;
  locationRestriction: { rectangle: { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } } };
  includePureServiceAreaBusinesses: true; pageSize: 20; regionCode: 'US'; languageCode: 'en'; pageToken?: string;
};
export type PlacesRequest = { readonly body: Readonly<SearchTextBody>; readonly mask: readonly PlacesField[]; readonly sku: TextSearchSku };
export type PlacesMaskMode = 'enterprise' | 'ids_only';
export function buildFirstPage(a: { placesType: string; rect: Rect; mode: PlacesMaskMode }): PlacesRequest;
//   throws Error if placesType is not Table A (message names the type), or if the rect is
//   inverted / non-finite (message: "...rectangle is not south < north and west < east")
export function buildNextPage(first: PlacesRequest, pageToken: string): PlacesRequest;
//   { ...first, body: { ...first.body, pageToken } }; throws on an empty token. All results frozen.

// src/lib/places/response.ts
export const PlaceSchema;          // zod: id + optional displayName/formattedAddress/location/types/
                                   // businessStatus/pureServiceAreaBusiness/websiteUri/nationalPhoneNumber/rating/userRatingCount
export type ParsedPlace = z.infer<typeof PlaceSchema>;
export const SearchTextResponse;   // { places: ParsedPlace[] (default []), nextPageToken?: string }
export const GoogleErrorEnvelope;  // { error: { code, message, status, details? } }
export type GoogleErrorReason = 'daily_quota' | 'rate_limited' | 'rejected' | 'unavailable';
export function classifyGoogleError(status: number, json: unknown): GoogleErrorReason;

// src/lib/places/reserved-call.ts (pure)
export type ReservedCall = { readonly [reservedBrand]: true; readonly reservationId: string; readonly requestId: string; readonly sku: TextSearchSku };
export function mintReservedCall(reservationId: string, requestId: string, sku: TextSearchSku): ReservedCall; // frozen

// src/lib/places/client.ts ('server-only')
export function placesKeyConfigured(): boolean;   // process.env.GOOGLE_PLACES_API_KEY non-empty
export type SearchTextFailure = 'daily_quota' | 'rate_limited' | 'rejected' | 'unavailable' | 'timeout' | 'bad_shape' | 'no_key';
export type SearchTextOutcome =
  | { ok: true; places: ParsedPlace[]; nextPageToken: string | null }
  | { ok: false; reason: SearchTextFailure; status: number | null; retryAfterMs?: number };
export async function searchText(call: ReservedCall, req: PlacesRequest): Promise<SearchTextOutcome>; // never rejects
```

**Outcome table for 04-16 / 04-18.** These are the settle/release semantics the client assumes:

| outcome | status | meaning for the meter |
|---|---|---|
| `ok` | — | charged |
| `timeout` | `null` | transport failed and the outcome is unknown, so **settle as charged** (Pitfall 9) |
| `bad_shape` | `200` | Google answered 200, so it was billed; **settle as charged** |
| `daily_quota` | 429 | release, then `partial` / `google_daily_quota` (D-19, non-retryable) |
| `rate_limited` | 429 | release, then retry after `retryAfterMs` (numeric `Retry-After` seconds × 1000, otherwise 60 000) |
| `rejected` | 400 | release, then fail `places_request_rejected` |
| `rejected` | `null` | the reservation's sku ≠ the request's sku; **nothing was sent**; caller bug, release |
| `unavailable` | 5xx / 401 / 403 / other | release, then `places_unavailable` |
| `no_key` | `null` | nothing sent, release, then `places_key_missing` |

04-05's `failReasonOf` accepts only an Error whose message is exactly `places_request_rejected`, `places_unavailable` or `places_key_missing`. The client never throws, so the step that maps outcomes to errors (04-18) has to throw exactly those strings.

## Verification

- **Task 1.** RED: 3 tests failed (FIELD_TIERS set equality, the SAB mask test, the ids-only test) and places-request failed to import. GREEN: `field-mask-tier` 8/8, `places-request` 8/8, `price-book` 4/4.
- **Task 2.** RED: the module was missing. GREEN: `places-client` 15/15. The PASS list names all ten behaviours from the plan, plus five extra tests (last page, empty search, sku mismatch, and two already listed).
- **Task 3.** RED was the Task-2 tree itself, because client.ts now exists:
  ```
  × field-mask-tier > X-Goog-FieldMask is named in at most one module under src
    → expected [ 'src/lib/places/client.ts' ] to deeply equal []
  × no-google-credential > no google credential is read anywhere in src
    src\lib\places\client.ts:48 [GOOGLE_*KEY environment variable] return process.env.GOOGLE_PLACES_API_KEY || undefined;
    src\lib\places\client.ts:92 [X-Goog-Api-Key header] 'X-Goog-Api-Key': key,
  ```
  After the amendment all three guard files pass, 11/11.
- **Gates (HEAD e67544b):** `npx vitest run tests/unit` gave **61 files / 458 tests passed**. `npx tsc --noEmit` exited 0. `npx eslint . --ignore-pattern ".claude/**"` exited 0. `prettier --check --end-of-line auto` is clean on all 10 touched files. I did not run the db or workflow lanes: this plan touches no schema, DB or workflow code, and 04-11 was migrating the shared DB at the same time.
- **Acceptance greps:**
  - `'places.pureServiceAreaBusiness'` appears 2 times in field-mask-tier.ts (PRO and the mask).
  - `export const PLACES_IDS_ONLY_FIELD_MASK` matches.
  - `grep -rn GOOGLE_PLACES_API_KEY src | grep -v client.ts` finds nothing.
  - `grep -n "console\.\|throw " src/lib/places/client.ts` finds nothing.
  - `:searchText` appears once in client.ts.
  - no-google-credential matches `'src', 'lib', 'places', 'client.ts'`.

### Mutation checks

For each check I applied the mutation to the committed tree, ran it, read the red test **by name**, reverted with `git checkout -- <file>`, and confirmed `git status` was clean.

| # | Mutation | Red (named) |
|---|---|---|
| M26 | builder drops `includePureServiceAreaBusinesses` | `every places request carries includePureServiceAreaBusinesses` (only) |
| M49 | page 2 body drops `strictTypeFiltering` | `a page request repeats the first request's body` (only) |
| M27 | remove `places.pureServiceAreaBusiness` from PRO | `fieldMaskTier maps every known field to its tier`. Collateral red, by design: the mask now contains an unknown field and `fieldMaskTier` refuses it, so the mask/ids-only/atmosphere tests also fail. |
| M11 | append `places.reviews` to the mask | `price book atmosphere: the ledger price follows the mask` **and** `fieldMaskTier atmosphere: appending places.reviews raises the tier`, both halves still red, plus `the Places mask stays enterprise with the service-area flag` |
| C1 | ambiguous 429 → `rate_limited` | `searchText treats an ambiguous 429 as daily` (only) |
| C2 | error outcome carries `detail: JSON.stringify(json)` | `a failed request's outcome never contains response text` (plus the four exact-`toEqual` classification tests) |
| C3 | drop the `no_key` refusal | `searchText refuses without a key and sends nothing` (only) |
| C4 | transport failure → `unavailable` | `searchText classifies a network error as timeout` (only) |
| C5+C6 | client gains a place-lookup export; request.ts re-exports `mintReservedCall` (applied together, each hits its own test) | `place details is unreachable`, `no module but the meter mints a reserved call` |
| **M51** | `const k = process.env.GOOGLE_PLACES_API_KEY;` appended to `src/lib/places/request.ts` | see below |
| G2 | `'X-Goog-FieldMask'` spelled in request.ts | `X-Goog-FieldMask is named in exactly one module under src` |
| G3 | Places host constant in request.ts | `CI never reaches the network` **and** `no google credential is read anywhere in src` |
| G4 | `NEXT_PUBLIC_GOOGLE_…` spelled in client.ts itself | `no google credential is read anywhere in src` (the per-pattern allowance does not excuse it) |

**M51 red run** (`npx vitest run tests/unit/no-google-credential.test.ts -t "no google credential is read anywhere in src" --reporter=verbose`):
```
 × |node| tests/unit/no-google-credential.test.ts > no Google credential in the source tree > no google credential is read anywhere in src 99ms
 ↓ |node| tests/unit/no-google-credential.test.ts > no Google credential in the source tree > src/env.ts declares no Google variable and only the PLACES_MODE switch
AssertionError: src\lib\places\request.ts:114 [GOOGLE_*KEY environment variable] const k = process.env.GOOGLE_PLACES_API_KEY;: expected [ Array(1) ] to deeply equal []
      Tests  1 failed | 1 skipped (2)
```
**Clean revert:** after `git checkout -- src/lib/places/request.ts`, `git diff --stat src/` printed nothing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security] The credential guard's allowance is per pattern, not per file**
- **Found during:** Task 3
- **Issue:** Allow-listing client.ts as a whole file would also have excused `NEXT_PUBLIC_GOOGLE…`, `GOOGLE_API_KEY` and the Maps host inside the key's own module, which is where a browser-reachable leak would matter most.
- **Fix:** `FORBIDDEN` entries carry `allowedIn`, and only the key-variable, key-header and Places-host patterns name client.ts. The positive control asserts that client.ts is scanned, contains `GOOGLE_PLACES_API_KEY`, and trips every pattern it is excused from. G4 proves the remaining patterns still apply there.
- **Commit:** fe81164

**2. [Rule 2 - Correctness] The builder refuses an inverted or non-finite rectangle, and an empty page token; built requests are frozen**
- **Found during:** Task 1
- **Issue:** Google reads `low.longitude > high.longitude` as an antimeridian crossing, so a swapped rect would be a valid, billed search over the wrong area. An empty token would silently re-request page 1.
- **Fix:** `assertRect` and an empty-token check (both throw; the caller is our own planner). `Object.freeze` on the request, body and mask. Each has a named test.
- **Commit:** 3b048a5

**3. [Rule 2 - Correctness] No `no-network` self-violation: the Places host label is not spelled**
- **Found during:** Task 3
- **Issue:** The amended no-network guard (correctly) flagged my first label `'places.googleapis.com host'` in no-google-credential.test.ts.
- **Fix:** Changed the label to `'Places API host'`. The escaped regex does not contain the literal.
- **Commit:** fe81164

**4. [Rule 2] Positive control in no-network for the new host.** client.ts must be scanned and must trip the Places entry, so the allow-list entry excuses something real. **Commit:** fe81164

**5. Header grep tightened from "at most one" to "exactly one" module.** Zero modules would mean the client had stopped sending the header. The test was renamed `X-Goog-FieldMask is named in exactly one module under src`. **04-33 note:** that is the name to cite.

**6. Extra tests beyond the plan's list:** `the builder picks the mask and its sku from the mode`, `the builder refuses a page token that is empty`, `a built request cannot be edited after the fact`, `searchText returns a last page with a null token`, `searchText parses an empty search as zero places`, `searchText refuses a reservation for a different sku and sends nothing`.

**7. Verify commands.** Following the orchestrator's Windows note, I used `npx vitest run <file> [-t] --reporter=verbose` rather than `$PNPM test:unit -t`, and read every test name.

**8. Task 3 has no separate RED commit.** Its red state is the Task-2 GREEN tree (846ff92), quoted above. That commit leaves those two guards red until fe81164. Merge the branch as a whole, not a cherry-pick of 846ff92 alone.

## Known Stubs

None. `mintReservedCall` has no production caller yet by design. 04-16's meter is the only permitted one, and `no module but the meter mints a reserved call` enforces that.

## Notes for later plans / merge

- **04-16 (meter):** once `src/lib/places/meter.ts` exists, turn the minter test into an equality (`toEqual(['src/lib/places/meter.ts'])`). Mint with the reservation's sku, which is `req.sku`. A mismatch returns `rejected` with `status: null` and sends nothing.
- **04-18 (steps):** the client never throws. Map outcomes to the three exact `failReasonOf` messages. Settle `timeout` and `bad_shape` as charged (see the table above).
- **04-19 (recorder):** `businessStatus` is a strict enum `OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY`, verbatim from research. If a real recording carries `BUSINESS_STATUS_UNSPECIFIED`, the whole page becomes `bad_shape` (a charged page lost). Check it on the first recording.
- **Merge proximity:** `tests/unit/field-mask-tier.test.ts`, `no-google-credential.test.ts` and `no-network.test.ts` were changed only in their tier table and allow-list sections. `src/lib/budget/field-mask-tier.ts` changed in its header comment and the PRO list / mask. Any other wave-2 plan editing those regions will conflict textually; keep both.
- No network call of any kind, nothing pushed, production untouched, the DB untouched.

## Threat Flags

None. The only new outbound surface is the client's `fetch` to the Places host, and it is in the plan's threat model (T-4-01, T-4-02, T-4-05, T-4-10). All are mitigated as planned and each is backed by a named test.

## Self-Check: PASSED

- FOUND: src/lib/places/request.ts, src/lib/places/response.ts, src/lib/places/reserved-call.ts, src/lib/places/client.ts, tests/unit/places-request.test.ts, tests/unit/places-client.test.ts
- FOUND commits: 7e8a53c, 3b048a5, f30cfc6, 846ff92, fe81164, e67544b
- TDD gates: test(04-12) 7e8a53c → feat(04-12) 3b048a5; test(04-12) f30cfc6 → feat(04-12) 846ff92
