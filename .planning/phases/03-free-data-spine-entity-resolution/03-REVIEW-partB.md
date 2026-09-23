---
phase: 03-free-data-spine-entity-resolution
slice: B (pure libraries)
reviewed: 2026-09-23T00:00:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - .gitattributes
  - .vercelignore
  - package.json
  - src/env.ts
  - src/lib/export/public-business.ts
  - src/lib/geocode/census-batch.ts
  - src/lib/ids/external-key.ts
  - src/lib/instant.ts
  - src/lib/normalize/address.ts
  - src/lib/normalize/index.ts
  - src/lib/normalize/name.ts
  - src/lib/normalize/phone.ts
  - src/lib/overture/transform.ts
  - src/lib/socrata/client.ts
  - src/lib/socrata/closures.ts
  - src/lib/socrata/permits.ts
  - src/lib/socrata/statewide-names.ts
  - src/lib/time.ts
  - src/seed/data/overture-categories.json
  - src/seed/types.ts
findings:
  critical: 1
  warning: 10
  info: 6
  total: 17
status: issues_found
---

# Phase 3: Code Review Report, Slice B (pure libraries)

**Reviewed:** 2026-09-23
**Depth:** standard, plus executed probes (`tsx` against the real modules) for every normalizer/parser claim below
**Files Reviewed:** 20
**Status:** issues_found

## Summary

These areas came out clean: the Socrata host/dataset/param guards, the county padding split (`031` for permits vs `31` for closures, both regex-pinned), NAICS as numeric range predicates, `$order` enforcement with unique sort keys at the callers, the Chicago reading of closure dates (probed under `TZ=UTC`: `1993-03-03` becomes `06:00Z`, a July date becomes `05:00Z`), the rule that Census rows are matched by ID with lng first and `Non_Exact` never promoted, the Crockford key (uniform `b % 32`, `getRandomValues`, the pattern matches the alphabet), `env.ts` (server-only, no NEXT_PUBLIC_, `||` empty-string handling), `time.ts`, `.vercelignore`, `.gitattributes`, and the seed map (70 unique categories, every `cluster_key` valid, nothing both mapped and decided-unmapped, row sums close).

The defects are in the **normalizers**, and they are behavioural. `nameNorm` deletes identity-carrying tokens. The address key throws the unit away and nothing downstream checks it again. The phone key drops extensions. Taken together, these let two distinct businesses in one strip mall reach score 95 and auto-merge. They also give independent businesses a false chain badge. Every finding below was reproduced by running the module, not by reading it.

## Critical Issues

### B-CR-01: `nameNorm` strips the single letters `l` and `c`, and `co`, anywhere in a name. Distinct businesses get identical keys and can auto-merge

**File:** `src/lib/normalize/name.ts:67-84` (the `LEGAL` set), used at `:143`
**Issue:** `'l'`, `'c'` and `'co'` are in `LEGAL` so that "L.L.C." folds away. The token filter runs at every position, though, not only on a trailing legal-form run. Probed:

| raw | name_norm |
|---|---|
| `C & L Plumbing` | `plumbing` |
| `L & C Tire Shop` | `tire shop` |
| `C&C Auto Repair` | `auto repair` (identical to `Auto Repair`) |
| `The L Bar` | `bar` |
| `Co-Op Feed` | `op feed` |

`name_norm` is the input to both the dedupe and the chain detector, so there are two ways this does damage:

1. **False auto-merge.** Take `L & C Auto Repair, STE 5` and `C & C Auto Repair, STE 7` at the same street number. The name similarity is 1.0, which gives 45. The suite is stripped from the address key (see B-WR-01), so the address scores 30 in full. Distance ≤100 m adds 15 and the same cluster adds 5, for **95**, with three independent signals. That is an auto-merge of two different businesses, and only the chain cap stops it, if three such names happen to exist.
2. **False chain badge.** `chain.ts` groups on `name_norm` equality, and `foldStatewideRows` sums raw names into the same key. Probed: `foldStatewideRows([C & L PLUMBING ×3, PLUMBING ×3])` gives `plumbing → 6`. An independent "C & L Plumbing" in the RGV is badged "Chain · 6 in Texas", and every legitimate merge for it is capped at 94.

The names this hits are initial-led ("C & L", "J.C.", "A&C"), which are very common among the RGV trades this product targets.
**Fix:** Strip legal forms only as a trailing run, and remove single letters only when they came from a dotted legal abbreviation. For example, collapse `l.l.c.` / `l l c` into `llc` before tokenising, then drop `LEGAL` tokens only from the end of the token list:
```ts
const LEGAL = new Set(['llc','inc','co','ltd','corp','dba','lp','llp','pllc','plc','incorporated','company','corporation']);
const pre = foldDiacritics(raw).toLowerCase()
  .replace(/\bl\.?\s*l\.?\s*c\b\.?/g, ' llc ')   // "L.L.C." / "L L C" → llc
  .replace(/\bl\.?\s*l\.?\s*p\b\.?/g, ' llp ')
  .replace(/[^a-z0-9]+/g, ' ');
let tokens = pre.split(' ').filter(Boolean).filter((t) => !STOP.has(t) && !TRADE.has(t));
while (tokens.length > 1 && LEGAL.has(tokens.at(-1)!)) tokens = tokens.slice(0, -1); // trailing only
```
Add named tests: `C & L Plumbing ≠ Plumbing`, `C&C Auto Repair ≠ Auto Repair`, `Co-Op Feed` keeps `co`. Because this changes stored keys, `name_norm` must be re-written for every row (re-run the transform) before the next resolve pass.

## Warnings

### B-WR-01: The suite/unit is removed from the key and nothing downstream compares it, so two tenants of one building score a full address match

**File:** `src/lib/normalize/address.ts:88-92` (consumed by `src/lib/resolve/score.ts:247-251`)
**Issue:** Probed: `1100 E EXPRESSWAY 83 BLDG A STE 5` and `1100 E EXPY 83 BLDG B STE 5` both come out as `{streetNum:'1100', streetNorm:'e expy 83'}`, with units `BLDG A STE 5` and `BLDG B STE 5`. `addressFull` compares only num + norm + postal, so a pair whose units are both known and different still gets the full 30 points and counts as an independent `address` signal. The header's rationale (keep the unit on the record so the detail view can tell tenants apart) protects the display, not the merge. B-CR-01 shows this path reaching 95.
**Fix:** Keep the unit out of the blocking key, but normalise it (`unitNorm`: upper-case, fold `SUITE`→`STE`, drop `#`/punctuation) and have the scorer deny `addressFull`, and the `address` signal, when both sides carry a unit and the normalised units differ:
```ts
if (present(a.unitNorm) && present(b.unitNorm) && a.unitNorm !== b.unitNorm) return w.addressNumPostal; // not full, not a signal
```
A named test: two suites at one street number never produce `signals` containing `'address'`.

### B-WR-02: Street names that start with a unit designator are parsed as units and `streetNorm` is lost

**File:** `src/lib/normalize/address.ts:61-62` (`UNIT_RE`)
**Issue:** Probed:
- `12345 RM 620 N` gives `streetNorm: null, unit: 'RM 620 N'`
- `100 LOT 5 RD` gives `streetNorm: null, unit: 'LOT 5 RD'`
- `1201 W UNIT RD` gives `streetNorm: 'w', unit: 'UNIT RD'`
- `500 N APT BLVD` gives `streetNorm: 'n'`
- `6 SPC ST` gives `streetNorm: null`

`RM` is Texas's Ranch-to-Market road prefix (RM 620, RM 1431, RM 2222). It is as common in central Texas as `FM` is in the RGV, and the project is scoped to scale to Texas. Every such address loses its street key: `streetNorm: null` makes `addressFull` impossible, so real duplicates on those roads never get the address signal. A key like `'w'` will also match any other `W …` street.
**Fix:** Remove `RM` from the designator list; `ROOM` is essentially never written `RM` in commercial addresses, and a Texas road prefix is. Refuse a unit match when the identifier is followed by a street-suffix token (`RD|ST|AVE|BLVD|DR|LN|…` or their long forms), or when the remainder before the match would be empty or a lone directional. Add the five probes above as table rows.

### B-WR-03: Phone extensions are silently dropped, so a shared switchboard becomes a trusted blocking identifier

**File:** `src/lib/normalize/phone.ts:37-44`
**Issue:** Probed: `(956) 423-1234 ext 12` and `956-423-1234 x5` both return `{e164:'+19564231234', blockable:true}`. The file's own reasoning is that a number shared across businesses (a switchboard) is not an identity. That is why toll-free numbers are excluded, and an explicit extension is direct evidence of the same thing. Two practices in one medical building on one PBX, with names at or above 0.6 similarity ("Garcia Family Dental" / "Garcia Pediatric Dental"), meet R3 (exact phone + same ZIP + name ≥0.6) and are lifted to **95**, an auto-merge.
**Fix:** Return `blockable: false` whenever `p.ext` is set, and keep `e164` for dialling:
```ts
return { e164: p.number, blockable: !TOLL_FREE_NPAS.has(npa) && !p.ext };
```
A named test: `'956-423-1234 x5'` is not blockable.

### B-WR-04: The Overture phone pick takes the first valid number even when it is toll-free, hiding a blockable local number behind it

**File:** `src/lib/overture/transform.ts:168` (mirrored in `src/lib/resolve/merge.ts:93-96`)
**Issue:** `phones.map(phoneE164).find(p => p.e164 !== null)` picks `+18004879643` (blockable `false`) from `['+18004879643', '+19564231234']`. The local number, which would have been the B1 blocking key and the R3 identifier, is never considered. Chain franchisees commonly list the corporate 800 number first. They then drop out of phone blocking entirely, while the stored/displayed phone is the corporate switchboard.
**Fix:** Prefer the first blockable key, and fall back to the first valid one:
```ts
const keys = phones.map((p) => phoneE164(p));
const phone = keys.find((k) => k.blockable) ?? keys.find((k) => k.e164 !== null) ?? NO_PHONE;
```
Apply the same change to `firstPhone` in `merge.ts` so survivorship and ingest agree. That second change is slice A's file, but it must change in lockstep.

### B-WR-05: Stripping trade words, combined with chain detection by name equality, flags unrelated independents as chains

**File:** `src/lib/normalize/name.ts:90, 143`, and `src/lib/socrata/statewide-names.ts:211-213`
**Issue:** Probed: `Taqueria Garcia` and `Garcia` both normalise to `garcia`. So do "Panaderia Garcia" and "Carniceria Garcia". Three unrelated family businesses sharing a surname are therefore flagged `chain_key='garcia'` (`chain.ts` counts `name_norm` equality ≥3), with the badge "Chain · 3 in Texas". Each also loses auto-merge (R2 cap 94) against its own true duplicate. In the RGV, surname-plus-trade names are the dominant naming pattern. D-12's trade-word strip makes sense for **similarity**, but it is wrong as an **identity** key for chain detection.
**Fix:** Give chain detection (and the statewide fold) a key that keeps trade words. For example, `nameNormDetail` returns `chainNorm` (legal suffixes and stopwords stripped, trade words kept), stored in its own column. Alternatively, do not flag a chain whose `name_norm` is a single token that was reached by removing a trade word.

### B-WR-06: `instantOf('')` returns 1970-01-01, the exact silent epoch the doc says it refuses

**File:** `src/lib/instant.ts:20-27`
**Issue:** `Number('')` and `Number('   ')` are `0`, which is finite, so the function returns `new Date(0)`. Probed: `instantOf('')` gives `1970-01-01T00:00:00.000Z`. `requireInstant` docs say "an empty value means the cast in the SELECT was forgotten … Rendering the epoch instead would be the product lying". An empty string is exactly the value it lets through.
**Fix:**
```ts
if (epochMs === null) return null;
if (epochMs.trim() === '') throw new Error('instantOf: empty string where epoch milliseconds were expected');
```
Add a test for `''`.

### B-WR-07: Census coordinate validation accepts a missing half as `0`

**File:** `src/lib/geocode/census-batch.ts:185, 195-208`
**Issue:** `f[5].split(',').map(Number)` turns an empty half into `0`, which passes `isFinite` and the ±90/±180 checks. Probed: a `Match` line with `"-97.6,"` returns `{kind:'Match', lat:0, lng:-97.6}`, and `","` returns `(0,0)`. The header promises "never as a `Match` carrying `undefined` or `NaN`"; a missing coordinate becomes a real point on the equator. That point is then written to `businesses.lat/lng`, and the 25 km rule marks the business `distinct` from everything.
**Fix:** Require non-empty numeric text for each half. Also bound the result to Texas (or at least `lat > 0 && lng < 0`), which also catches an axis swap more tightly than ±90:
```ts
const parts = f[5].split(',').map((s) => s.trim());
if (parts.some((s) => s === '' || !/^-?\d+(\.\d+)?$/.test(s))) return badShape(id);
const [lng, lat] = parts.map(Number);
if (!(lat > 25 && lat < 37 && lng > -107 && lng < -93)) return badShape(id);
```

### B-WR-08: One unparseable response line fails all 1,000 rows of its chunk, and retrying cannot help

**File:** `src/lib/geocode/census-batch.ts:284-292`
**Issue:** Any single `bad_shape` line (an unescaped `"` in the echoed input, which makes `parseQuotedCsvLine` return `null`, or a new status value) discards the whole response. The failure is deterministic, so all three attempts fail the same way (2 s + 8 s + three full uploads), and all 1,000 rows become `ChunkFailed`, unlocated. `csvField` doubles `"` in the request, but nothing guarantees the service escapes the echo in its response. One Comptroller address carrying a quote mark would cost ~1,000 geocodes on every run.
**Fix:** Salvage what can be salvaged. Keep every line that parses and names an expected ID. Mark only unparseable IDs `bad_shape`, identified by elimination against `expected`. Treat the chunk as failed only on a count mismatch or duplicate IDs. Also strip `"` from street/city in `csvField`, since it carries no geocoding meaning.

### B-WR-09: The closure schema requires `loc_name`, so a closed outlet with a blank or long name is never marked closed

**File:** `src/lib/socrata/closures.ts:300`
**Issue:** The D-03 closure match needs only `tp_number`, `loc_number` and `out_of_business_date`. The caller (`scripts/ingest-comptroller.ts:880-893`) never uses `legalName`. Even so, `loc_name: z.string().min(1).max(200)` makes a missing name (Socrata omits nulls) or a name over 200 characters reject the row. The business then stays `active` in the spine and is served as a live lead, which is exactly what D-03 exists to prevent. Rejections are only sampled, 10 at most, in the run stats.
**Fix:** `loc_name: z.string().max(500).optional()`, with `legalName: row.loc_name ?? null` in the source record. Validate what matters for the match, and keep everything else optional.

### B-WR-10: `PublicBusiness` is a type-only projection, and it omits `chainKey`, which is as internal as `name_norm`

**File:** `src/lib/export/public-business.ts:14-17, 26-57`
**Issue:**
1. The header says "the internal field is not on the value they are handed", but `Omit<>` removes nothing at runtime. A full Drizzle row (or `BusinessLike`) held in a variable is assignable to `PublicBusiness`, because excess-property checks apply only to object literals. A builder that spreads or `JSON.stringify`s its argument therefore emits `internalNotes`. The sentinel test only catches this if the fixture it feeds is the wide object and the builder is registered.
2. `chain.ts:13-17` states that `chain_key` is literally `name_norm` and "exactly as INTERNAL". `BusinessLike` does not declare `chainKey`, so it is neither omitted by the type nor canaried by `tests/unit/no-internal-leak.test.ts`. A builder handed the real row leaks the normalised match key under a different name.

**Fix:** Add a runtime projection and make the registry call builders only through it:
```ts
export function toPublicBusiness(b: BusinessLike): PublicBusiness {
  return { id: b.id, orgId: b.orgId, legalName: b.legalName, displayName: b.displayName,
           phoneE164: b.phoneE164, city: b.city, status: b.status };
}
```
Add `chainKey: string | null` to `BusinessLike` and to the omitted set, and add a `CHAIN_KEY` canary to the sentinel.

## Info

### B-IN-01: `hadStoreNumber` has no consumer, yet the doc says the scorer reads it

**File:** `src/lib/normalize/name.ts:94-101, 145-148`
**Issue:** `grep -rn hadStoreNumber src scripts` finds nothing outside `name.ts`. The "smartstyle 8 vs smartstyle" forgiveness the comment promises does not exist. It also sets `true` for `Route 66` and `Studio 2025`.
**Fix:** Either wire it into `score()` (and persist it), or delete the field and correct the comment.

### B-IN-02: `UNIT_RE` is quadratic on runs of commas/whitespace, and Overture `freeform` has no length cap

**File:** `src/lib/normalize/address.ts:61-62`, and `src/lib/overture/transform.ts:73`
**Issue:** Probed: `'1 ' + ', '.repeat(20000) + 'X'` takes **2.7 s** in `addressKey`. Comptroller addresses are capped at 200 by zod; the Overture `street` is `z.string().nullable()` with no max. This is not exploitable at realistic lengths, but it contradicts the T-3-12 linearity claim.
**Fix:** Add `street: z.string().max(300).nullable()` in the Overture schema, and/or collapse `[\s,]+` runs before matching.

### B-IN-03: Missing folds that matter for RGV addresses

**File:** `src/lib/normalize/address.ts:26-53, 64`
**Issue:** Probed: `W BUSINESS 83` gives `w business 83`, but `W BUS 83` gives `w bus 83`. Business 83 runs through every RGV city. `FARM TO MARKET 1015` is not folded to `fm 1015`, and `N FIRST ST` gives `n first st` while `N 1ST ST` gives `n 1st st`. `123A MAIN ST` gives `streetNum: null, streetNorm: '123a main st'`, while `123 A MAIN ST` gives `'123'` / `'a main st'`. Each of these silently zeroes the address signal for a true duplicate.
**Fix:** Add `BUSINESS→BUS`, the multi-token `FARM TO MARKET`/`FARM-TO-MARKET`→`FM` (fold before tokenising), and ordinal words→`1ST…`. Let `LEADING_NUMBER` accept `^(\d+)([A-Z])?\b` and fold the letter into the unit.

### B-IN-04: One malformed statewide group throws away the whole chain map

**File:** `src/lib/socrata/statewide-names.ts:192, 210`
**Issue:** `groupRowSchema.parse` throws on a single `outlet_name` over 200 characters, so the entire 11,647-name map is lost for that run, and the run falls back to the last good one. This is by design ("throws rather than silently shrinking"), but a name-length limit is not a shape violation.
**Fix:** Raise `max` to e.g. 500. Alternatively, skip-and-count oversize names in the returned stats.

### B-IN-05: `socrataCount` returns `NaN` without checking it

**File:** `src/lib/socrata/client.ts:169-171`
**Issue:** `Number(n)` on a non-numeric `n` returns `NaN` into the seed counts.
**Fix:** `const v = Number(n); if (!Number.isInteger(v) || v < 0) throw …`.

### B-IN-06: Short NAICS codes pass validation but can never be clustered

**File:** `src/lib/socrata/permits.ts:58, 87-94`
**Issue:** The regex accepts 2–6 digits, but the cluster ranges are 6-digit (`812100–812200`). A 4-digit `8121` compares as `8121` and lands in no cluster, silently, and the numeric `$where` has the same blind spot. Whether short codes exist in `jrea-zgmq` was not measured.
**Fix:** Either restrict the regex to `^\d{6}$` so a short code shows up as a rejection, or right-pad to 6 digits before `clusterFor` and count how many were padded in the run stats.

---

_Reviewed: 2026-09-23_
_Reviewer: Claude (gsd-code-reviewer), slice B_
_Depth: standard_
