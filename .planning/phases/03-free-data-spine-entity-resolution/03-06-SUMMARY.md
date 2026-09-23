---
phase: 03-free-data-spine-entity-resolution
plan: 06
subsystem: normalize
tags: [normalization, libphonenumber-js, usps, grep-gate, dedupe, DEDUP-04]
requires:
  - "03-01: libphonenumber-js 1.13.13 + the unaccent extension (migration 0021)"
provides:
  - "src/lib/normalize: nameNorm / nameNormDetail / foldDiacritics, phoneE164 / TOLL_FREE_NPAS, addressKey / USPS_ABBREVIATIONS"
  - "tests/unit/sql-never-normalizes.test.ts: the M24 target"
  - "tests/unit/no-network.test.ts: the T-3-14 CI-hygiene gate"
affects: [03-02, 03-10, 03-12, 03-13, 03-14, 03-18, resolver, blocker, scorer, ingest]
tech-stack:
  added: []
  patterns:
    - "TypeScript is the only normalizer; SQL compares stored values only"
    - "one shared foldDiacritics() for both the name key and the address key"
    - "grep gates are two-sided (a positive control proves the matcher fires) and report path:line"
key-files:
  created:
    - src/lib/normalize/name.ts
    - src/lib/normalize/phone.ts
    - src/lib/normalize/address.ts
    - src/lib/normalize/index.ts
    - tests/unit/normalize.test.ts
    - tests/unit/sql-never-normalizes.test.ts
    - tests/unit/no-network.test.ts
  modified: []
key-decisions:
  - "LIGATURES extended past the plan's table with the capitals and strokes that SQL folds (Þ Ð ẞ Ħ Ŧ Ŋ Ŀ and their lowercase forms). Each was measured on local PG 18.6; without them 'Þor' normalized to 'or'"
  - "The trailing phone-run strip works on a run of trailing digit TOKENS totalling 10 digits, or 11 with a leading 1. '956-263-1462' becomes three tokens once punctuation turns into spaces, so a single-token check would never fire on the plan's own example"
  - "hadStoreNumber is true for a stripped phone run AND for a kept trailing number ('SMARTSTYLE 8'). The digits are never guessed away, and the scorer still gets the flag the plan's purpose describes"
  - "no-network scans .json too, and allows the Socrata host in src/seed/data/ only on a \"source\": line. The provenance strings stay legal, and any other line in those files still goes red"
requirements-completed: [DEDUP-04]
duration: ~45min
completed: 2026-09-22
---

# Phase 3 Plan 06: The Normalization Module Summary

**TypeScript is now the only normalizer in the codebase. `nameNorm` (ligature fold, then NFD, then a token filter), `phoneE164` (libphonenumber-js, where a toll-free number is stored but never blockable) and `addressKey` (a table-driven USPS fold, with the suite taken out of the key but kept on the record) are pure and unit-pinned. Two grep gates hold the rules in place: SQL never normalizes, and CI never names a data host outside the allowed files.**

## Performance

- **Duration:** about 45 min
- **Tasks:** 3/3 (two of them TDD, each with a RED commit before GREEN)
- **Files:** 7 created, 0 modified

## Accomplishments

- **Parity with SQL, measured rather than assumed.** A read-only probe ran `lower(unaccent(...))` on the local test DB (`localhost:5432/siteless_test`, no migration) against the same strings the tests use. On `'Ørn Ærø Weiß Œil Łuk Đan Ikra Tıp Øðin Þor'` both sides produce `orn aero weiss oeil luk dan ikra tip odin thor`. The probe also re-measured `provolatile = s`.
- **Toll-free handling.** `8004879643` and `+18004879643` both become `+18004879643` with `blockable: false`. All seven NPAs are checked individually.
- **Address key.** `2426 E TYLER AVE STE 1C` becomes `{2426, 'e tyler ave', 'STE 1C', 78550}`. `E EXPRESSWAY 83` and Census's `E EXPY 83` produce identical keys. `P.O. Box` and `PO BOX` also match. `LOTUS DR` and `FLORIDA AVE` are not mistaken for units.

## Task Commits

1. **Task 1: nameNorm + phoneE164.** RED `7bee4e5` (test), GREEN `b152a8d` (feat)
2. **Task 2: addressKey + the full test table.** RED `bc60764` (test), GREEN `51d8f39` (feat)
3. **Task 3: the two grep gates.** `1224949` (test)

## Verification (every command run, output read)

| Check | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` (whole repo) | exit 0 |
| `npx vitest run tests/unit` | **23 files, 129 tests passed**. The base had 20 files and 81 tests at 03-01, and 21 files after 03-04 |
| The PASS list names each required test | `nameNorm …` (27 tests), `phoneE164 …` (5), `toll-free is not an identifier`, `suite stripped not lost`, `SQL never normalizes`, `CI never reaches the network`, `no google credential is read anywhere in src`, and both `no-internal-leak` tests |
| `grep "unaccent(" ` in both new gate files | no match; the token appears only as a constructed string |
| `grep -rn "app_name_norm\|immutable" src/lib/normalize/ drizzle/` | no wrapper. The only hits are `app.distance_m` in 0021, which is pure haversine and doesn't call the function, a note in 0008, and a comment in name.ts |
| Acceptance greps | `normalize('NFD')`, `.trim()` and `split(' ')` all match in name.ts. `'800','833',…,'888'` matches in phone.ts (see Deviations 4). `EXPRESSWAY: 'EXPY'` matches in address.ts. No `@/db`, `server-only` or `fetch(` under src/lib/normalize |
| `git diff --diff-filter=D 18d3e8f HEAD` | empty; nothing was deleted |

🔴 Following the prompt, test filtering used `npx vitest run <file> --reporter=verbose` and I read the test names. I never used `pnpm test:unit -- -t`, which does not filter under pnpm 12. The plan's `<verify>` lines use that no-op form.

### Mutation checks (each applied, run, and restored byte for byte; tracked files clean afterwards)

| Mutation | What went red, by name |
|---|---|
| **M16:** empty `TOLL_FREE_NPAS` | `phoneE164 toll-free parses but is not blockable` **and** `toll-free is not an identifier`. These are two independent tests, as the plan requires |
| Drop the 555 rejection | `phoneE164 rejects the 555 exchange` |
| Drop `country !== 'US'` | `phoneE164 rejects a non-US number` |
| No trailing phone-run strip | `nameNorm defect 3: a trailing phone run is stripped and flagged` + the Loro's table row |
| No LIGATURES fold | `nameNorm folds ligatures and strokes the way unaccent does` + 3 table rows |
| Strip all digits | `nameNorm defect 3: digits inside a name are kept` + 5 others |
| No kept-number flag | `nameNorm keeps a short store number but flags it for the scorer`, `… 12-digit trailing run …` |
| No stopword filter | `nameNorm defect 1`, `defect 2` + 7 others |
| Remove `trim()` **alone** | **still green**. See the note below |
| Remove the empty-token filter **alone** | **still green**. See the note below |
| Remove **both** | `nameNorm defect 1: no leading or trailing space` + 3 table rows |
| Keep the suite in street_norm | `suite stripped not lost`, `addressKey splits number, street, suite and ZIP` |
| Drop the suite from the record | the same two tests |
| No USPS folding | 3 addressKey tests |
| Drop the `EXPRESSWAY` row | `addressKey folds EXPRESSWAY the way the Census geocoder does`, `USPS_ABBREVIATIONS carries the committed minimum table` |
| No ZIP+4 truncation | `addressKey folds USPS suffixes and truncates ZIP+4` |
| Designator need not be a whole word | `addressKey does not mistake a street word for a unit` |
| Periods not deleted | `addressKey: a PO box has no street number` |
| No diacritic fold on addresses | `addressKey folds accents in street names` |
| **M24:** `similarity(unaccent(a.name_norm), …)` added to src/lib/normalize/name.ts, full unit suite | **only** `SQL never normalizes` (1 failed, 128 passed), with the offence reported as `src/lib/normalize/name.ts:162 …` |
| M24b: the same call appended to `drizzle/0020_*.sql` | only `SQL never normalizes` (`drizzle/0020_yellow_ricochet.sql:109`) |
| M24c: the token inside a `//` comment | **stays green**, as intended |
| Socrata host added to src/lib/normalize/phone.ts | only `CI never reaches the network` (`phone.ts:47 [data.texas.gov]`) |
| Census host added to a test outside msw | only `CI never reaches the network` |
| Seed-data `"source"` renamed to `"sourceUrl"` | only `CI never reaches the network` (`cities.json:6`) |
| Provenance exception removed | only `CI never reaches the network`, listing all 3 seed-data lines |
| census.ts dropped from the allow-list | only `CI never reaches the network` (`census.ts:37`) |

**About `trim()`:** the two surviving single mutations make the same point. `trim()` and the empty-token filter each guard the same edge, so neither can be killed alone. Removing both reds defect 1. Both stay in: the plan names `trim()` as the fix, and neither costs anything. The comment in name.ts records this result so nobody mistakes it for a dead guard.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1, Bug] The plan's LIGATURES table missed the uppercase forms SQL folds**
- **Found during:** Task 1 GREEN
- **Issue:** The table had `þ` and `ð` but not `Þ` and `Ð`, and it had none of `ẞ Ħ ħ Ŧ ŧ Ŋ ŋ Ŀ ŀ`. None of these decomposes under NFD. As a result `nameNorm('Þor')` returned `'or'`, silently dropping a letter, while SQL returns `thor`.
- **Fix:** Added those 11 characters. Every mapping was measured with a read-only `select unaccent(...)` on the local test DB. A test pins `'ÐAN ÞOR ẞAL Ħal Ŧam Ŋor Ŀuis'` → `'dan thor ssal hal tam nor luis'`, which is SQL's own output for that string.
- **Commit:** `b152a8d`

**2. [Rule 1, Bug] "Strip a trailing token that is a 10/11-digit run" can never fire on the plan's own example**
- **Found during:** Task 1
- **Issue:** Punctuation becomes spaces, so `956-263-1462` turns into three tokens (`956 263 1462`). A single-token test for a 10-digit run never matches it.
- **Fix:** Walk the trailing all-digit tokens and strip them when they total 10 digits, or 11 with a leading trunk `1`. The longest qualifying run wins, so `1-956-263-1462` goes whole. A store number in front of the phone (`Ollies 475 9562631462`) survives. A 12-digit run is left alone.
- **Commit:** `b152a8d`

**3. [Rule 2, Plan inconsistency] `hadStoreNumber` semantics**
- **Issue:** The plan says the flag is set "when a trailing all-digit token was removed", but only a phone run is ever removed. Under that reading `"SMARTSTYLE 8"` would report `false`, which defeats the stated purpose: "so the scorer can forgive `SMARTSTYLE 8` vs `Smartstyle`".
- **Fix:** The flag is also true when the kept name ends in an all-digit token. The digits stay in `norm`, because `"Studio 54"` is a name and not noise. The flag is pinned by `nameNorm keeps a short store number but flags it for the scorer`. No consumer exists yet: 03-02's scorer is where it gets read.

**4. [Formatting] `TOLL_FREE_NPAS` literal carries `// prettier-ignore`**
- Prettier would add spaces and break the plan's acceptance grep `'800','833','844','855','866','877','888'`. The line is ignored explicitly, with a comment saying why.

**5. [Rule 3, Orchestrator instruction] The no-network gate and seed-data provenance**
- **Issue:** `src/seed/data/{cities,clusters,outlet-counts}.json` cite `data.texas.gov` in `"source"` description strings. Those are provenance text, not requests. The orchestrator relayed this from 03-03.
- **Fix:** I kept `.json` in the scan rather than dropping it, and allowed the host in `src/seed/data/` only on a `"source":` line. Mutation-checked in both directions: renaming the key reds the gate, and removing the exception reds it with all three lines listed. The plan's allow-list is otherwise followed exactly: `src/lib/socrata/client.ts`, `census.ts`, `census-batch.ts`, and `tests/unit/msw/**`. `scripts/**` is not walked at all. I checked 03-03's merged tree (`d9161f0`): after merge its only host references are in allow-listed files and those three provenance lines.

**6. [Plan note] Test file split across Tasks 1 and 2**
- `tests/unit/normalize.test.ts` is listed under Task 2, but Task 1 is TDD and needs its tests first. Task 1 committed the name and phone half, and Task 2 appended the address half. Each task has its own RED commit.

**7. [Plan note] `foldDiacritics()` exported from name.ts**
- The address key needed the same accent fold (`Peñitas` → `penitas`). Rather than a second copy, name.ts exports the single implementation and address.ts imports it. The `normalize('NFD')` acceptance grep still matches in name.ts.

### Notes (no change made)

- **The `drizzle/0021_extensions.sql` allow-list entry is currently inert.** The migration spells `create extension if not exists unaccent;` with no paren, so removing that entry leaves the gate green. It stays because the plan names it and it costs nothing. It only matters if 0021 ever gains a call (it can't: 0021 is applied and must never be edited). **For 03-18:** add `src/server/queries/businesses.ts` to `ALLOWED` in the same commit as the predicate, as the test header says.
- **For 03-02 (score.test.ts):** that plan also names a test `toll-free is not an identifier`. The names are identical but the files differ. A `-t "toll-free is not an identifier"` filter will match both, which is fine, but read the file path in the PASS list.
- **`unit` is kept verbatim** (e.g. `STE 1C`, `#12`), matching D-12's "kept on the record". It is not uppercased or folded.

## Threat Flags

None. The files are pure string transforms and two read-only test walks. There is no new endpoint, I/O, auth path or schema change. T-3-11 (`name_norm`/`street_norm` never reaching a screen) is 03-05's registry, and the `no-internal-leak` tests still pass. T-3-03 holds: no regex is built from input, and the token filter is bounded. T-3-14 is now enforced by `CI never reaches the network`.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/normalize/{name,phone,address,index}.ts, tests/unit/normalize.test.ts, tests/unit/sql-never-normalizes.test.ts, tests/unit/no-network.test.ts
- FOUND commits: 7bee4e5, b152a8d, bc60764, 51d8f39, 1224949
- STATE.md / ROADMAP.md untouched
