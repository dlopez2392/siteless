---
phase: 03-free-data-spine-entity-resolution
slice: B (pure libraries)
fixer: B of three (parallel worktrees)
fixed_at: 2026-09-23T00:00:00Z
review_path: .planning/phases/03-free-data-spine-entity-resolution/03-REVIEW-partB.md
iteration: 1
findings_in_scope: 11
fixed: 9
skipped: 2
status: partial
---

# Phase 3: Code Review Fix Report, Slice B (fixer B)

**Fixed at:** 2026-09-23
**Source review:** .planning/phases/03-free-data-spine-entity-resolution/03-REVIEW-partB.md
**Iteration:** 1
**Base:** `e9bbed5`. Branch `worktree-agent-a52e8c5980a75aace`, 9 commits, not pushed.

**Summary:**
- Findings in scope (critical + warning): 11
- Fixed here: 9. B-WR-05 is fixed for its name half only; its chain.ts half went to fixer A.
- Routed to fixer A: 2 (B-WR-01, B-WR-04), plus the chain.ts half of B-WR-05
- Info findings (B-IN-01…06): out of scope (`critical_warning`)

**Gates on the final tree (`bf93e42`):** `vitest run tests/unit` 43 files / 310 tests green (baseline 42 / 298); `pnpm typecheck` 0; `pnpm lint` 0; prettier clean on every touched file.
**Not run:** the `tests/db` lane. The local database is shared with fixers A and C and holds danlo's real spine, and I was told to use it read-only. I checked `tests/db` by grep: no assertion depends on a changed key. Its name lists (`blocking.test.ts`, `resolve-pass.test.ts`) are stored `name_norm` literals, not normalizer output.

**Proof standard:** each finding has a named test. I watched it fail by name before the fix. For the mutation check I reverted the source (`git checkout --` of the fixed file), confirmed the named test went red, restored the file, and confirmed `git diff` was back to the fix only. Every filtered run used `npx vitest run <file> -t "<id>" --reporter=verbose`, and I read the test name from the output.

## 🔴 Stored keys that change (existing rows need fixer A's re-derivation)

I wrote no migrations and no backfills. These normalizer changes alter derived columns on rows already in the spine:

| Column | Finding | Inputs whose key changes | Example old → new |
|---|---|---|---|
| `name_norm` | B-CR-01 | any name with a single-letter `l` or `c` token that is not part of a trailing dotted legal form (initials, `A/C`) | `C & L Plumbing`: `plumbing` → `c l plumbing`; `GARCIA A/C & HEATING`: `garcia a heating` → `garcia a c heating`; `The L Bar`: `bar` → `l bar` |
| `name_norm` | B-CR-01 | a legal word (`co inc llc ltd corp lp llp pllc plc company corporation incorporated`) that is NOT in the trailing run | `Co-Op Feed`: `op feed` → `co op feed`; `Acme Corp of Texas`: `acme texas` → `acme corp texas` |
| `name_norm` | B-CR-01 | a trailing `L.P.` / `L.L.P.` / `P.L.L.C.`, which used to leave a stray letter | `Smith Partners L.P.`: `smith partners p` → `smith partners`; `Smith Law P.L.L.C.`: `smith law p` → `smith law` |
| `name_norm` | B-WR-05 | a trade word (`taqueria carniceria panaderia`) plus exactly ONE identity token (two or more letters, or a number) | `Panadería Méndez`: `mendez` → `panaderia mendez`; `La Taqueria De Guanajuato`: `guanajuato` → `taqueria guanajuato`; `Garcia's Taqueria`: `garcia s` → `garcia s taqueria` |
| `chain_key` | follows `name_norm` | recompute after `name_norm` is re-derived (it IS `name_norm`) | |
| `ingest_runs.stats → statewide_name_frequency` | follows `name_norm` | keyed by `nameNorm(outlet_name)`, so the last good map is keyed by the OLD normalizer until the next Comptroller run rewrites it | |
| `street_norm`, `street_num`, `unit` | B-WR-02 | a unit-designator word (`STE SUITE UNIT APT BLDG RM SPC LOT FL #`) directly after the house number or after a lone directional, or one whose identifier or next token is a street type | `12345 RM 620 N`: `null` / unit `RM 620 N` → `rm 620 n` / no unit; `1201 W UNIT RD`: `w` → `w unit rd` |
| `phone_blockable` | B-WR-03 | a raw phone carrying an extension (`x5`, `ext 12`). `phone_e164` is unchanged. | `956-423-1234 x5`: blockable `true` → `false` |

Unchanged: names with no legal, initial or trade-word edge; a trailing `LLC`/`Inc`/`Co`/`L.L.C.` run (it still strips); `DBA` (it still separates two names, and each name strips its own tail).

Test fixtures: `tests/unit/fixtures/merge-pairs.json`, `merge-triple.json` and `tests/unit/score.test.ts` were **not touched**. I ran a one-off script (deleted afterwards) that recomputed `nameNorm(sourceName)` for every fixture side after each normalizer commit. Every result matched the stored `nameNorm`, so no pair score moved.

## Fixed Issues

### B-CR-01: `nameNorm` strips `l`, `c`, `co` anywhere

**Files modified:** `src/lib/normalize/name.ts`, `tests/unit/normalize.test.ts`
**Commit:** `446fa04`
**Applied fix:** I removed `l` and `c` from `LEGAL`. Legal forms now strip only as a trailing run (`stripTrailingLegal`). Dotted forms match only as whole trailing sequences: `l l c`, `l l p`, `p l l c`, `l p`. A `dba` token splits the name into segments and each segment strips its own tail. A legal form ahead of a trailing phone run is stripped again once the phone is removed.
**Named tests:** `nameNorm B-CR-01: initials are identity, not legal suffixes` (C & L Plumbing ≠ Plumbing, C&C Auto Repair ≠ Auto Repair, L & C ≠ C & C), `nameNorm B-CR-01: co is kept when it is not a trailing legal form` (`Co-Op Feed` → `co op feed`), `nameNorm B-CR-01: a trailing legal run still strips` (Smith Co / Co Inc / Co., Inc. / L.L.C. / L L C / , LLC / L.P. / P.L.L.C. / LLC + phone / … DBA C & L Plumbing).
**Existing 03-06 tests:** all green with unchanged expectations. I edited one comment in the ligature test because it had claimed a lone `l` is a legal token. SQL parity: `sql-never-normalizes.test.ts` is green, and no SQL was touched.
**Mutation:** reverting `name.ts` turned all three named tests red, and restoring it turned them green.
**Known edge:** a name that genuinely ends in the initials `L P` ("Tire Shop L & P") now loses them as a trailing `L.P.`. The only way to tell the two apart is the raw punctuation, which the tokenizer discards.

### B-WR-05 (name half): trade-word strip collapses family businesses into one key

**Files modified:** `src/lib/normalize/name.ts`, `tests/unit/normalize.test.ts`
**Commit:** `55f1858`
**Applied fix:** `dropTradeWords` drops the trade words unless that would leave exactly ONE identity token (a word of two or more letters, or a number). When none would be left, the words are dropped as before and the name gets no key. When two or more are left, they are dropped as before, which keeps D-12's similarity lift (`Taqueria Jalisco Express` still equals `Jalisco Express`). I chose this over "stop stripping trade words entirely" because it changes the fewest keys and keeps D-12 intact for every name that has its own identity. It changes only the surname-plus-trade shape the review measured as dominant. A single token is the right bar because `garcia`, `mendez` or `guero` alone is what collides across unrelated families. A lone letter (the `s` a possessive leaves) does not count, so `Garcia's Taqueria` stays apart from `Garcia's Panaderia`. `hadStoreNumber` is read from the tokens with the trade words removed, so a kept trade word never hides a trailing number.
**Changed expectations (explained):** three rows of the 03-06 table and the defect-1 test. `Panadería Méndez` → `panaderia mendez`, `Carnicería El Güero` → `carniceria guero` and `La Taqueria De Guanajuato` → `taqueria guanajuato` are each one surname plus a trade word, which is exactly the shape B-WR-05 protects. Defect 1 still guards the leading space: the leading `La` still goes, and the test still asserts no leading or trailing space.
**Named test:** `nameNorm B-WR-05: a trade word stays when it is all that tells two family businesses apart`
**Mutation:** reverting `name.ts` to the B-CR-01 state turned the named test red, and restoring it turned it green.
**Routed:** the chain.ts half (a trade-keeping chain key, or not flagging a single-token trade-stripped key) belongs to fixer A.

### B-WR-02: street names that start with a unit designator are parsed as units

**Files modified:** `src/lib/normalize/address.ts`, `tests/unit/normalize.test.ts`
**Commit:** `0e39966`
**Applied fix:** `UNIT_RE` is now `UNIT_CANDIDATE` (global), and `isUnit` rejects a candidate in two cases. The first is when the street before it, minus the house number, is empty or a lone directional. The second is when its identifier, or the token right after it, is a street type (short or long form, derived from `USPS_ABBREVIATIONS`). The first accepted candidate wins, so `12345 RM 620 N STE 5` gives street `rm 620 n` and unit `STE 5`. I did not follow the review's first suggestion to remove `RM` from the designators. The two guards alone fix all five probes, and removing `RM` would have changed the existing pinned `2426 E TYLER AVE RM 3` → unit `RM 3` row in `suite stripped not lost`, where `RM` really is a room behind a real street.
**Named test:** `addressKey B-WR-02: a road that starts with a unit word is a street, not a unit` (the five probes from the review, plus a real suite after an RM road).
**Mutation:** reverting `address.ts` turned the named test red, and restoring it turned it green.
**Heads-up for fixer A (B-WR-01):** fixer A may add a `unitNorm` in its own files. `addressKey`'s return shape is unchanged here.

### B-WR-03: phone extensions dropped, so a shared switchboard is blockable

**Files modified:** `src/lib/normalize/phone.ts`, `tests/unit/normalize.test.ts`
**Commit:** `4394609`
**Applied fix:** `blockable: !TOLL_FREE_NPAS.has(npa) && !p.ext`. `e164` is still returned for dialling.
**Named test:** `phoneE164 B-WR-03: a number with an extension is dialable but not blockable` (`x5`, `ext 12`, `ext. 12`, plus a positive control with no extension).
**Mutation:** reverting `phone.ts` turned the named test red, and restoring it turned it green.

### B-WR-06: `instantOf('')` returns 1970-01-01

**Files modified:** `src/lib/instant.ts`, `tests/unit/instant.test.ts` (**new file**; `instant.ts` had no unit test)
**Commit:** `9fd2902`
**Applied fix:** `instantOf` throws on an empty or whitespace-only string. `requireInstant` inherits the refusal. `'0'` is still the epoch.
**Named test:** `instantOf B-WR-06: an empty string is refused, not the epoch`
**Mutation:** reverting `instant.ts` turned only the named test red (the positive-control test stayed green), and restoring it turned it green.

### B-WR-07: Census coordinate validation accepts a missing half as `0`

**Files modified:** `src/lib/geocode/census-batch.ts`, `tests/unit/census-batch.test.ts`
**Commit:** `4a42b7e`
**Applied fix:** each half of `"lng,lat"` must match `^-?\d+(\.\d+)?$` after trimming. The point must also fall inside a Texas box (lat 25–37, lng −107 to −93). Every row is sent as `TX`, so a point outside Texas is a defect, and the box also catches an axis swap more tightly than ±90/±180.
**Named test:** `census batch B-WR-07: a half-missing coordinate is bad_shape, never a point on the equator`. It builds on the recorded Harlingen `Match` line: `"-97.67,"`, `",26.18"`, `","`, `" , "` and `"-97.67, "` each give `bad_shape`, and so do `0,0` and a southern-hemisphere point. As a positive control, the untouched field still parses to the exact recorded point.
**Mutation:** reverting `census-batch.ts` turned the named test red, and restoring it turned it green.
**Follow-up:** these fixes protect future ingests only. A read-only query for `lat = 0 or lng = 0` on the geocoded rows would show whether any past run stored an equator point.

### B-WR-08: one unparseable response line fails the whole chunk, three times

**Files modified:** `src/lib/geocode/census-batch.ts`, `tests/unit/census-batch.test.ts`
**Commit:** `bf6e0f9`
**Applied fix:** `postChunkOnce` keeps every parsed line that names an expected ID. Unparseable lines are set aside, and their rows are found by elimination (the line count already matches, and the parsed IDs are distinct and expected). Those rows are marked `ChunkFailed/bad_shape` and returned as success, so a deterministic parse failure is not retried. The whole chunk still fails, and is retried, on a count mismatch, a duplicated or unknown ID, or a response in which no line parses at all. `csvField` now drops `"` instead of doubling it, and the header's success definition is updated. The quote-doubling code would have been dead, since IDs cannot carry a quote (`ID_SHAPE`).
**Named test:** `census batch B-WR-08: one unparseable line fails only its own row, and is not retried`. It serves the recorded `shuffled` body with one line cut mid-quote and one line given an unknown status, and checks five things. First, one request is made, not three. Second, exactly those two IDs are `bad_shape`. Third, every other row equals the clean replay. Fourth, a duplicated ID still fails every row. Fifth, a `"` in the street or city never reaches the request CSV.
**Mutation:** reverting `census-batch.ts` turned the named test red, and restoring it turned it green.

### B-WR-09: closure schema requires `loc_name`

**Files modified:** `src/lib/socrata/closures.ts`, `tests/unit/socrata.test.ts`
**Commit:** `380b861`
**Applied fix:** `loc_name: z.string().max(500).optional()`. `ClosureSourceRecord.legalName` is now `string | null`, and null when the name is absent or blank. Neither consumer reads a non-null `legalName`: `scripts/ingest-comptroller.ts` never uses it, and `merge.ts` reads `str(p.loc_name)`, which tolerates `undefined`. `tsc` is green.
**Named test:** `closure row B-WR-09: a blank, missing or long loc_name still marks the outlet closed`. It uses a recorded `3kx8-uryv` row with the name missing, blank or 300 characters long. Each parses and keeps key `32006197027-1` and `closedAt` `2022-12-31T06:00Z`. A missing name gives a `null` legalName, and an empty `loc_number` is still refused.
**Mutation:** reverting `closures.ts` turned the named test red, and restoring it turned it green.
**Effect on the next run:** closure rows the old schema rejected will now be accepted and will set `closed_at` on the next closures run.

### B-WR-10: `PublicBusiness` is type-only and omits `chainKey`

**Files modified:** `src/lib/export/public-business.ts`, `src/lib/export/registry.ts`, `tests/unit/no-internal-leak.test.ts`, `tests/unit/fixtures/business.ts`
**Commit:** `bf93e42`
**Applied fix:** `toPublicBusiness(b)` picks the seven public fields by name, and `PUBLIC_BUSINESS_KEYS` is the runtime whitelist (`satisfies keyof PublicBusiness`). `buildPayload(builder, row)` in the registry is now the one way to run a builder: it hands the builder the projection, never the row. `chainKey: string | null` is added to `BusinessLike` (the Drizzle bridge in `businesses.ts` still holds), to the `Omit<>`, and to the compile-time `InternalKeysOmitted` check. `chainKey` and `chain_key` are added to `INTERNAL_KEY_NAMES`, and a `CHAIN_KEY_CANARY` is added to the fixture. The existing sentinel now runs registered builders through `buildPayload` with the WIDE fixture. It also asserts that the projection equals the hand-written public literal.
**Named test:** `B-WR-10: builders are handed a runtime projection, so even a spreading builder cannot leak`. A careless `({ ...b })` builder is fed a wide row that carries every canary plus an undeclared column. The test asserts that no canary, no internal key name and no undeclared column appears in the output, that `Rio Roofing` does appear, and that the projection's keys are exactly the whitelist.
**Watched fail first:** `TypeError: buildPayload is not a function`, reported under the test's name.
**Mutation:** two checks. Making `toPublicBusiness` return its argument turned both the named test and the sentinel red. Reverting both source files turned both red. Restoring turned everything green.

## Skipped Issues

### B-WR-01: suite/unit removed from the key and never compared

**File:** `src/lib/normalize/address.ts:88-92` (consumed by `src/lib/resolve/score.ts:247-251`)
**Reason:** routed to fixer A. The scorer's unit comparison lives in `src/lib/resolve/score.ts`, which is outside this fixer's allowed files.
**Original issue:** two tenants of one building score a full 30-point address match and an independent `address` signal.

### B-WR-04: Overture phone pick takes the first valid number even when toll-free

**File:** `src/lib/overture/transform.ts:168` (mirrored in `src/lib/resolve/merge.ts:93-96`)
**Reason:** routed to fixer A. Both files are fixer A's, and they must change in lockstep.
**Original issue:** a toll-free number listed first hides a blockable local number from phone blocking.

### B-WR-05 (chain.ts half)

**File:** `src/lib/resolve/chain.ts`, `src/lib/socrata/statewide-names.ts:211-213`
**Reason:** routed to fixer A (chain detection). The name half is fixed above (`55f1858`).

---

_Fixed: 2026-09-23_
_Fixer: Claude (gsd-code-fixer), fixer B_
_Iteration: 1_
