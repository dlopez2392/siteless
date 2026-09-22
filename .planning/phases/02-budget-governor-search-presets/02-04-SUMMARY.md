---
phase: 02-budget-governor-search-presets
plan: 04
subsystem: budget
tags: [places-api, field-mask, pricing, micro-usd, bigint, timezone, intl, date-fns-tz, vitest]

# Dependency graph
requires:
  - phase: 01-foundations-tenancy
    provides: "src/lib/time.ts (APP_TZ, APP_LOCALE, localDate, formatLocal), the deny-by-default house shape in src/lib/auth/require-org.ts, the two-sided-proof test discipline in tests/unit/no-internal-leak.test.ts, and vitest.config.ts pinned to TZ=UTC"
provides:
  - "PRICE_BOOK: the verified Places SKU table in micro-USD with per-SKU monthly free allowances and Google's published SKU ids"
  - "priceRequests(sku, requests, freeRemaining) and freeRemaining(sku, unitsUsed) — the free allowance applied, not assumed"
  - "fieldMaskTier(mask) — bills at the highest SKU in the mask, THROWS on an unknown field, never defaults"
  - "PLACES_TEXT_SEARCH_FIELD_MASK — the production field mask Phase 4 sends (tier: ts_enterprise)"
  - "money.ts: microToCents, formatUsd, formatPct, parseUsdToMicro, MICRO_PER_USD, MICRO_PER_CENT, MAX_PARSEABLE_MICRO_USD"
  - "period.ts: periodStart, nextPeriodStart, periodLabel, periodResetInstant — the app-zone calendar month and its DST-sensitive reset instant"
  - "Both independent halves of gate mutation M11, as separate named tests"
affects: [02-05 cost ledger and meter, 02-06 estimator, 02-09 spend view, 02-12 budget settings cap input, phase-04 places client]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "The price of a call is derived from the mask actually sent: priceRequests(fieldMaskTier(mask), ...)"
    - "Deny by default in a pure function: an unknown field throws rather than resolving to the cheapest tier"
    - "A union of `as const` arrays as a compile-time allow-list — a wildcard mask cannot be spelled"
    - "Money is bigint/integer micro-USD; rounding exists only at the render boundary and never feeds back"
    - "Zone-dependent helpers take an explicit `timeZone` parameter defaulting to APP_TZ, so a discriminating pair is expressible"
    - "Comments in src/ must not spell a token that a bare-token repo grep guards"

key-files:
  created:
    - src/lib/budget/price-book.ts
    - src/lib/budget/field-mask-tier.ts
    - src/lib/budget/money.ts
    - src/lib/budget/period.ts
    - tests/unit/price-book.test.ts
    - tests/unit/field-mask-tier.test.ts
    - tests/unit/money.test.ts
    - tests/unit/budget-period.test.ts
  modified: []

key-decisions:
  - "fieldMaskTier returns the narrower TextSearchSku (the four ts_* tiers) rather than the full Sku union, so a caller switching on the result gets exhaustiveness over 4 cases instead of 7. TextSearchSku is a subset of Sku, so every signature the plan specifies still compiles."
  - "periodResetInstant uses TZDate from @date-fns/tz (already a pinned dependency) rather than a hand-rolled two-pass offset solve. RESEARCH's Don't-Hand-Roll table puts month-boundary arithmetic on the do-not-build list, and the library resolves the offset at the wall-clock moment, which is exactly what makes the CST/CDT pair come out right."
  - "priceRequests refuses a non-integer or negative request count and a NaN free allowance, and refuses a cost that leaves the exact-integer range (PITFALLS 2), rather than clamping. A clamped value becomes a ledger row that never matches the invoice."
  - "formatUsd pins minimumFractionDigits/maximumFractionDigits to 2 explicitly rather than inheriting them from USD locale data, so a locale-data change cannot silently drop the cents off a spend figure."
  - "parseUsdToMicro composes the bigint from the dollar and cent digit strings; no float intermediate touches the value (Number('0.07') * 1e6 is 70000.00000000001)."

patterns-established:
  - "Two independent halves of one mutation: M11 reds the tier test in field-mask-tier.test.ts AND the ledger-price test in price-book.test.ts, sharing no assertion, so the failure tells you which guard broke."
  - "A repo-grep guard that proves its own non-vacuity: the X-Goog-FieldMask walker asserts the file set is non-empty and that the reads returned real source before reporting zero violations."
  - "A format -> parse round trip pinned in BOTH directions: a whole-cent value round trips exactly, a half-cent value deliberately does not, so nobody later 'fixes' the display rounding into the ledger."

requirements-completed: [BUDG-01, SRCH-04]

# Metrics
duration: 25min
completed: 2026-09-22
---

# Phase 2 Plan 04: Budget Primitives Summary

**The four zero-I/O modules the meter and the estimator stand on: a Places SKU price table in micro-USD with free allowances applied, a `fieldMaskTier()` that refuses an unknown field instead of pricing it as free, exact bigint money with a locale-pinned formatter, and a calendar-month boundary whose reset instant moves with DST.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-22T13:46Z
- **Completed:** 2026-09-22T14:10Z
- **Tasks:** 2 of 2
- **Files created:** 8 (4 modules, 4 unit test files)

## Accomplishments

- **The price of a call is now a function of the mask actually sent.** `priceRequests(fieldMaskTier(PLACES_TEXT_SEARCH_FIELD_MASK), 1000, 0).microUsd` is 35,000,000 µUSD; append `places.reviews` and it is 40,000,000. No per-call cost constant exists anywhere (T-2-08).
- **An unknown field is refused, not defaulted.** `fieldMaskTier(['places.priceLevel'])` throws. The `PlacesField` union of four `as const` arrays makes a wildcard mask a compile error (T-2-05), and `grep -c "'\*'" src/lib/budget/field-mask-tier.ts` is 0.
- **The free allowance is applied, not assumed.** 68 Text Search Enterprise requests cost $0.00 with 1,000 free left, $0.98 with 40 left, and $2.38 with none — all three pinned, because a test that only proves "not $2.40" passes on a broken calculation too.
- **No half cent is lost.** 1,428 paid Enterprise requests are 49,980,000 µUSD → `microToCents` 4998 → `formatUsd` "$49.98", asserted with exact equality. A whole-cent value survives a format → parse round trip; a half-cent value deliberately does not, and that asymmetry is pinned.
- **The budget month discriminates.** Three pairs: one instant in two zones with opposite month verdicts, two instants an hour apart in CST landing in different months, and the CDT/CST reset instants (2026-10-01T05:00:00Z vs 2026-03-01T06:00:00Z) that a fixed offset cannot both satisfy.
- **`src/lib/time.ts` is still the only file in `src/` naming a zone or a locale** (see Issues for the one pre-existing hit that is not one).

## Task Commits

1. **Task 1: The price book and fieldMaskTier** — `603a0c7` (feat)
2. **Task 2: Money in micro-USD, and the calendar month** — `b6796aa` (feat)

**Plan metadata:** see the final commit on this branch (docs: SUMMARY only — STATE.md and ROADMAP.md are the orchestrator's, per worktree mode).

## Files Created/Modified

- `src/lib/budget/price-book.ts` — the verified SKU table (µUSD/request + `freePerMonth` + Google SKU ids), `priceRequests()`, `freeRemaining()`. Source: the Google pricing page, fetched 2026-09-22.
- `src/lib/budget/field-mask-tier.ts` — the four tier field lists, the `PlacesField` union, `ALL_PLACES_FIELDS`, `PLACES_TEXT_SEARCH_FIELD_MASK`, and `fieldMaskTier()`.
- `src/lib/budget/money.ts` — `MICRO_PER_USD`, `MICRO_PER_CENT`, `MAX_PARSEABLE_MICRO_USD`, `microToCents`, `formatUsd`, `formatPct`, `parseUsdToMicro`.
- `src/lib/budget/period.ts` — `periodStart`, `nextPeriodStart`, `periodLabel`, `periodResetInstant`, built on `src/lib/time.ts`.
- `tests/unit/price-book.test.ts` — 4 named `price book ...` tests, including M11 half 2.
- `tests/unit/field-mask-tier.test.ts` — 5 named `fieldMaskTier ...` tests (including M11 half 1) plus the `X-Goog-FieldMask` repo-grep gate (T-2-03).
- `tests/unit/money.test.ts` — 3 named `money ...` tests including the `Intl.NumberFormat` locale-pin spy.
- `tests/unit/budget-period.test.ts` — 4 named `budget period ...` tests.

## Verification

### `pnpm test:unit` — exit 0, 33 passed (9 files). Tests this plan adds, by name:

```
 ✓ tests/unit/field-mask-tier.test.ts > field mask tiering (BUDG-01) > fieldMaskTier maps every known field to its tier
 ✓ tests/unit/field-mask-tier.test.ts > field mask tiering (BUDG-01) > fieldMaskTier throws on an unknown field
 ✓ tests/unit/field-mask-tier.test.ts > field mask tiering (BUDG-01) > fieldMaskTier throws on an empty mask
 ✓ tests/unit/field-mask-tier.test.ts > field mask tiering (BUDG-01) > fieldMaskTier: nextPageToken is Essentials and does not raise the tier
 ✓ tests/unit/field-mask-tier.test.ts > field mask tiering (BUDG-01) > fieldMaskTier atmosphere: appending places.reviews raises the tier
 ✓ tests/unit/field-mask-tier.test.ts > field mask tiering (BUDG-01) > X-Goog-FieldMask is named in at most one module under src
 ✓ tests/unit/price-book.test.ts > the SKU price table (BUDG-01) > price book: one Text Search Enterprise request is 35000 micro-USD
 ✓ tests/unit/price-book.test.ts > the SKU price table (BUDG-01) > price book free allowance: 68 requests
 ✓ tests/unit/price-book.test.ts > the SKU price table (BUDG-01) > price book atmosphere: the ledger price follows the mask
 ✓ tests/unit/price-book.test.ts > the SKU price table (BUDG-01) > price book: freeRemaining for an unlimited SKU is infinite
 ✓ tests/unit/money.test.ts > money in micro-USD > money: micro-USD renders without losing a half cent
 ✓ tests/unit/money.test.ts > money in micro-USD > money: parseUsdToMicro accepts what the cap input allows and refuses the rest
 ✓ tests/unit/money.test.ts > money in micro-USD > money: formatUsd pins the locale
 ✓ tests/unit/budget-period.test.ts > the Chicago budget month (D-11) > budget period: one instant, two zones, opposite month verdicts
 ✓ tests/unit/budget-period.test.ts > the Chicago budget month (D-11) > budget period: opposite verdicts at the month edge in CST
 ✓ tests/unit/budget-period.test.ts > the Chicago budget month (D-11) > budget period: the reset instant moves with DST
 ✓ tests/unit/budget-period.test.ts > the Chicago budget month (D-11) > budget period: the label reads as the spend view shows it

 Test Files  9 passed (9)
      Tests  33 passed (33)
```

The 16 pre-existing Phase 1 tests all stayed green (`suite-zone`, `time`, `env-alias`, `sole-organization`, `no-internal-leak`).

### `pnpm typecheck` — exit 0. `pnpm lint` — exit 0.

```
$ tsc --noEmit        → typecheck EXIT=0   (no diagnostics)
$ eslint .            → lint EXIT=0        (no findings)
```

Exit codes were read from a redirected run, not from the tail of a pipe.

### Grep gates

```
$ grep -rln "America/Chicago" src/ | grep -v 'src/lib/time.ts'
src/db/schema/orgs.ts          # PRE-EXISTING, see Issues — not a formatter zone
$ grep -rn "'en-US'" src/ | grep -v 'src/lib/time.ts' | wc -l
0
$ grep -c 'getMonth()' src/lib/budget/period.ts
0
$ grep -c 'toFixed(2)' src/lib/budget/money.ts
0
$ grep -c "'\*'" src/lib/budget/field-mask-tier.ts
0
$ grep -n "from '@/lib/time'" src/lib/budget/period.ts
23:import { APP_LOCALE, APP_TZ, formatLocal } from '@/lib/time';
```

`src/lib/budget/price-book.ts` contains each of `35000`, `32000`, `40000`, `20000`, `17000`, `5000`, `E967-44BC-B44D`, `120C-BEC3-B48F`, `2D9A-3DE0-3766` (grep count ≥ 1 each). `src/lib/budget/field-mask-tier.ts` contains `PLACES_TEXT_SEARCH_FIELD_MASK`, `places.websiteUri`, `places.reviews`, `nextPageToken` and 3 `throw` lines.

## Watched-red-first mutations

All three were applied to the **committed** working tree, so the revert is provable by construction: `git diff --stat` printing nothing and `git status --short` printing nothing afterwards.

### Mutation 1 — `PRICE_BOOK.ts_enterprise.microUsdPerRequest`: `35000` → `35`

```
 × tests/unit/price-book.test.ts > ... > price book: one Text Search Enterprise request is 35000 micro-USD 25ms
 × tests/unit/price-book.test.ts > ... > price book free allowance: 68 requests 8ms
 × tests/unit/price-book.test.ts > ... > price book atmosphere: the ledger price follows the mask 2ms
 ✓ tests/unit/price-book.test.ts > ... > price book: freeRemaining for an unlimited SKU is infinite 1ms
 ✓ (all 5 fieldMaskTier tests stayed green)
 Test Files  1 failed | 6 passed (7)
      Tests  3 failed | 23 passed (26)
```

Both tests the plan requires went red. A third, `price book free allowance: 68 requests`, went red too — it prices the same SKU, so this mutation is not single-test-discriminating for it; the free-allowance test's own discriminating mutation is the allowance value, not the price. Revert verified:

```
$ git checkout -- src/lib/budget/price-book.ts
$ git diff --stat        → (no output)
$ git status --short     → (no output)
```

### Mutation 2 — `fieldMaskTier` returns `ts_essentials` for an unknown field instead of throwing

```
 ✓ tests/unit/field-mask-tier.test.ts > ... > fieldMaskTier maps every known field to its tier 8ms
 × tests/unit/field-mask-tier.test.ts > ... > fieldMaskTier throws on an unknown field 15ms
 ✓ tests/unit/field-mask-tier.test.ts > ... > fieldMaskTier throws on an empty mask 1ms
 ✓ tests/unit/field-mask-tier.test.ts > ... > fieldMaskTier: nextPageToken is Essentials and does not raise the tier 0ms
 ✓ tests/unit/field-mask-tier.test.ts > ... > fieldMaskTier atmosphere: appending places.reviews raises the tier 0ms
 ✓ tests/unit/field-mask-tier.test.ts > ... > X-Goog-FieldMask is named in at most one module under src 9ms
 ✓ (all 4 price book tests stayed green)
 Test Files  1 failed | 6 passed (7)
      Tests  1 failed | 25 passed (26)
```

Red ALONE — one test of twenty-six. The positive control inside it (`fieldMaskTier(['places.websiteUri'])` is `ts_enterprise`) and the whole-table test beside it both stayed green, so this is a guard that refuses the right thing rather than a function that refuses everything. Revert verified: `git diff --stat` and `git status --short` both empty.

### Mutation 3 — `periodResetInstant` computes a fixed −6 hour offset (`Date.UTC(y, m, 1, 6, 0, 0)`)

```
 ✓ budget period: one instant, two zones, opposite month verdicts 90ms
 ✓ budget period: opposite verdicts at the month edge in CST 3ms
 × budget period: the reset instant moves with DST 19ms
   → expected '2026-10-01T06:00:00.000Z' to be '2026-10-01T05:00:00.000Z' // Object.is equality
 ✓ budget period: the label reads as the spend view shows it 2ms
 ✓ (all 3 money tests stayed green)
 Test Files  1 failed | 8 passed (9)
      Tests  1 failed | 32 passed (33)
```

Red ALONE, and the failure message is the point: the fixed offset passes the CST half (`2026-03-01T06:00:00.000Z`) and fails the CDT half by exactly one hour. Revert verified: `git diff --stat` and `git status --short` both empty, then the full suite back to 33 passed.

## Decisions Made

See `key-decisions` in the frontmatter. The two a reviewer should look at first:

1. **`fieldMaskTier` returns `TextSearchSku`, not `Sku`.** The plan's signature says `: Sku`. `TextSearchSku` is the four `ts_*` tiers and is a strict subset, so `priceRequests(fieldMaskTier(mask), ...)` and every other stated usage compiles unchanged — but a caller that switches on the tier now gets exhaustiveness over the four reachable cases instead of seven, three of which a field mask can never produce.
2. **`periodResetInstant` uses `TZDate` from `@date-fns/tz`.** Already a pinned dependency (STACK.md: "Explicit IANA zone at every call site"), and RESEARCH's Don't-Hand-Roll table lists month-boundary arithmetic as a do-not-build. Probed before use: `new TZDate(2026, 9, 1, 0, 0, 0, APP_TZ)` is `2026-10-01T05:00:00.000Z` and `new TZDate(2026, 2, 1, 0, 0, 0, APP_TZ)` is `2026-03-01T06:00:00.000Z`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The plan places money-render assertions in Task 1's test file, which would have made Task 1's commit red**

- **Found during:** Task 1
- **Issue:** The plan specifies that `tests/unit/price-book.test.ts` (a Task 1 file) assert `microToCents` renders `4998` and `formatUsd` renders `$49.98` — but `src/lib/budget/money.ts` is a Task 2 file. Written as specified, Task 1's commit would not have compiled or passed on its own, which defeats atomic per-task commits.
- **Fix:** Task 1's `price-book.test.ts` asserts the exact µUSD integer (`49_980_000`). Task 2 adds the two rendering assertions to that same named test, alongside its import of `money.ts`. Every assertion the plan calls for exists, in the file the plan names; only the commit it arrives in moved.
- **Files modified:** `tests/unit/price-book.test.ts`
- **Verification:** `price book: one Text Search Enterprise request is 35000 micro-USD` is green and carries all three assertions; mutation 1 reds it.
- **Committed in:** `603a0c7` (µUSD half) and `b6796aa` (render half)

**2. [Rule 1 - Bug] My own comments in `src/lib/budget/period.ts` tripped two of the plan's bare-token grep gates**

- **Found during:** Task 2
- **Issue:** The first draft explained the module by quoting the zone name and the zoneless month accessor by name. Both gates are bare token searches over `src/`, so `grep -rln "America/Chicago" src/` named `period.ts` and `grep -c 'getMonth()' src/lib/budget/period.ts` returned 1 — a self-inflicted failure of the exact guards the file exists to honour. `src/lib/time.ts` carries a comment warning about precisely this.
- **Fix:** Reworded both comments to describe the tokens without spelling them, and said why in the comment so the next author does not "helpfully" put them back.
- **Files modified:** `src/lib/budget/period.ts`
- **Verification:** both greps re-run — 0 offenders from `src/lib/budget/`; `pnpm typecheck`, `pnpm lint` and `pnpm test:unit` all re-run at exit 0 after the edit.
- **Committed in:** `b6796aa`

**3. [Rule 2 - Missing critical functionality] Input refusals the plan did not spell out**

- **Found during:** Tasks 1 and 2
- **Issue:** `priceRequests` accepted any `freeRemaining` including `NaN` (which silently makes `billable` `NaN` and the ledger row meaningless), had no guard against the cost leaving the exact-integer range (PITFALLS 2 names integer overflow in the meter's own arithmetic), and `freeRemaining()` itself validated nothing. `periodResetInstant` accepted any string.
- **Fix:** `priceRequests` throws on a `NaN` allowance and on a cost outside `Number.isSafeInteger`; `freeRemaining` refuses a negative or non-integer usage count; `periodResetInstant` refuses anything that is not `YYYY-MM-01`, naming the input. All refusals name the offending value.
- **Files modified:** `src/lib/budget/price-book.ts`, `src/lib/budget/period.ts`
- **Verification:** the `periodResetInstant` refusals are asserted in `budget period: the reset instant moves with DST`; the arithmetic guards are defensive and unreached by the named tests.
- **Committed in:** `603a0c7`, `b6796aa`

---

**Total deviations:** 3 auto-fixed (1× Rule 1, 1× Rule 2, 1× Rule 3)
**Impact on plan:** No scope change. Every module, export and named test the plan specifies exists; one assertion pair moved one commit later so each commit stands green on its own.

## Issues Encountered

**`src/db/schema/orgs.ts` names the zone, and it is not mine to move.** The plan's acceptance criterion is `grep -rln "America/Chicago" src/ | grep -v 'src/lib/time.ts' | wc -l` → 0. It returns 1, and did so at this plan's base commit `131bf02` before a single file was written:

```
src/db/schema/orgs.ts:18:    timezone: text('timezone').notNull().default('America/Chicago'),
```

That is Phase 1's `orgs.timezone` column default — a per-tenant **data** value stored in Postgres, not a zone a formatter reads, and CONVENTIONS documents the column that way. Removing it is a schema change (a new migration against a database three sibling worktrees are using concurrently), which is Rule 4 territory and firmly outside this plan. **Nothing in `src/lib/budget/` names a zone or a locale**, which is the property the criterion is actually protecting. Flagged for the phase verifier: either the gate should exclude `src/db/schema/` or the criterion should be read as "no second *formatter* zone".

**`node_modules/.cache/gsd/` holds two commit-message files.** Written there because the scratchpad is outside the worktree and the Write tool refuses paths outside it; `node_modules/` is gitignored, so nothing leaked into a commit. `git status --short` is empty.

## Environment Notes

- Worktree had no `node_modules` and no `.env.local`. Copied `.env.local` in from the main tree (gitignored, never staged) and ran `pnpm install --frozen-lockfile` through the store launcher — `Done in 25.2s using pnpm v12.5.1`.
- Every `pnpm` invocation went through `node .../pnpm/12.5.1/.../pnpm.mjs`. `pnpm verify` was not run: it shells out to bare `pnpm` internally, and it includes `test:db` and `build`, neither of which this plan may touch (sibling 02-03 is migrating the shared test database).
- No database was touched. No dependency was added. No shared orchestrator artifact (`STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md`) was modified — `REQUIREMENTS.md` was deliberately left alone to avoid a four-way concurrent edit; `requirements-completed` above records the IDs for the orchestrator.

## User Setup Required

None — no external service configuration. This plan is pure modules and unit tests, with zero I/O and no Google key.

## Next Phase Readiness

Ready for the rest of wave 1 and for 02-05:

- **02-05 (cost ledger + meter)** can price a row with `priceRequests(fieldMaskTier(maskSent), units, freeRemaining(sku, usedThisPeriod))` and key the period with `periodStart(new Date())`. `cost_cents numeric(12,2) generated always as (micro_usd / 10000.0) stored` matches `microToCents` exactly.
- **02-06 (estimator)** has the price book and the free-allowance function the "~68 requests · $0.00 early in the month" correction depends on.
- **02-09 / 02-12 (spend view, budget settings)** have `formatUsd`, `formatPct`, `periodLabel` and the server-side `parseUsdToMicro` for the cap input.
- **Phase 4 (Places client)** must import `PLACES_TEXT_SEARCH_FIELD_MASK` and send exactly it; the `X-Goog-FieldMask` grep gate goes red if a second module spells that header.

Carry-forward for the verifier: the `src/db/schema/orgs.ts` grep hit described under Issues, and the note that the price-book free-allowance test is also killed by the price mutation.

## Self-Check: PASSED

All 9 files this plan claims to have created exist on disk. All three commits exist in
`git log` on `worktree-agent-a62016f707553635f`: `603a0c7`, `b6796aa`, `843c690` (the last
being this SUMMARY's own commit). `git status --short` is empty and `.env.local` is matched
by `.gitignore:4` (`.env.*`), so it was never staged.

---
*Phase: 02-budget-governor-search-presets*
*Completed: 2026-09-22*
