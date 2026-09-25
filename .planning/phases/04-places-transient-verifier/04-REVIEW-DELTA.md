---
phase: 04-places-transient-verifier
reviewed: 2026-09-25T17:10:00Z
depth: deep
scope: delta 7eba6e2..15823b8 (-- src tests scripts drizzle)
files_reviewed: 11
files_reviewed_list:
  - src/components/runs/run-alerts.tsx
  - src/components/runs/tiles-card.tsx
  - src/lib/budget/second-wall.ts
  - src/lib/ui/copy.ts
  - tests/db/places-recorded-replay.test.ts
  - tests/unit/msw/fixtures/README.md
  - tests/unit/msw/fixtures/places-recorded-mcallen-plumber-p1.json
  - tests/unit/msw/fixtures/places-recorded-mcallen-plumber-p2.json
  - tests/unit/msw/fixtures/places-recordings.json
  - tests/unit/run-report.test.tsx
  - tests/unit/second-wall-card.test.tsx
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: issues_found
---

# Phase 4: Delta Code Review Report (after the 7eba6e2 gate)

**Reviewed:** 2026-09-25
**Depth:** deep (cross-file: msw harness, anonymizer, recorder, every consumer of the changed copy, anchors and constants)
**Files Reviewed:** 11 (plus the consumers they affect: `tests/unit/anonymize-places.test.ts`, `tests/unit/msw/places.ts`, `scripts/record-places-fixtures.ts`, `scripts/lib/anonymize-places.ts`, `src/components/budget/second-wall-card.tsx`, `tests/unit/google-maps-attribution.test.tsx`, docs)
**Status:** issues_found (no blockers)

## Summary

Branch `gsd/phase-04-places-transient-verifier`, HEAD `15823b8`.

**Anonymization of the committed recording (D-20/D-21): clean.** I checked it independently rather than trusting the sidecar:
- All 33 places carry only the anonymizer's keys. Every name matches `Synthetic plumber NNN`. Every phone matches `^\(956\) 555-01\d\d$`. Every address is `NNN Synthetic St, McAllen, TX 78500`. Every URL is `https://synthetic-NNN.example`. Ratings are 4 and review counts 10 wherever they appear.
- **Coordinates are the hash, not real pins, proven directly.** I re-ran `anonymizePage` on both committed pages, using the root tile's rectangle (`rootSpec(...)` over the McAllen bbox `26.1019..26.4667 × -98.3183..-98.1954`). The output was byte-identical: `p1 fixpoint: true`, `p2 fixpoint: true`. So every `location` is `inside(rect, fnv1a32(id:lat|lng))`, and no real coordinate survived, not even rounded. `assertAnonymizedPage` also passes on both files.
- The page token is `recorded:p2`. No `types`/`businessStatus`. The only real Google values are the place ids and the `pureServiceAreaBusiness` booleans, which is allowed.
- Every factual claim in the README table matches the files: 20+13, 9 SAB with no address or pin, 24 located, and 22:20 CDT = 03:20Z.

**Fix `0456186` (an exceeded-estimate stop with 0 tiles subdividing): consumers are intact.** The link (`run-alerts.tsx:325`) and its target (`tiles-card.tsx:135`) are now gated by the same `stillSubdividing.length > 0`, so no anchor can point at nothing. The reverse case, a list without a link, only happens when status ≠ `partial`, and that was already true before the fix. I grepped `tests/` (unit, db, workflow, e2e), `src/`, `scripts/` and `docs/`. No db or e2e test asserts the old "0 tiles were…" sentence or `#run-tiles-subdividing`. The unit and attribution tests that do reference them use one subdividing tile, so their expectations still hold. The one stale reference is a doc (IN-03).

**Replay test: not vacuous on its main claims.** I ran it locally at `15823b8`: `1 passed`, 6.4 s. No skip path exists (the hoisted env check throws). Its pagination, request count, ledger, membership, outcome and observation expectations are all derived from the files and would fail on a regression. Its **sentinel scan is only partly effective**, though (WR-02). And the fixture change made one existing recorder assertion vacuous (WR-01).

## Warnings

### WR-01: The recorder's "marks the sidecar anonymized" assertion is now vacuous

**File:** `tests/unit/anonymize-places.test.ts:381-385, 416` (made vacuous by `tests/unit/msw/fixtures/places-recordings.json:3-4`, changed in `db12ffe`)
**Issue:** The test copies the **committed** sidecar into a scratch directory, calls `writeRecording`, and then asserts `sidecar.anonymized === true` and a non-null `recordedFrom`. Since `db12ffe`, the committed sidecar already has `"anonymized": true` and a `recordedFrom` string. The scratch copy satisfies the assertion before the recorder writes anything. Deleting `sidecar.anonymized = true` (`scripts/record-places-fixtures.ts:114`) would now leave the suite green: the "one named test per mutation" guard for that line is dead.
**Fix:** Seed the scratch sidecar from a neutral state instead of the live one, and pin the precondition:
```ts
const seed = JSON.parse(readFileSync(new URL('places-recordings.json', FIXTURES_DIR), 'utf8'));
seed.anonymized = false;
seed.recordedFrom = null;
writeFileSync(join(dir, 'places-recordings.json'), JSON.stringify(seed, null, 2) + '\n');
expect(JSON.parse(readFileSync(join(dir, 'places-recordings.json'), 'utf8')).anonymized).toBe(false);
// … writeRecording(…) …
expect(sidecar.anonymized).toBe(true);
expect(sidecar.recordedFrom).toMatch(/record-places-fixtures\.ts/);
```
Then run the mutation (delete line 114) and read the name of the test that fails.

### WR-02: The replay's "no recorded string reached any Places table" scan can only detect names

**File:** `tests/db/places-recorded-replay.test.ts:161-171, 352-354, 461-468`
**Issue:** `RECORDED_SENTINELS` holds the fixture strings exactly as served:
- phones in national format, e.g. `(956) 555-0101`
- the whole formatted address, e.g. `001 Synthetic St, McAllen, TX 78500`
- full URLs

The writers and matcher normalize before they persist: E.164 `+19565550101`, a split-out street/ZIP, a host class. So a phone, street or URL leak in the **form a writer would actually use** can never match. The non-vacuity proof (line 353-354) only shows that names hit, so names are the only kind the scan is proven able to detect.

There is also a blind spot in `businesses`, the table a Places-text leak onto the spine would land in. It is excluded from `TABLES`, and every twin is seeded with the identical strings (`seedTwins`, lines 212-246). A writer that copied the Places name or phone onto the matched business would change nothing observable.

This is the D-06/D-20 legal boundary, so a partly vacuous guard matters more than usual. `places-search-tile.test.ts` uses the same pattern, and this file inherits it.
**Fix:**
1. Add the normalized forms to the sentinels: `e164(p.nationalPhoneNumber)`, `formatted.split(',')[0]` (the street), and the URL host.
2. Prove non-vacuity per kind against the `businesses` snapshot. The twins carry the street and the E.164 phone, so assert at least one hit for each kind.
3. Seed the twins' text in a form that matches but is not byte-equal, e.g. name `SYNTHETIC PLUMBER 001 LLC`, which normalizes to the same `name_norm`. Then add `businesses` to the post-run scan: any served Places string appearing there is a leak.

## Info

### IN-01: The zero-subdividing stop alert still carries a Google Maps tag

**File:** `src/components/runs/run-alerts.tsx:317`
**Issue:** `placesContent` is unconditional on the `exceeded_estimate` alert. It was added (C-WR-02) because the "{k} tiles were still subdividing" count is Places-derived. After `0456186`, the zero case prints no such count, and the alert holds only our own estimate and ceiling figures, yet it still paints the tag. This is the same over-attribution class as `docs/measurements/04-screens/README.md` item 2: harmless under the policy, but no longer true to the header's rule.
**Fix:** `placesContent={tiles.stillSubdividing.length > 0}`. Add a zero-tile case to `google-maps-attribution.test.tsx` that asserts no tag inside `[data-testid="run-stop-alert"]`.

### IN-02: The sidecar's top-level flags and the harness header now contradict the files

**File:** `tests/unit/msw/fixtures/places-recordings.json:2-5`; `tests/unit/msw/places.ts:4-8`
**Issue:** The top level now reads `"synthetic": true` **and** `"anonymized": true`. The `note` still says the recorder "adds anonymized real recordings after D-01" (it has). The harness header still says "every `places-*.json` beside this file is hand-authored". The real gate is per file (`places.ts:161-174`) and it is correct. The top-level flags now carry no information, and the load-time check at `places.ts:105` is an OR, so it can never fire.
**Fix:** Update the `note` and the `places.ts` header to say two files are anonymized recordings. Optionally, drop the top-level check or reword it to "per-file flags decide".

### IN-03: Stale quota naming and a stale open item in the docs and the unset-state copy

**File:** `docs/runbooks/places.md:64`; `src/lib/ui/copy.ts:2075`; `docs/measurements/04-screens/README.md:106-111`
**Issue:**
- `places.md` still says **"Places API (New) → Requests per day = 100"**. That contradicts `second-wall.ts:15`, `SECOND_WALL_SET_BODY` and `google-quota.md:35`, all of which say there is no such row and the quota is per method.
- The unset-state derivation still recommends "Places API (New) → 100 requests/day". It is unreachable while `GOOGLE_QUOTA_SET_ON` is set, but it is still wrong.
- The screens README still lists the zero-subdividing alert under "For danlo's eye" as unfixed, but `0456186` fixed it.
**Fix:**
- `places.md`: "SearchTextRequest per day = 100, every other Places method = 0".
- Derivation copy: "Places API (New) → SearchTextRequest: 100/day".
- Screens README: mark item 1 fixed in `0456186`.

### IN-04: The shipped `GOOGLE_QUOTA_SET_ON` value is never rendered by a test

**File:** `src/lib/budget/second-wall.ts:23`; `tests/unit/second-wall-card.test.tsx:19-29, 128, 164`
**Issue:** The card test mocks the module with a getter and uses `'2026-09-25'`, so nothing pins that the real `'2026-09-24'` renders "Sep 24, 2026". If the value were malformed, `calendarDayLabel` (`second-wall-card.tsx:66`) would silently print it raw instead of failing. It is low risk because the string is a literal, but the value that actually shipped is untested.
**Fix:** Add one test that uses `vi.importActual('@/lib/budget/second-wall')`. Assert the value matches `/^\d{4}-\d{2}-\d{2}$/`, and that `SECOND_WALL_SET_BODY(calendarDayLabel(actual), SHIPPED)` contains `set on Sep 24, 2026` with the zone and locale pinned. Chicago must be half of a pair: one zone where the day stays Sep 24 and one where it would roll over.

---

_Reviewed: 2026-09-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep (delta)_
