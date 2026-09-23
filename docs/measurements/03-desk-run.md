# 03 desk run — the first full ingest of the RGV spine

The first real run of `docs/runbooks/ingest.md`. Both ingests and the resolve pass ran against the
live sources and wrote into the **local test database** (`siteless_test`, `--target=test`).
Production was not touched. It gets this run in plan 03-21, behind danlo's go-ahead.

- **Date:** 2026-09-22 (America/Chicago). Instants below are UTC, 2026-09-23T03:10Z–04:40Z.
- **Overture release:** `2026-08-19.0`. It was the only prefix under `release/`, listed by the
  script at 2026-09-23T03:11Z. `2026-09-23.0` had not landed yet.
- **Socrata `rowsUpdatedAt`:** `jrea-zgmq` (permits) `2026-09-19T08:05:21.000Z` · `3kx8-uryv`
  (closures) `2026-09-21T15:48:35.000Z`.
- **Census benchmark:** `Public_AR_Current`.

Every number below came from a query or a script's own output on this run. Where a number
differs from 03-RESEARCH, the difference and its likely cause are written next to it.

---

## The org, and how it was chosen

`clerk_org_id = org_3Jf2trxDQzIC3yX4sgZki3kE3ky` → `orgs.id = e84528f7-224a-454c-8b10-a04c38381577`.

- The local `orgs` table held two rows: `org_concurrency_fixture` (a Phase 2 test fixture) and
  `org_3Jf2trxDQzIC3yX4sgZki3kE3ky`. The second was created by the app on 2026-09-22T15:52Z,
  `display_name` `bis-1790038019758308742`.
- A **read-only** `GET /v1/organizations` on the Clerk **dev** instance (`sk_test_…`) returned
  exactly one organization: `org_3Jf2trxDQzIC3yX4sgZki3kE3ky`, name **BIS**, 1 member, created
  2026-09-22T00:46:59Z. That is danlo's org. No row was inserted by hand, and nothing was written
  to Clerk or to production.

## Step 1a — the org-context preflight (run 2026-09-23T03:10:58Z, before anything else)

`psql` is not on `PATH` here, so the runbook's SQL ran unchanged through Node `pg` on the same
connection string:

```
BEGIN
set_config  'etl:preflight'
set_config  '{"o" : {"id" : "org_3Jf2trxDQzIC3yX4sgZki3kE3ky"}}'
org_id      'e84528f7-224a-454c-8b10-a04c38381577'
ROLLBACK
```

**Non-null, and equal to `orgs.id`.** The resolve script's own stage 0 repeated it on both
passes: `stage 0 preflight ok — org org_3Jf2trxDQzIC3yX4sgZki3kE3ky → e84528f7-…`.

---

## Wall clock, per stage

| Stage | Wall clock | Researched |
|---|---|---|
| `tx_comptroller` permits: fetch + 34,928 row-by-row writes | **176.9 s** | fetch ~2.5 s |
| `census_geocoder`: batch geocode (~8.5 min network) + 27,903 writes | **560.9 s** | ~6–8 min |
| `tx_comptroller_closures`: fetch + 21,509 writes | **15.3 s** | — |
| Comptroller script total | **766.1 s** | — |
| `overture`: bbox read | **11.7 s** (98,960 rows) | ~9.5 s |
| `overture`: transform + 56,944 writes | **318 s** total (run row 302.4 s) | — |
| resolve `--dry-run` | **742.5 s** (block 725.3 s · chains 8.2 · score 8.1 · gate 0.8) | ~2 min |
| resolve (real) | **718.8 s** (block 344.7 · **merge 369.8** · score 3.0 · chains 0.7 · gate 0.6) | ~2 min |

**From cold:** about **30 minutes** without the dry run, or **42 minutes** with it. The plan
estimated ~20. Two stages account for the difference:

1. 🔴 **B3 (the trigram lateral) takes 6–12 minutes, not 70 s.** The plan guard passed
   (`trigram_plan: gin`). The research probed the 34,928 Comptroller rows against an
   Overture-only table. B3 as built probes **every live row (~90k) against every other row in its
   ZIP**, intra-source included, and produces **51,664** trigram pairs. A 500-probe
   `EXPLAIN ANALYZE` took 4.7 s, about 9 ms per probe. The plan uses `businesses_name_trgm`
   (≈168 rows per probe) but BitmapANDs it with `businesses_addr_idx`, which returns every row in
   the ZIP (≈4,080 per probe). The re-run took 345 s because it inserted nothing.
2. 🔴 **The merge stage is 343 ms per merge** (1,077 merges in 369.8 s). This is the per-merge org
   scan 03-14 predicted (`merge.ts` `readParents`, `coalesce(merged_into_id, id) = $1`, which no
   index serves). It is correct, just slow. The fix 03-14 named, `id in (…) or merged_into_id in (…)`,
   would make stage 5 roughly seconds.

The per-row write path is ~110–200 rows/s on the local database. Production adds a network round
trip per statement (03-12 estimated 1.5–2 h for the Comptroller script there).

---

## Run 1 — per source

| Source | added | changed | unchanged | gone | total_seen | Duration | Researched |
|---|---|---|---|---|---|---|---|
| `tx_comptroller` | 34,928 | 0 | 0 | 0 | 34,928 | 176.8 s | **34,928** ✅ exact |
| `census_geocoder` | 27,903 | 0 | 0 | 0 | 27,903 | 560.9 s | ~24,800 (70.9 %) |
| `tx_comptroller_closures` | 21,467 | **42** | 0 | 0 | 21,509 | 15.3 s | **21,509** ✅ exact |
| `overture` | 56,944 | 0 | 0 | 0 | 56,944 | 302.4 s | **56,944** ✅ exact |

### 🔴 The `changed 42` on a first run was a defect, found here and fixed (`6e40f77`)

`3kx8-uryv` sends **21,509 RGV rows over only 21,467 distinct `tp_number-loc_number` keys**: 18
keys cover 60 rows, differing in `out_of_business_date`. One outlet, `17426217984-1`, carries
nine quarterly dates. The ingest wrote row by row, so a repeated key overwrote its own payload
inside one run. `$order=tp_number,loc_number` does not order rows **within** a key, so the payload
that survived depended on Socrata's order. A second run could never report `unchanged` for those
keys, which breaks DATA-04.

**Fix:** `foldClosureDuplicates` keeps one record per key: the latest date (the same rule
`CLOSURE_UPDATE_SQL` uses), with the payload JSON as the tie-break, so the result depends on the
**set** of rows and not their order. The closures run now reports
`stats.duplicate_keys` / `duplicate_rows_folded`. Two unit tests cover it, and each is killed by
its own mutation.

**Settle run** (the Comptroller script again, after the fix, 2026-09-23T03:30:45Z, 501.2 s):
permits `0 / 0 / 34,928 unchanged` · geocode `0 / 0 / 27,903 unchanged` · closures
`0 added / 13 changed / 21,454 unchanged`, seen 21,467. The 13 are the keys whose run-1 payload
was not the latest date. One `closed_at` moved to its later date. This is the one-time migration
of the stored payloads to the folded form. **The second run below is the clean proof.**

### Census geocoder

| submitted | matched | exact | non_exact | tie | no_match | chunks_failed | locations_written |
|---|---|---|---|---|---|---|---|
| 34,928 | **27,903 (79.9 %)** | 19,648 | 8,255 | 136 | 6,889 | 0 | 27,903 |

**Divergence: +9.0 points above the researched 70.9 %.** 7,025 permits stay unlocated (No_Match
plus Tie), against the ≈10,100 researched. The cause is likely the research's smaller probe sample
or a newer benchmark. It is not a defect: every Match wrote exactly one location, and no chunk
failed. Note that **8,255 are `Non_Exact`**, which the scorer never promotes (03-02). Only 19,648
Comptroller rows (56.3 %) carry a location that can satisfy the geo gate.

### Comptroller permits

- `unmapped_naics` **10,950** of 34,928 (31.4 %). These rows are in the spine with
  `cluster_key` NULL and never enter the funnel (D-02).
- `city_unfolded` 3,168: `outlet_city` spellings with no `cities.name_variants` match. They keep
  the raw spelling.
- `rejected_rows` 0.
- Statewide chain names (D-11): **11,116** `name_norm` keys covering 82,297 outlets with ≥3 per
  raw spelling. 03-12 measured 11,647 raw-spelling groups, and `nameNorm` folds them to 11,116.

### Closures

- 21,509 rows / 21,467 keys, 0 rejected.
- **6 businesses closed** by exact key (0 via a merge winner). Only 6 of 34,928 active permits
  share a key with the out-of-business feed, which is expected: a closed outlet is normally not an
  active permit. The 6 carry closure dates from 2023–2025 while still listed active. That is the
  Comptroller's data, and D-03 writes it as it arrives.

### Overture

- bbox read **98,960** ✅ → Texas side **56,944** ✅ → `not_texas` **42,016** (42.5 %),
  `no_name` 0, `malformed` 0.
- **Not a data divergence:** research quoted 41,532 (42.0 %) "Mexican-side", but
  98,960 − 56,944 = 42,016, and the transform counts every non-TX/US row as `not_texas`. The
  484 difference is `not_texas` rows that the research did not count as Mexican-side: US rows in
  another state or with no region (03-13 counted 180 of the latter). This run did not break the
  484 down further.
- `permanently_closed` **863** ✅ exact. Stored, never used as `closed_at` (D-03).
- `basic_category` NULL **1,223** ✅ exact.
- Mapped **32,890 (57.8 %)** ✅, the 03-08 figure. Unmapped **22,831** rows in 174 values (below).

---

## The Overture confidence distribution (D-04)

Rows per 0.1 band, Texas side, from `businesses.confidence`. They match the `ingest_runs.stats`
`confidence_bands` and match 03-RESEARCH **row for row**:

| Band | Rows | Share | Researched | No website | In a cluster | No website **and** in a cluster | Junk proxy¹ |
|---|---|---|---|---|---|---|---|
| 0.0–0.1 | 292 | 0.5 % | 292 | 53.1 % | 46.6 % | 79 | **58.2 %** |
| 0.1–0.2 | 537 | 0.9 % | 537 | 50.5 % | 49.7 % | 153 | **25.3 %** |
| 0.2–0.3 | 1,851 | 3.3 % | 1,851 | 51.5 % | 55.2 % | 565 | 6.0 % |
| 0.3–0.4 | 1,982 | 3.5 % | 1,982 | 49.7 % | 50.2 % | 542 | 3.4 % |
| 0.4–0.5 | 1,501 | 2.6 % | 1,501 | 46.4 % | 48.0 % | 378 | 3.3 % |
| 0.5–0.6 | 3,075 | 5.4 % | 3,075 | 57.3 % | 59.0 % | 1,110 | 6.8 % |
| 0.6–0.7 | 3,298 | 5.8 % | 3,298 | 54.9 % | 58.4 % | 1,160 | 4.7 % |
| 0.7–0.8 | 3,973 | 7.0 % | 3,973 | 42.6 % | 55.1 % | 986 | 12.8 % |
| 0.8–0.9 | 4,920 | 8.6 % | 4,920 | 33.6 % | 47.8 % | 915 | 6.0 % |
| 0.9–1.0 | 35,515 | 62.4 % | 35,270 + 245 (=1.0) | 28.3 % | 60.5 % | 6,827 | 1.5 % |
| **Total** | **56,944** | | 56,944 | | | | |

¹ **Junk proxy:** no street, or a postcode that is missing or outside `785xx`. It stands in for
"not a real RGV business at a real address", and the human read is in § Confidence sample.

**What the numbers say:**

- Junk rises sharply **below 0.2** (25 % and 58 %). **0.3–0.5 is as clean as 0.5–0.9.**
- The low bands are **disproportionately the product's target.** About half of every band below
  0.7 has no website, against 28 % at ≥ 0.9.
- 🔴 **The shipped `0.5` excludes 6,163 rows (10.8 %), not 8.3 %.** The 8.3 % in `score.ts`'s
  comment and in the plan is the share **below 0.4** (4,662 rows, 8.2 %). The comment's arithmetic
  is off by one band.

| Cutoff | Rows excluded | Share | No-website in-cluster rows excluded |
|---|---|---|---|
| 0.5 (shipped) | 6,163 | 10.8 % | 1,717 |
| 0.4 | 4,662 | 8.2 % | 1,339 |
| 0.3 | 2,680 | 4.7 % | 797 |
| 0.2 | 829 | 1.5 % | 232 |

### Internal duplicate rate (the roadmap flag)

Overture rows sharing `lower(name)` and postcode: **1,722 groups covering 5,247 rows, 9.2 %**
(researched 1,720 / 5,243 / 9.2 %). ✅ Most of it is chains; see below.

### Chain counts

| Definition | Names | Rows | Share | Researched |
|---|---|---|---|---|
| Overture, `lower(name)` ≥ 3 | 1,026 | 9,786 | 17.2 % | 1,025 / 9,782 / 17.2 % ✅ |
| Comptroller, `lower(outlet_name)` ≥ 3 | 426 | 2,007 | 5.7 % | 444 / 2,091 / 6.0 % |
| Overture, `name_norm` ≥ 3 | 1,130 | 10,254 | | |
| Comptroller, `name_norm` ≥ 3 | 474 | 2,243 | | |
| **D-11 as run** (pooled `name_norm`, local ≥ 3 **or** statewide ≥ 3) | **3,343** | **16,942** | 18.4 % of the spine | |

The Comptroller figure is 18 names smaller than researched. The permits dataset was updated on
2026-09-19, after the research read, which is the likely cause. The pooled local rule alone gives
2,345 names / 15,618 rows, and the statewide frequency adds ~1,000 names.

### The unmapped `basic_category` tail (174 values, 22,831 rows)

Reported, never guessed (D-02). The top 49 are 03-08's decided-unmapped list, with reasons in
`src/seed/data/overture-categories.json`:

financial_service 2950 · christian_place_of_worship 1533 · real_estate_service 1247 · professional_service 795 · event_or_party_service 789 · attorney_or_law_firm 577 · social_or_community_service 577 · historic_site 566 · gym 533 · rental_service 498 · government_office 452 · sport_or_fitness_facility 451 · elementary_school 441 · family_service 439 · park 425 · religious_organization 398 · bank_or_credit_union 388 · manufacturer 367 · place_of_learning 333 · supplier_or_distributor 329 · atm 319 · b2b_transportation_and_storage_service 317 · animal_or_pet_service 291 · specialty_school 280 · storage_facility 275 · shipping_or_delivery_service 265 · printing_service 263 · corporate_or_business_office 259 · media_service 232 · technical_service 226 · hospital 210 · community_and_government 195 · legal_service 194 · travel_service 194 · water_utility_provider 192 · music_venue 191 · laundry_service 181 · sport_or_recreation_club 175 · b2b_service 172 · high_school 165 · farm 160 · travel_and_transportation 154 · senior_living_facility 149 · college_university 133 · preschool 131 · design_service 130 · civic_organization 122 · sports_and_recreation 116 · education 109 · specialized_medical_facility 98 · middle_school 97 · police_station 96 · arts_and_entertainment 92 · shopping_mall 90 · stadium_arena 85 · fitness_studio 81 · fire_station 77 · public_utility 74 · event_venue 68 · housing_or_property_service 65 · b2b_office_and_professional_service 62 · agricultural_service 61 · art_gallery 60 · farmers_market 60 · library 58 · swimming_pool 58 · beach 57 · courthouse 51 · museum 51 · emergency_or_urgent_care_facility 49 · youth_organization 47 · airport 45 · campus_building 45 · b2b_industrial_and_machine_service 43 · sport_league 43 · amusement_park 41 · campground 41 · community_center 40 · sport_field 38 · tutoring_service 38 · movie_theater 36 · educational_service 35 · apartment 34 · golf_course 32 · food_and_drink 31 · taxi_or_ride_share_service 31 · emergency_department 30 · wholesaler 30 · arcade 27 · public_transit_facility_or_service 26 · b2b_energy_and_utility_service 25 · research_institute 25 · lake 23 · theatre_venue 23 · radio_station 22 · environmental_or_ecological_service 21 · gaming_venue 20 · skate_park 20 · electric_utility_provider 19 · recreational_equipment_rental 19 · adult_entertainment_venue 18 · air_transport_facility_or_service 18 · government_department 18 · performing_arts_venue 18 · playground 17 · political_organization 16 · bridge 15 · recreational_trail_or_path 15 · sport_court 15 · educational_facility 14 · food_bank 13 · jail_or_prison 13 · military_site 13 · nature_reserve 13 · casino 12 · social_club 12 · zoo 12 · labor_union 11 · marina 11 · psychic_advising 11 · monument 10 · sport_team 10 · telecommunications_service 10 · parking 9 · brewery 8 · condominium 8 · embassy 8 · geographic_entities 8 · industrial_facility_or_service 8 · cultural_center 7 · dog_park 7 · market 7 · public_plaza 7 · animal_attraction 6 · school_district_office 6 · winery 6 · arts_and_crafts_space 5 · garden 5 · jewish_place_of_worship 5 · muslim_place_of_worship 5 · security_service 5 · skating_rink 5 · amusement_attraction 4 · fairgrounds 4 · river 4 · b2b_science_and_technology_service 3 · cemetery 3 · place_of_worship 3 · planetarium 3 · rodeo 3 · train_station 3 · comedy_club 2 · distillery 2 · ground_transport_facility_or_service 2 · land_feature 2 · mountain 2 · national_park 2 · natural_gas_utility_provider 2 · parking_lot 2 · pier 2 · sculpture_statue 2 · aquarium 1 · buddhist_place_of_worship 1 · castle 1 · civic_center 1 · festival_venue 1 · general_hospital 1 · hindu_place_of_worship 1 · lighthouse 1 · science_attraction 1 · services_and_business 1 · sports_complex 1 · toll_station 1 · waterfall 1

Unmapped **NAICS** (Comptroller): **10,950** rows (31.4 %).

---

## Resolve pass

| | dry run | real |
|---|---|---|
| chains flagged (stage 1) | 3,343 names / 16,942 rows (statewide on) | same |
| B1 phone | 12,707 | 0 new |
| B2′ address (gated ≥ 0.3) | 15,113 | 0 new |
| B3 trigram (≥ 0.45, top-5 in ZIP) | 51,664 | 0 new |
| **union** | **79,484** | 79,484 |
| trigram plan | `gin` | `gin` |
| blocks refused over the 500-pair cap | **171** (875,376 pairs; worst `addr:78520:5955` = 420,903) | 171 |
| 25 km gate → `distinct` | 1,487 | 0 new |
| scored (pending) | 77,997 | 77,997 (0 rewritten) |
| **≥ 95** | **1,077** | → **1,077 auto-merged** |
| **80–94 (review queue)** | **12,591** | 12,591 |
| < 80 | 64,329 | 64,329 |
| distinct (R1 in the scorer) | 0 | 0 |
| merge outcomes | — | merged 1,077 · already one 0 · chain-skipped 0 · distinct-skipped 0 · retries 0 |
| report event | `1439037` (etl:resolve) | `1443346` (etl:resolve) |

Post-merge spine: **91,872** businesses, 90,795 live, 1,077 merged away. All 1,077
`business_merges` rows are `reason auto`, `merged_by etl:resolve`.

**Divergence: 79,484 candidates, not ~29,701.** Research counted **cross-source** pairs only.
The pass as built also pairs rows within a source: all of B1 is intra-Overture, because
Comptroller rows carry no phone, and B3 probes every row. **28,600** of the pending pairs are
cross-source, which is the research's order of magnitude.

**The 171 refused blocks are all `addr:` blocks, sized before the 0.3 gate.** Shopping centres
and office parks (`78520:5955`, `78503:2200` = 114,481, `78570:5001` = 60,726) are refused whole.
Nothing is lost silently: the refusal is in the report, and B3 still pairs similar names inside
those ZIPs at ≥ 0.45. What is lost is only address-keyed pairs with name similarity 0.3–0.45.

### What fills the review queue (12,591)

| Block | Pairs | ≥ 95 | 80–94 | of which name sim < 0.6 |
|---|---|---|---|---|
| phone | 12,707 | 100 | **8,751** | 6,972 |
| address | 15,113 | 895 | 3,256 | 0 |
| trigram | 51,664 | 82 | 584 | 0 |

- 🔴 **7,099 review items are phone pairs clamped to exactly 80 by R4** (exact phone plus same
  ZIP). **6,247** of them have name similarity < 0.3: two Overture listings sharing a number
  (one owner, a franchise line, a switchboard). The blocking threshold cannot touch these. They
  come from B1 and D-07's R4, not from B3.
- Only 3,261 of the 12,591 are cross-source (Comptroller ↔ Overture). 5,601 carry a chain flag
  on a side.
- **Raising `BLOCK_SIMILARITY_THRESHOLD` 0.45 → 0.60** would drop the 29,760 trigram pairs at
  sim 0.45–0.6 (buckets 0.4–0.5: 12,221 and 0.5–0.6: 17,539). **None of them is ≥ 80**, and under
  the committed weights none can be. Without a shared blockable phone, sim < 0.6 caps at
  name 14 + address 30 + distance 15 + cluster 5 = 64, and a pair that does share a phone is
  generated by B1 first. A no-phone pair needs sim ≥ 0.80 to reach 80. The review queue would not
  change. The candidate pile and B3's time would shrink.

---

## D-11 — same-name triplicates within 500 m (the fourth question)

D-11 flags a name as a chain at ≥ 3 live rows, **before** anything merges. Three copies of one
business (one Comptroller outlet plus two Overture listings) therefore count as a chain. They are
capped at 94 and never auto-merge. Measured on the pre-merge spine:

| | Count |
|---|---|
| local same-`name_norm` groups with ≥ 3 members | 2,345 (15,618 rows) |
| of which exactly 3 members / 3–5 members | 1,220 / 1,818 |
| of which every member is located | 1,716 |
| **every member within 500 m of every other** | **67 groups, 205 rows** |
| of those, exactly 3 members | 64 |
| of those, cross-source (Comptroller + Overture) | 59 |
| groups containing a 500 m triplicate (some member with ≥ 2 same-name neighbours within 500 m) | 123 |
| groups whose members all share one `(postal, street_num)` | 146 |
| **candidate pairs inside the 67 groups** | 214 |
| of which raw score ≥ 95, **held at 94 by the chain cap** | **66** |

Examples (all members within 500 m): `El Bip-Bip Drive Thru` ×3 (19 m) · `El Valle Used Auto Parts`
×3 (46 m) · `General Garage Door Service Inc` ×3 (18 m) · `El Tio meat market` ×3 (32 m) ·
`GTZ Bros Auto Sales` ×3 (195 m) · `Laguna Madre Art Gallery` ×5 (22 m) ·
`STRIPES STORE #41909H` ×4, four Comptroller permits at one store number (9 m) · `Terminix` ×3
(84 m). **Rio Stone Products** (P10) is one of these groups. These examples were read, not
labelled. The 67 are "same-name, co-located", which is the shape of a triplicate. None was
confirmed by hand to be one business.

---

## Fixture pairs (`tests/unit/fixtures/merge-pairs.json`) against the real spine

**Judge the six real pairs only.** P06–P09 are **SYNTHETIC** and test scorer rules, not
real-world identity.

| id | kind | fixture pair | fixture expects | real rows found in the spine | real pass produced |
|---|---|---|---|---|---|
| P01 | real | ZORBA, INC. ↔ Zorba, 516 S Main St 78501 | 95 **merge** | Comptroller `ZORBA, INC.` (census exact) ↔ Overture `Zorba` (`+19566863839`, fashion, conf 0.58), 47 m apart. Also `Zorba inc` at 14 S Main St | **94 review**: name 45 + address 30 + distance 15 + cluster 5 = 95 raw, **chain-capped** (`zorba` has 5 local rows) |
| P02 | real, **known_miss** (intended review) | TEXAS OUTDOOR POWER EQUIPTMENT ↔ …Equipment, 3611 W Freddy Gonzalez Dr 78539 | 79 ignore | Comptroller row **not geocoded** (Census no-match); Overture `+19563786303`, sporting goods, conf 0.99 | **64 ignore**: name 34 + address 30. No distance points, cluster 0 (NAICS 811411 unmapped) |
| P03 | real, **known_miss** (intended review) — "the real recall gap" | La Colmena Meat **Martket** ↔ **Market**, modelled Overture ↔ Overture | 78 ignore | **Only one Overture row exists**: `La Colmena Meat Martket & Food Store` (`+19565812000`, conf 0.76). Its pair is the Comptroller outlet, 10 m apart | **84 review**: Comptroller ↔ Overture, sim 0.848. **The modelled Overture ↔ Overture pair does not exist in 2026-08-19.0**, so the recall gap as modelled is not in this data |
| P04 | real | FIRESTONE COMPLETE AUTO CARE #44HG ↔ Firestone Complete Auto Care, 118 N 12th Ave 78541 | 84 review | as modelled, 69 m, Overture side chain-flagged | **84 review** ✅ exact |
| P05 | real | EIS ↔ Central Park Car Wash, 1805 N Loop 499 78550 | 45 ignore | Central Park Car Wash is at **1805 W Filmore Ave**, not N Loop 499 | **never a candidate**: no shared key, the correct outcome for two different businesses |
| P06 | **SYNTHETIC** | 142 km apart | 0 distinct | — | — |
| P07 | **SYNTHETIC** | phone reuse, dissimilar names | 80 review | — | the real equivalent is the 6,247 R4 pairs above |
| P08 | **SYNTHETIC** | one signal at its ceiling | 75 ignore | — | — |
| P09 | **SYNTHETIC** | two signals, Comptroller never geocoded | 94 review | — | — |
| P10 | real, **known_miss** (intended merge) | RIO STONE PRODUCTS, INC. ↔ Rio Stone Products Inc, 2520 Beech Ave 78501 | 90 review | **three** rows: the Comptroller outlet plus two Overture listings sharing `+19566313332` (conf 0.89 and 0.37) — a **D-11 triplicate** | Comptroller ↔ `…Inc` **90 review** ✅ (cluster 0, NAICS 327991 unmapped) · the two Overture rows **94 review** (phone + name + address, chain-capped) · Comptroller ↔ `RIO Stone` 85 review |

---

## The re-run proof (DATA-04 at ~92k rows)

Every `ingest_runs` row this run wrote, in order (`added / changed / unchanged`):

| Pass | Started (UTC) | `tx_comptroller` | `census_geocoder` | `tx_comptroller_closures` | `overture` |
|---|---|---|---|---|---|
| **run 1** | 03:11:24 | 34,928 / 0 / 0 | 27,903 / 0 / 0 | 21,467 / **42** / 0 | 56,944 / 0 / 0 |
| settle (after fix 1) | 03:30:45 | 0 / 0 / 34,928 | 0 / 0 / 27,903 | 0 / **13** / 21,454 | — |
| *(resolve dry run + real pass: 1,077 merges)* | 03:39 – 04:15 | | | | |
| **run 2** | 04:18:40 | 0 / 0 / 34,928 | 0 / 0 / 27,903 | 0 / 0 / 21,467 | 0 / 0 / 56,944 |
| **run 3** (after fix 2) | 04:30:16 | 0 / 0 / 34,928 | 0 / 0 / 27,903 | 0 / 0 / 21,467 | 0 / 0 / 56,944 |

`gone` is 0 on every row.

### 🔴 Run 2 was not clean: 908 `businesses` events, found here and fixed (`61750d7`)

Every source row in run 2 reported `unchanged`, but
`select count(*) from events where entity_type='businesses' and occurred_at > '2026-09-23T04:18:23.778Z'`
returned **908**, all `update` by `etl:ingest-comptroller`, all on merge **winners**.

The resolve pass had merged 1,077 pairs, and survivorship (`survivorship.ts`: lat/lng go
**Overture → Census Exact → Census Non_Exact**) set each winner's location. On re-run, the
Census pass ran `WRITE_LOCATION` for every Match, guarded only by `is distinct from`, so it wrote
the Census point back:

- 832 winners went from the Overture point to their Census point.
- 76 winners went from the cluster's other Census Exact record to their own.

That broke the re-run claim and it also overrode the committed survivorship order. A fixture
test could not find this, because it needs a merge between two runs.

**Fix:** the Census pass writes a location only when its census source record is **new or
changed**. That is the same gate `upsertBusinessFromSource` applies to every other derived
column. `tests/db/geocode-rerun.test.ts` was watched red on the defect, and it is killed by both
mutations (gate removed; never write). It includes a positive control: a changed Census answer
still moves its business.

**Repair of the local spine:** the 908 rows were restored from their own `events.before` values
(lat, lng, `location_source_id`, `location_match_type`) in one transaction attributed
`etl:03-20-repair`. There are 908 repair events, and afterwards all 908 hold their pre-run-2
`location_source_id` again. Production never saw the defect, because it gets the fixed script in
03-21.

### ✅ Run 3 — the clean proof

Started 2026-09-23T04:30:16.215Z, with the same code as `61750d7` and the same sources:

- all four sources `added 0 · changed 0`: 34,928 / 27,903 / 21,467 / 56,944 `unchanged`, gone 0
- `select count(*) from events where entity_type='businesses' and occurred_at > '2026-09-23T04:30:16.215Z'`
  → **0**
- `businesses` rows with `updated_at` after the run 3 start → **0** of 91,872
- the only events are the four run-level `ingest_runs · complete` events (one per run, D-06).
  `source_records.last_seen_at` moved on all 141,242 records, which is how `gone` works, and it
  emits no event.

Run 2 / run 3 wall clock: Comptroller 342.7 s / 487.1 s (the Census network took 284 s / 431 s)
· Overture 86 s / 71 s.

---

## Checkpoint — four questions for danlo (2026-09-22)

**1. The confidence cutoff (D-04).** It ships at `0.5` behind `// TUNED BY THE DESK RUN`.

- Evidence: junk proxy 58 % (0.0–0.1), 25 % (0.1–0.2), 6.0 % (0.2–0.3), **3.4 % (0.3–0.4),
  3.3 % (0.4–0.5)**, then 6.8 % (0.5–0.6) and 4.7–12.8 % above that.
- About half of every band below 0.7 has no website, against 28 % at ≥ 0.9.
- `0.5` drops 6,163 rows (10.8 %, not the 8.3 % in the comment). 1,717 of those are
  no-website rows in a cluster, which are potential leads.
- `0.3` drops 2,680 rows (4.7 %), of which 797 are no-website in-cluster rows.
- Read the 0.3–0.4 / 0.4–0.5 / 0.5–0.6 tables below.
- **Recommendation: `cutoff 0.3`.** The 0.3–0.5 rows read as real RGV businesses, and they are
  cleaner than the 0.5–0.6 band. Any value keeps the comment honest if the 8.3 % is corrected.
- → Reply `cutoff 0.5` to confirm, or `cutoff <x>`.

**2. The ten fixture pairs (DEDUP-01 / D-09).** See § Fixture pairs. Judge the six real pairs;
P06–P09 are synthetic.

- Against the real spine: P04 reproduced exactly (84 review). P10's Comptroller pair
  reproduced exactly (90 review). P05's two businesses are at different addresses in reality and
  never became a candidate (correct).
- P01 is real but **chain-capped to 94** (5 local `zorba` rows). P02's Comptroller side was
  **never geocoded** (64 in reality).
- P03's modelled Overture ↔ Overture pair **does not exist**. The real La Colmena pair is
  Comptroller ↔ Overture at **84 review**, so "the real recall gap" is not in this data.
- None of these is a wrong verdict for the pair **as the fixture models it**. The fixture tests
  the scorer's arithmetic on its own inputs, and every expectation still holds.
- **Recommendation: `pairs ok`**, keeping the `known_miss` flags. If you would rather P03 model
  the real Comptroller ↔ Overture pair (84 review, no longer a miss), say `P03 should be review`.
  That is an expectation change the weights can produce.
- → Reply `pairs ok`, or name the ids.

**3. The blocking threshold.** `BLOCK_SIMILARITY_THRESHOLD` ships at 0.45.

- Evidence: 79,484 candidates, and a review queue (80–94) of **12,591**.
- **The threshold does not drive the queue.** 8,751 of the 12,591 come from the phone block.
  7,099 are R4 phone-locality pairs clamped to exactly 80, and 6,247 of those have name
  similarity < 0.3 (two listings sharing one number).
- 0.60 would remove 29,760 trigram candidates. None of them is ≥ 80, and under the committed
  weights none can be. The queue would not change, and B3 would get faster.
- **Recommendation: `threshold 0.45`** (confirmed unchanged). The queue size is an R4 / D-07
  question, not a threshold one. If 12,591 is too many to work, that needs its own decision:
  e.g. R4 only lifts at name sim ≥ 0.3, which would take ~6,247 out of the queue. That is a rule
  change with its own red test, not a constant edit here.
- → Reply `threshold 0.45`, or `threshold <x>`.

**4. D-11 triplicates (raised by 03-14).** Three copies of one business with one normalized name
count as a chain today, so they are capped at 94 and never auto-merge.

- Measured: of 2,345 local same-name groups with ≥ 3 members, **67 groups / 205 rows** have every
  member within 500 m of every other (64 are exactly 3; 59 are cross-source).
- 123 groups contain some 500 m triplicate, and 146 groups sit at one `(postal, street_num)`.
- Inside the 67 groups, **66 candidate pairs score raw ≥ 95 and are held at 94** by the chain cap.
  They wait in review instead of auto-merging. P10 Rio Stone Products is one of them.
- The cost is recall, not safety: 66 manual reviews against ~1,077 auto-merges.
- **Recommendation: keep D-11 as is for Phase 3.** Record "a chain needs ≥ 3 members more than
  500 m apart" as a D-11 amendment for a later plan, with its own fixture and red test. It is a
  small, safe win, but it changes what "chain" means, and that is your call.
- → Reply `D-11 keep`, or `D-11 amend` (queued as a follow-up, not done in this plan).

---

## Answers (danlo, 2026-09-23) and what changed

| Question | Answer | Change |
|---|---|---|
| 1. Confidence cutoff | **`cutoff 0.3`** | `OVERTURE_CONFIDENCE_CUTOFF` 0.5 → **0.3** (`b0c6000`) |
| 2. Fixture pairs | **`pairs ok`** | no expectation change for any real pair |
| 3. Blocking threshold | **`threshold 0.45` plus the phone rule** | `BLOCK_SIMILARITY_THRESHOLD` confirmed at 0.45; new `PHONE_LIFT_MIN_NAME_SIM = 0.3` (`12a66ec` red, `b0c6000` green) |
| 4. D-11 triplicates | **`D-11 keep`** | none; follow-up recorded in `deferred-items.md` |

**Why each answer:**

1. **Cutoff 0.3.** The 0.3–0.4 and 0.4–0.5 bands read as real RGV businesses in the 20-row
   samples below. Their junk proxy (3.4 % / 3.3 %) is lower than 0.5–0.6's (6.8 %). About half
   of each band has no website, which makes them exactly the product's target. 0.3 drops 2,680 rows (4.7 %),
   the bands below it where junk climbs (6.0 %, 25 %, 58 %). The old comment's "8.3 %" was the
   share **below 0.4**; the shipped 0.5 actually dropped 6,163 rows (10.8 %). The comment now
   says so.
2. **Pairs ok.** The fixture tests the scorer's arithmetic on the inputs it models, and every
   real-pair expectation holds. The `known_miss` flags stay (P02, P03, P10). What the real spine
   showed is recorded, not re-pinned:
   - **P03's real pair is Comptroller ↔ Overture at 84 review.** The modelled
     Overture ↔ Overture "Martket ↔ Market" pair does not exist in `2026-08-19.0`. So the recall
     gap the fixture models is not in this data: the real La Colmena duplicate reaches review.
   - P01 is chain-capped at 94 in reality (5 local `zorba` rows). P02's Comptroller row was
     never geocoded (64). P05's two businesses are at different addresses and never pair.
3. **Threshold 0.45, plus a phone-lift floor.** The threshold never drove the queue. R4 did:
   it lifted every shared-phone + same-ZIP pair with name sim < 0.6 to 80. Now R4 lifts only at
   name sim ≥ **0.3**. Below that, the pair keeps its raw score. A shared phone with a dissimilar
   name tops out at raw 80, so it can never merge either way.
4. **D-11 kept for Phase 3.** The 67 co-located same-name groups (205 rows, 66 pairs held at 94,
   Rio Stone Products among them) wait in review. Follow-up: **"a chain needs ≥ 3 members more
   than 500 m apart"**, with its own fixture and red test (`deferred-items.md`).

### The fixture after the phone rule

Only **P07** changed, and it is **synthetic** (name sim 0.05, a fictional 555 number): **80
review → 29 ignore**, signals `[phone]`, geo gate false, no rule. The lift itself is now pinned
at the boundary by `phone lift needs name sim 0.30` (0.29 → 29 ignore, no rule; 0.30 → 80 review,
`phone_locality_review`). `phone locality — sim < 0.60 is clamped to the review band` moved its
lower edge from P07 as stored to P07's records at sim 0.30. No real pair changed, because none
of the six real pairs carries a phone. Exact integers, bands and signals throughout; no range
anywhere.

Mutation: deleting the floor (`nameSim >= w.phoneLiftMinNameSim &&`) turned
`phone lift needs name sim 0.30` and `merge-pairs fixture P07` red, and nothing else (2 of 228).
Reverted, then byte-identical by `cmp`.

### Resolve `--dry-run` with the tuned scorer (2026-09-23T04:45Z, event `1445587`)

Run on the same spine, **after** the real pass had merged 1,077 pairs. Not a re-ingest.

| | before (dry run 1, 03:51Z) | after (tuned, 04:51Z) |
|---|---|---|
| new candidates (stage 2) | 79,484 | 539 (phone 54 · address 3 · trigram 482: pairs the merge winners' new fields now match) |
| blocks over the cap | 171 | 168 |
| 25 km gate | 1,487 | 8 |
| pending scored | 77,997 | 77,451 (7,724 rewritten) |
| **≥ 95** | 1,077 | **0** (all 1,077 already merged) |
| **80–94 (review queue)** | **12,591** | **7,975** |
| < 80 | 64,329 | 69,476 |
| wall clock | 742.5 s | 360.3 s |

🔴 **The queue fell by 4,616, not the predicted ~6,247.** The accounting closes, with a
30-pair remainder:

| | Pairs |
|---|---|
| review queue before | 12,591 |
| − shared phone + same ZIP + sim < 0.3, raw < 80: no longer lifted | **− 4,667** |
| + new candidates from post-merge re-blocking that land in review | + 21 |
| + pairs re-scored because a side is now a merge winner with survivorship fields | + 30 |
| **review queue after** | **7,975** |

**Why the prediction was high:** the ~6,247 were phone pairs sitting at exactly 80 with
sim < 0.3. **1,622 of them are at 80 on their raw score, not because of the lift:** same phone
+ same full street address (30) + ≤ 100 m (15) + same cluster (5) = 80 at name 0. The floor
cannot touch them, and it should not. Same phone and same street address with a different name
is the likeliest real duplicate in the set: a renamed listing, or one owner's two listings at one
storefront. They stay in review on their own evidence. Now: 6,289 pending pairs share a phone
and a ZIP at sim < 0.3; **4,667** fall out of review; **1,622** stay (all of them at the same
street address).

---

## Confidence sample — 20 rows per 0.1 band

Deterministic (`order by md5(id)`), Texas-side Overture rows. Public fields only: the name shown
is `display_name` (T-3-11). `web` means the row lists at least one website.
The bands the cutoff question turns on are **0.3–0.4, 0.4–0.5 and 0.5–0.6**.

#### 0.0–0.1

| # | name | address | category | conf | status | web |
|---|---|---|---|---|---|---|
| 1 | J & R Lawnmover Repair | 155 N Austin St, San Benito 78586 | home_service | 0.048 | — | no |
| 2 | Garage Door Service | 116 N Dakota Ave, Brownsville 78521 | hardware_home_and_garden_store | 0.069 | — | no |
| 3 | Jime Fit Mom | —, Mission — | sport_or_fitness_facility | 0.051 | — | yes |
| 4 | AD Berries and More LLC | 1300 N 10th St #220i, McAllen 78501 | food_and_beverage_store | 0.022 | — | no |
| 5 | Ivan El Ruso Garza | —, Edinburg — | — | 0.078 | — | yes |
| 6 | Lala Home Solutions | —, San Juan — | hardware_home_and_garden_store | 0.076 | — | yes |
| 7 | Will Tailor Shop Alteraciones | 309 S Alton Blvd, Alton 78573 | — | 0.084 | — | no |
| 8 | Tiny Affordable Homes | 1025 W Grizzly Dr, La Feria 78559 | — | 0.095 | — | no |
| 9 | First Express HVAC Specialist | 218 N Arroyo Blvd Ste B, Los Fresnos 78566 | home_service | 0.094 | — | yes |
| 10 | Service Force LLC | —, Mission — | home_service | 0.076 | — | no |
| 11 | Christine Ruddy Photography | —, Harlingen — | media_service | 0.079 | — | yes |
| 12 | Brownsville Online | —, Brownsville — | b2b_office_and_professional_service | 0.040 | — | no |
| 13 | Kings Landing Real Estate Financing | —, Brownsville — | financial_service | 0.091 | — | yes |
| 14 | The Vintage Photobooth LLC | —, Brownsville — | media_service | 0.084 | — | yes |
| 15 | RGV Spotless Bins | 816 W Elbert St, Pharr 78577 | home_service | 0.091 | — | yes |
| 16 | Sunshade Tops | —, Mission — | home_service | 0.063 | — | no |
| 17 | Stonehard Construction LLC | —, Edinburg — | building_or_construction_service | 0.069 | — | no |
| 18 | Girlgangmarketbtx | —, Brownsville — | event_or_party_service | 0.091 | open | yes |
| 19 | CRJ Toys & More | 160 E Stenger St, San Benito 78586 | flowers_and_gifts_store | 0.087 | — | yes |
| 20 | Pre Skyn | —, Mission — | — | 0.070 | — | yes |

#### 0.1–0.2

| # | name | address | category | conf | status | web |
|---|---|---|---|---|---|---|
| 1 | Esencia divina | 400 Virgen de San Juan Blvd, San Juan, TX 78589, Estados Unidos, San Juan 75201 | health_care | 0.121 | — | yes |
| 2 | Moana Jones Cleaning | 3800 Pebblecreek Ct, Plano 75023 | — | 0.107 | — | no |
| 3 | Lucky Lady Slots | 126 N Palm Ave, Rio Grande City 78582 | books_music_and_video_store | 0.180 | — | yes |
| 4 | Sur180 Therapeutics | —, McAllen — | — | 0.144 | — | yes |
| 5 | Pozórale (Port Isabel) | 402 TX-100, Port Isabel 78578 | restaurant | 0.182 | open | no |
| 6 | Balloons by Milys | 5221 N 10th St #150, McAllen 78504 | specialty_store | 0.185 | — | no |
| 7 | K Food | —, McAllen — | restaurant | 0.195 | — | no |
| 8 | Grupo El Duelo | —, McAllen — | — | 0.143 | open | yes |
| 9 | Jazmine's Fiesta Rentals LLC | 5404 Sabinito Dr, Edinburg 78542 | rental_service | 0.181 | — | no |
| 10 | Creaciones sebas | La blanca vía panamericana , La Blanca — | event_or_party_service | 0.153 | — | no |
| 11 | TX Embroidery | 6975 Paredes Line Rd, Brownsville 78526 | printing_service | 0.193 | — | no |
| 12 | Coin Cloud Bitcoin ATM | 6010 W Expy 83, Palmview 78572 | atm | 0.191 | — | yes |
| 13 | Amigo Motors LLC | 420 S 23rd St, McAllen 78501 | auto_dealer | 0.102 | — | yes |
| 14 | Pacas Karaoke Collections | 2101 W Military Hwy, McAllen 78503 | fashion_and_apparel_store | 0.167 | — | yes |
| 15 | Michael Homero Garcia | 3300 N McColl Rd Ste P & Q, McAllen 78501 | real_estate_service | 0.171 | — | yes |
| 16 | Texas Roofing | 4002 Paredes Line Rd, Brownsville 78526 | building_or_construction_service | 0.129 | — | yes |
| 17 | Family Service Events | —, Harlingen — | — | 0.115 | — | no |
| 18 | Pixie Divine Glitters | 221 E Jackson Ave, Harlingen 78550 | arts_crafts_and_hobby_store | 0.129 | — | yes |
| 19 | Ambar Studio | 3001 Pablo Kisel Blvd Ste H, Brownsville 78526 | professional_service | 0.103 | — | no |
| 20 | Cuevas Doorshop | 10858 W Mile 7 Rd, Mission 78574 | hardware_home_and_garden_store | 0.155 | — | no |

#### 0.2–0.3

| # | name | address | category | conf | status | web |
|---|---|---|---|---|---|---|
| 1 | Kp Photography | 1701 N 8th St, McAllen 78501 | professional_service | 0.251 | — | yes |
| 2 | A Plus Construction and Development | 1801 W Texas Ave, San Juan 78589 | hardware_home_and_garden_store | 0.253 | — | yes |
| 3 | Inmotion Gate Solutions | 361-433-8352 , Edcouch 77901 | home_service | 0.217 | — | no |
| 4 | Firedays | —, Los Fresnos — | personal_or_beauty_service | 0.237 | — | no |
| 5 | Stinnett Jewelry | 308 S Texas Blvd, Weslaco 78596 | fashion_and_apparel_store | 0.281 | — | yes |
| 6 | Lash Couture | 2353 Old Port Isabel Rd, Brownsville 78521 | personal_or_beauty_service | 0.250 | — | yes |
| 7 | Anime World | 2200 S 10th St, McAllen 78503 | toys_and_games_store | 0.289 | — | no |
| 8 | Vintage Assembly | 1600 S Texas Blvd, Weslaco 78596 | second_hand_store | 0.256 | — | no |
| 9 | Chepe’s Tepache & Ice cream | 101 Alta St, San Juan 78589 | casual_eatery | 0.290 | — | yes |
| 10 | Happy Kiddos Learning Academy | 2100 Old Port Isabel Rd, Brownsville 78521 | home_service | 0.293 | open | no |
| 11 | Vintage University | 2604 W Freddy Gonzalez Dr, Edinburg 78539 | fashion_and_apparel_store | 0.230 | — | yes |
| 12 | Global Wealth Estates | 1212 N Stuart Place Rd, Harlingen 78552 | real_estate_service | 0.268 | — | yes |
| 13 | Shayegan Boutique | 501 W 10th St, Mission 78572 | fashion_and_apparel_store | 0.290 | — | yes |
| 14 | The Dove's Nest | 1900 Dove Ave W, McAllen 78504 | historic_site | 0.221 | — | yes |
| 15 | Club90rgv | 121 E Mile 15 N, Weslaco 78599 | sporting_goods_store | 0.299 | — | no |
| 16 | VICEVERSA | 1300 W Trenton Rd Ste 360, McAllen 78504 | bar | 0.265 | — | no |
| 17 | Granite World | 502 E Interstate 2, San Juan 78589 | home_service | 0.262 | — | yes |
| 18 | Rivera Concrete | 4002 Paredes Line Rd, Brownsville 78526 | home_service | 0.274 | — | yes |
| 19 | Jisella Ortiz Realtor | 1720 W Maple Ave, McAllen 78501 | real_estate_service | 0.254 | — | yes |
| 20 | Mars Smoked Planet | 224 Billy Mitchell Blvd, Brownsville 78521 | food_truck_stand | 0.287 | — | no |

#### 0.3–0.4

| # | name | address | category | conf | status | web |
|---|---|---|---|---|---|---|
| 1 | Studio 21 Lounge | 953 E Adams St, Brownsville 78520 | lounge | 0.322 | — | no |
| 2 | Touch Skin and Body Therapy | 8441 E State Hwy 107, Edinburg 78542 | wellness_service | 0.370 | — | no |
| 3 | Clementson Testing Services | 3721 N McColl Rd, McAllen 78501 | manufacturer | 0.312 | — | no |
| 4 | Spring fever | 2325 Southmost Rd, Brownsville 78521 | automotive_service | 0.333 | — | yes |
| 5 | Titi's Sazon Boriqua | 402 N Closner Blvd, Edinburg 78541 | restaurant | 0.314 | — | no |
| 6 | Victor Solano | 2201 Dove Ave W, McAllen 78504 | real_estate_service | 0.314 | — | no |
| 7 | Texas Air Conditioning | 118 E Whiting St, South Padre Island 78597 | home_service | 0.374 | — | yes |
| 8 | Infinity Sales & Services LLC | 2645 Southmost Rd, Brownsville 78521 | fashion_and_apparel_store | 0.369 | — | yes |
| 9 | Ministry Hechos 13 | 10009 Alcantar Ave, Mission 78573 | religious_organization | 0.374 | — | no |
| 10 | JNS Packaging | 5305 N Veterans Blvd, San Juan 78577 | manufacturer | 0.317 | — | yes |
| 11 | LRS | 122 N 77 Sunshine Strip #3, Harlingen 78550 | emergency_department | 0.325 | — | yes |
| 12 | Danny Yanez Ministries - The Right Frequency Broadcast | 205 E Business 83, Weslaco 78596 | religious_organization | 0.359 | — | no |
| 13 | Ice Makers, Walk in Coolers and Freezers Equipment Repair | 2909 Azteca Ave, McAllen 78503 | automotive_service | 0.322 | — | yes |
| 14 | Palapa Don Gruñón | 11712 Hermosa Vida Dr, Donna 78537 | music_venue | 0.335 | open | no |
| 15 | AME Glass LLC | 1200 W Polk Ave, Pharr 78577 | home_service | 0.323 | — | yes |
| 16 | VIP Fitness Club | 2112 W Nolana Ave, McAllen 78504 | gym | 0.379 | — | yes |
| 17 | Pros On Call - McAllen | 2513 Whitewing Ave, McAllen 78501 | home_service | 0.316 | — | yes |
| 18 | Mpa Digital | 2243 W Pecan Blvd, McAllen 78501 | electronics_store | 0.312 | — | yes |
| 19 | Elena’s Nails | 3000 N McColl Rd Suite B10, McAllen 78501 | wellness_service | 0.312 | — | no |
| 20 | Eva Construction | 2112 S Shary Rd, Mission 78572 | building_or_construction_service | 0.352 | — | yes |

#### 0.4–0.5

| # | name | address | category | conf | status | web |
|---|---|---|---|---|---|---|
| 1 | RGV Sno-Wiz | 5813 N FM 1015, Mercedes 78570 | casual_eatery | 0.430 | — | no |
| 2 | Blazin Ace | 512 S Westgate Dr, Weslaco 78596 | food_truck_stand | 0.428 | — | no |
| 3 | Hinojosa Nails | 15610 N Base Line Rd, Mercedes 78570 | wellness_service | 0.467 | — | yes |
| 4 | JMC Carpet & Flooring | 111 N 7th St, Alamo 78516 | hardware_home_and_garden_store | 0.432 | — | no |
| 5 | Invacare Corporation | 7801 Jackson Rd, Pharr 78577 | manufacturer | 0.454 | open | yes |
| 6 | Tacos La Patrona y mÃ¡s | 503 W Nolana Loop, Pharr 78577 | restaurant | 0.414 | open | no |
| 7 | Massage Oasis By Veronika | 4309 N 10th St Suite B, McAllen 78504 | wellness_service | 0.449 | open | no |
| 8 | Bambolina | 920 N 10th St, McAllen 78501 | fashion_and_apparel_store | 0.400 | — | no |
| 9 | Raymondville Texas | —, Raymondville 78580 | community_and_government | 0.438 | open | no |
| 10 | Foxy Nails & Spa | 2216 W Trenton Rd, Edinburg 78539 | personal_or_beauty_service | 0.483 | — | yes |
| 11 | Tri-Ed Distribution | 229 N McColl Rd, McAllen 78501 | manufacturer | 0.499 | — | yes |
| 12 | Mercedes Free Press | 143 N Texas Ave, Mercedes 78570 | community_and_government | 0.496 | — | yes |
| 13 | BeautyxDestinee | 101 S Main St, La Feria 78559 | wellness_service | 0.440 | — | yes |
| 14 | A Seasonal Thing LLC | 4518 Los Ebanos Rd, Palmhurst 78573 | — | 0.427 | — | no |
| 15 | Sam's Place | 400 S Kansas Av, Weslaco 78596 | food_truck_stand | 0.464 | — | no |
| 16 | Our Little Family Farm | 27343 State Highway 345, San Benito 78586 | farm | 0.405 | — | yes |
| 17 | McAllen Hand Therapy | 5123 N McColl Rd, McAllen 78504 | health_care | 0.446 | open | no |
| 18 | Grupo De Danza Anacahua Brownsville Tx. | 535 E 12th St, Brownsville 78520 | social_or_community_service | 0.400 | — | yes |
| 19 | Hair by Pris Salon | 909 W Farm to Market 495, San Juan 78589 | personal_or_beauty_service | 0.473 | — | no |
| 20 | Windwater Community | 5701 Padre Blvd, South Padre Island 78597 | b2b_office_and_professional_service | 0.470 | open | no |

#### 0.5–0.6

| # | name | address | category | conf | status | web |
|---|---|---|---|---|---|---|
| 1 | Santos Customs Automotive | 1533 W Mile 14 1/2 N, Weslaco 78599 | automotive_service | 0.590 | — | no |
| 2 | Ice Cream Tocumbo | 1301 W US Highway 83, Pharr 78577 | casual_eatery | 0.550 | open | no |
| 3 | Red Ant & Mart | 1015 Palm Ave, Progreso 78579 | convenience_store | 0.573 | — | no |
| 4 | Weslaco City Park | 300 N Airport Dr, Weslaco 78596 | park | 0.550 | open | yes |
| 5 | Sideline Bar & Grill | 608 N Shary Rd, Mission 78572 | bar | 0.527 | — | no |
| 6 | Traveler Produce | 2501 W Military Hwy, McAllen 78503 | professional_service | 0.587 | open | yes |
| 7 | FOR THE TOTAL ME HEALTH & WELLNESS CLINIC - Integrated Behavioral & Medical Health Center | 1412 E 8th St Suite A, Weslaco 78596 | complementary_and_alternative_medicine | 0.561 | — | yes |
| 8 | Pool Side Paradise/Quinta El Paraiso | 155 Sioux Rd, Alamo 78516 | event_or_party_service | 0.503 | open | no |
| 9 | WiseGuys of Wine | 3304 Valle Cir, Edinburg 78539 | winery | 0.562 | — | no |
| 10 | R.E.D'S WORKS Homecoming Mums | 30144 FM801, San Benito 78586 | shopping | 0.574 | — | yes |
| 11 | AVANCE RGV Administrative Office | 213 W 2nd St, Rio Grande City 78582 | social_or_community_service | 0.503 | — | yes |
| 12 | West Valley Radiology Llp | 5325 S McColl Rd, Edinburg 78539 | diagnostics_imaging_or_lab_service | 0.550 | open | no |
| 13 | 4M Farms, LLC | 2601 E Mile 3 Rd, Palmhurst 78573 | hardware_home_and_garden_store | 0.562 | — | no |
| 14 | Hacienda Estrella Del Rio | 616 West Canales Brothers , Rio Grande City — | private_lodging | 0.553 | — | no |
| 15 | Moreno's Auto Repair | 1168 Milpa Verde, Brownsville 78521 | automotive_service | 0.599 | — | no |
| 16 | Coyote Arms | 4521 US-281-BR, Edinburg 78539 | sporting_goods_store | 0.568 | open | yes |
| 17 | The Ruff House | 311 W Van Buren Ave, Harlingen 78550 | animal_and_pet_store | 0.550 | open | yes |
| 18 | Impac Manufacturing Inc. | 41786 FM 510, Los Fresnos 78566 | corporate_or_business_office | 0.580 | — | yes |
| 19 | Dixieland Park | —, Harlingen — | housing_or_property_service | 0.577 | — | yes |
| 20 | CR Graphics | 1811 N 23rd St, McAllen 78501 | printing_service | 0.542 | — | no |

#### 0.6–0.7

| # | name | address | category | conf | status | web |
|---|---|---|---|---|---|---|
| 1 | Wells Fargo Home Mortgage | 910 Ruben M Torres Blvd, Brownsville 78520 | financial_service | 0.666 | — | yes |
| 2 | Gccjvj | 601 E Santa Monica St, Pharr 78577 | food_and_beverage_store | 0.697 | — | no |
| 3 | El Retiro Auto Sales Llc | 24003 Sunflower Ln, Monte Alto 78538 | auto_dealer | 0.650 | permanently_closed | no |
| 4 | American Taekwondo Training Center | 5485 FM-2845, Lyford 78569 | sport_or_recreation_club | 0.680 | — | no |
| 5 | Ng Used Auto Sales | 5305 FM 1732, Brownsville 78520 | auto_dealer | 0.650 | open | no |
| 6 | La Escondida Night Club | 2512 Rogers Rd, Edinburg 78541 | dance_club | 0.666 | — | no |
| 7 | Lolo's Smart Cuisine | 4119 N 10th St, McAllen 78504 | restaurant | 0.650 | permanently_closed | no |
| 8 | Edinburg International Airport | 400 E Hargill Rd, Weslaco 78596 | airport | 0.687 | — | no |
| 9 | Jehovah's Witnesses | 301 Monroe St, Port Isabel 78578 | christian_place_of_worship | 0.601 | — | yes |
| 10 | Popeyes Luisiana | 2805 E University Dr, Edinburg 78542 | fast_food_restaurant | 0.648 | — | yes |
| 11 | 501 Jasmine Villas | 501 E Jasmine Ave, McAllen 78501 | historic_site | 0.655 | open | yes |
| 12 | Rio Bank | 601 S Stuart Place Rd, Harlingen 78552 | bank_or_credit_union | 0.643 | — | yes |
| 13 | BioLuxury Spa | 2109 S 10th St Bldg 300, Ste 80, McAllen 78503 | wellness_service | 0.645 | — | no |
| 14 | Robby's Auto Wholesale | 300 E Interstate 2  Ste N, Pharr 78577 | auto_dealer | 0.650 | open | no |
| 15 | 872 - Qci - Brownsville, Tx | 970 S Indiana Ave, Brownsville 78521 | travel_and_transportation | 0.650 | permanently_closed | yes |
| 16 | El Chaparral Adult Daycare Llc | 1200 Pecan Blvd, McAllen 78501 | social_or_community_service | 0.650 | permanently_closed | no |
| 17 | Rioone Health Network | 5501 S McColl Rd, Edinburg 78539 | wellness_service | 0.650 | open | yes |
| 18 | T & V Miles Inc | 1714 Boca Chica Blvd, Brownsville 78520 | physical_medicine_and_rehabilitation | 0.650 | open | yes |
| 19 | Valero Corner Store | 100 S Arroyo Blvd, Los Fresnos 78566 | gas_station | 0.650 | permanently_closed | yes |
| 20 | Trans-Rapids Trucking | 34824 FM2520, San Benito 78586 | b2b_transportation_and_storage_service | 0.668 | — | yes |

#### 0.7–0.8

| # | name | address | category | conf | status | web |
|---|---|---|---|---|---|---|
| 1 | Sergio McAllen | 1406 E Nolana Loop, Pharr 78577 | corporate_or_business_office | 0.711 | — | no |
| 2 | Yeshua Graphics | 202 N Commerce St, Harlingen 78550 | design_service | 0.755 | open | no |
| 3 | J & J Nutrition | —, Brownsville — | wellness_service | 0.757 | — | no |
| 4 | Elite Body Sculpting | 808 S Shary Rd, Mission 78572 | wellness_service | 0.750 | open | yes |
| 5 | Lone Star Rgv Motors | 807 W US Highway 83, Pharr 78577 | auto_dealer | 0.750 | open | no |
| 6 | Sweethearts Care Center, Pllc | 1220 E 6th St, Weslaco 78596 | primary_care_or_general_clinic | 0.750 | open | no |
| 7 | Distribuidora de Carnes D&E | 2501 W Military Hwy D-22, McAllen 78503 | wholesaler | 0.744 | — | yes |
| 8 | San Isidro Ranch | 30848 N FM 681, Edinburg 78563 | lodging | 0.743 | — | no |
| 9 | Cano Family Medicine Clinic | 100b E Alton Gloor Blvd  # 210, Brownsville 78526 | primary_care_or_general_clinic | 0.750 | open | no |
| 10 | US Post Office | 109 N Border Ave, Weslaco 78596 | shipping_or_delivery_service | 0.770 | — | yes |
| 11 | Ed Payne Commercial and Fleet Sales | 2101 E Expressway 83 Bldg 2, Weslaco 78599 | vehicle_dealer | 0.719 | open | yes |
| 12 | A&N custom body shop | 6413 Rattler St, Donna 78537 | automotive_service | 0.772 | — | no |
| 13 | Súper Emanuel | —, Palmhurst — | convenience_store | 0.726 | — | no |
| 14 | Quinta los Girasoles | 1348 E Hernandez Rd, Donna 78537 | — | 0.737 | open | no |
| 15 | Biomedical Research and Health | Biomedical Research Building, Brownsville 78520 | college_university | 0.716 | — | yes |
| 16 | Damien's Barber Shop | —, San Juan — | personal_or_beauty_service | 0.716 | — | no |
| 17 | Rhythm and Soul Room | 5401 N 10th St Ste 215, McAllen 78504 | restaurant | 0.770 | — | yes |
| 18 | Dixieland Disc Golf Course | —, Harlingen — | sport_field | 0.711 | — | no |
| 19 | James Avery Artisan Jewelry | 2200 S 10th St, McAllen 78503 | fashion_and_apparel_store | 0.765 | open | yes |
| 20 | Sunoco | 100 E Interstate Highway 2, Mission 78572 | gas_station | 0.750 | open | yes |

#### 0.8–0.9

| # | name | address | category | conf | status | web |
|---|---|---|---|---|---|---|
| 1 | Monte Cristo Wireless LLC | 222 E Monte Cristo Rd, Edinburg 78541 | professional_service | 0.804 | open | yes |
| 2 | RGV Fearless Boxing Gym | 5202 N La Homa Rd , Mission 78574 | gym | 0.877 | open | no |
| 3 | DQ Grill & Chill | 844 Boca Chica Blvd, Brownsville 78520 | fast_food_restaurant | 0.800 | — | yes |
| 4 | GRL Motors | 6024 S 23rd St, McAllen 78503 | auto_dealer | 0.802 | — | no |
| 5 | VNCC | —, Brownsville — | religious_organization | 0.846 | open | yes |
| 6 | PlainsCapital Bank ATM | 1311 S Cage Blvd, Pharr 78577 | bank_or_credit_union | 0.850 | — | yes |
| 7 | Raising Hope Counseling Services | 3507 W Alberta Rd, Edinburg 78539 | behavioral_or_mental_health_clinic | 0.802 | — | yes |
| 8 | Empire Fresh Cold Storage | 2101 W Military Hwy Ste H-11, McAllen 78503 | — | 0.850 | — | no |
| 9 | Los Toxicos Tacos y Algo Mas | 7155 Boca Chica Blvd, Brownsville 78521 | restaurant | 0.866 | open | no |
| 10 | Medex Transportation Services, Inc | 1217 S Cynthia St, McAllen 78501 | — | 0.850 | — | yes |
| 11 | Domino's Pizza | 7205 W. Mile 7 Rd, Mission 78574 | food_service | 0.800 | — | yes |
| 12 | SE40766 BROWNSVILLE TX | 7951 SOUTHMOST, BROWNSVILLE 78521 | gas_station | 0.800 | — | yes |
| 13 | Lindberg Pharmacy | 5203 S Mccoll Rd, Edinburg 78539 | pharmacy_and_drug_store | 0.850 | — | yes |
| 14 | Academy Sports + Outdoors | 3300 W Nolana Ave BLDG 100, McAllen 78504 | sporting_goods_store | 0.800 | — | yes |
| 15 | Hotspot Express | 1301 N 23rd St, McAllen 78501 | home_service | 0.868 | open | yes |
| 16 | Strikker Motors | 625 N Mccoll Rd, McAllen 78501 | — | 0.850 | open | yes |
| 17 | Ridgewood Optical | 847 Ridgewood St, Brownsville 78520 | vision_or_eye_care_clinic | 0.845 | — | no |
| 18 | Hidalgo Water Park | —, Hidalgo — | park | 0.807 | — | yes |
| 19 | Alpha Barber Studio | 4309 N 10th St STE A1, McAllen 78504 | personal_or_beauty_service | 0.877 | open | yes |
| 20 | Golden Girl Boutique | 913 E Washington St, Brownsville 78521 | fashion_and_apparel_store | 0.857 | open | yes |

#### 0.9–1.0

| # | name | address | category | conf | status | web |
|---|---|---|---|---|---|---|
| 1 | Law Office of Hector Bustos, PLLC | 220 S Jackson Rd, Edinburg 78539 | attorney_or_law_firm | 0.920 | open | no |
| 2 | Vida's Beauty Salon and Barber Shop | 124 Avenida del Palacio, Brownsville 78520 | personal_or_beauty_service | 0.920 | open | no |
| 3 | Los Fresnos United Band Hall | 33790 FM803, Los Fresnos 78586 | high_school | 0.990 | open | yes |
| 4 | Kiki's | 1700 Southmost Rd, Brownsville 78521 | restaurant | 0.920 | open | yes |
| 5 | Ochoa's Pharmacy South | 301 E Conquest Blvd, Edinburg 78539 | pharmacy_and_drug_store | 0.920 | open | yes |
| 6 | United States Postal Service | 810 E US Highway 281, Los Indios 78567 | shipping_or_delivery_service | 0.966 | — | yes |
| 7 | Triple H Produce LLC | 9901 S Keystone Dr, Pharr 78577 | b2b_transportation_and_storage_service | 0.920 | open | yes |
| 8 | Jackson Hewitt Tax Service | 721 S Bicentennial Blvd, McAllen 78501 | financial_service | 0.920 | open | yes |
| 9 | Jack in the Box | 3355 International Blvd, Brownsville 78521 | fast_food_restaurant | 0.990 | open | yes |
| 10 | National Car Rental | 700 Amelia Earhart Dr, Brownsville 78521 | rental_service | 1.000 | — | yes |
| 11 | Panini Cafe & Deli | 1620 W University Dr, Edinburg 78539 | health_care | 0.950 | open | no |
| 12 | Green Insurance Group | 605 N Main St, La Feria 78559 | financial_service | 0.920 | open | no |
| 13 | JCPenney Optical | 2200 S 10th St, McAllen 78503 | fashion_and_apparel_store | 0.988 | — | yes |
| 14 | Atlas Injury and Rehab | 615 S Aster St, Pharr 78577 | physical_medicine_and_rehabilitation | 0.920 | open | no |
| 15 | Valley Wide Security | 810 E Van Buren St, Brownsville 78520 | professional_service | 0.920 | open | yes |
| 16 | Hector Urrutia | 100 E Ridge Rd Ste A, McAllen 78503 | specialized_health_care | 0.920 | open | no |
| 17 | McAllen PREMIER Volleyball Club, LLC |  220 S. 25th Ave Edinburg, TX 78542, McAllen 78542 | sport_team | 0.972 | open | no |
| 18 | The Radiant Room | 119 W Park Ave, Pharr 78577 | wellness_service | 0.920 | open | yes |
| 19 | Stripes | 1611 S Closner Blvd, Edinburg 78539 | convenience_store | 0.958 | open | yes |
| 20 | GDV Realty | 1601 W Trenton Rd Ste:L, Edinburg 78539 | real_estate_service | 0.920 | open | yes |
