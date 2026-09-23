# `merge-pairs.json` and `merge-triple.json`: the D-09 scorer fixture

These are the pinned inputs for `src/lib/resolve/score.ts`, asserted EXACTLY (integer score,
band, signals array) by `tests/unit/score.test.ts`. Re-tuning a weight is a constant edit
that turns a test red. That is the point, so never widen an assertion into a range.

## Real vs synthetic

- **Real pairs (P01–P05, P10)**: the Comptroller side's name, address, county and NAICS were
  read from the live `jrea-zgmq` dataset on 2026-09-22. Names were normalized with D-12, and
  `nameSim` is the pg_trgm similarity of the normalized pair, taken from a reimplementation
  that reproduces the research's one measured value (SOUTHWEST MEDICAL HOMEPATIENT, 0.848).
  The Comptroller `clusterKey` comes from the seeded NAICS ranges in
  `src/seed/data/clusters.json`, the same derivation 03-12 uses. **A NAICS code outside all
  four clusters is `null`, never a guess.**
- **Synthetic pairs (P06–P09) and `merge-triple.json`**: the research gives no real names for
  these rule exercises. Every one is flagged `"synthetic": true` and its names start with
  `Synthetic`/`SYNTHETIC`. Every phone is in the fictional `555-01xx` range. The D-12
  normalizer refuses 555 numbers, so `phoneBlockable` is set by hand.

## Assumptions (each entry's `assumptions` array)

- **Overture-side cluster keys** (P01, P03, P04) are assumptions until 03-08's
  `basic_category -> cluster_key` map exists. The fixture carries the cluster as data, so the
  scorer does not need that map. **03-08 and 03-20 must confirm them.**
- **Coordinates** of real pairs are fixture positions inside the stated distance tier. The
  real Census and Overture points arrive with the 03-20 desk run.

## Known misses: 03-20 owns them

Entries with `"known_miss": true` carry `intended_band` and a one-line `why`. Each pins the
band the committed weights ACTUALLY produce, which differs from the band the pair deserves:

| id | actual | intended | why |
|---|---|---|---|
| P02 | 79 ignore | review | NAICS 811411 is in no cluster, so cluster scores 0 not +5 |
| P03 | 78 ignore | review | name sim 0.7727. **The real recall gap:** a same-address typo duplicate that nobody would ever review |
| P10 | 90 review | merge | NAICS 327991 is in no cluster, so a true duplicate tops out at 90 |

P05 is not a miss (the band is right), but its score is 45, not the research's 35, for the
same out-of-cluster reason. **03-20, the live desk run, is where these get confronted with
measured numbers.** Any re-tune happens there, as an edit that turns these tests red.

`merge-triple.json` exists because P10 no longer auto-merges: 03-11/03-14's three-way merge
(mutation M25) must use this synthetic ≥95 triple.
