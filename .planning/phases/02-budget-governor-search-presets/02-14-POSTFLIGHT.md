# 02-14 Task 2 — Production migration, seed and post-flight (WRITE, then READ)

Companion to `02-14-PREFLIGHT.md`. Every verification below ran on a **separate, later,
read-only connection** (`begin read only`) — never by re-reading a mutating script's output.
Only names and counts were selected. No connection string, password or key was printed or
stored.

- **Executed:** 2026-09-22
- **Production target:** Supabase `jahgeqshuesndyscnmjo`, via `SUPABASE_DB_URL` (session
  pooler, port 5432), as the project owner
- **Local target:** `TEST_DATABASE_URL`
- **Written by:** `drizzle-kit migrate` and `scripts/seed.ts` only. No Supabase CLI, no MCP
  `apply_migration`, no dashboard SQL editor. `ls supabase` still exits 2 — there is no
  Supabase CLI migration directory in this repository. D-09 holds.

## danlo's approval, verbatim

> 🔑 **The first line is the Phase 2 / Phase 3 shared contract.** Phase 3's city picker reads
> this list.

```
prod migration: approved
prod seed: approved
city list: 17 as measured
```

**The 17 stand as measured.** Raymondville (221 active sales-tax outlets, Willacy County's
only town) stays below the 400-outlet line and is therefore NOT in the picker; Willacy is
unrepresented among cities though present among counties. No follow-up is owed, and
`src/seed/data/cities.json` still lists the next five candidates should that ever change.

## Step 1 — `pnpm db:migrate:prod`

Exit 0. The five Phase 2 migrations applied in order:
`0012_eager_vertigo`, `0013_reference_policies_and_grants`, `0014_brown_phantom_reporter`,
`0015_budget_grants_and_triggers`, `0016_budget_meter_functions`.

**Not one statement was refused by PostgreSQL 17.6.** That is the claim
`tests/unit/pg17-compat.test.ts` exists to protect, and it is now proven on the real server
rather than argued from a grep.

## Step 2 — `pnpm db:migrate:prod` a second time

Exit 0, applied nothing.

🔴 **The exit code and the success banner do not discriminate.** `drizzle-kit migrate` prints
`[✓] migrations applied successfully!` on *both* runs — a no-op run is not announced as one.
The discriminating evidence is the journal itself and the volume of work:

| Evidence | First run | Second run |
| --- | --- | --- |
| `drizzle.__drizzle_migrations` rows afterwards | 17 | **still 17** (not 22) |
| stdout bytes | 2,261 | 389 |
| `applying migrations` spinner frames | 56 | 1 |

Had the second run re-applied anything, the journal would hold 22 rows — and in fact a
re-applied `create table` would have raised `42P07` and exited non-zero, so exit 0 is a
second, independent witness.

## Step 3 — `pnpm db:seed:prod`, twice

Both exit 0. Both summary blocks verbatim:

```
$ pnpm db:seed:prod            (first run)
scripts/seed.ts: target=prod
counties: 254 inserted, 0 updated
industry_clusters: 4 inserted, 0 updated
industry_terms: 33 inserted, 0 updated
cities: 17 inserted, 0 updated
outlet_counts: 20 inserted, 0 updated
geo_presets: 3 inserted, 0 updated
```

```
$ pnpm db:seed:prod            (second run)
scripts/seed.ts: target=prod
counties: 0 inserted, 254 updated
industry_clusters: 0 inserted, 4 updated
industry_terms: 0 inserted, 33 updated
cities: 0 inserted, 17 updated
outlet_counts: 0 inserted, 20 updated
geo_presets: 0 inserted, 3 updated
```

**0 inserted for every table on the second run**, and the row counts below are unchanged —
so the `on conflict on constraint` / `NULLS NOT DISTINCT` pairing held on 17.6 exactly as it
does on 18. This is the regression the loader's comment block warns about (a plain
`UNIQUE (org_id, key)` would have silently doubled every built-in here); it did not occur.

## Step 4 — Post-flight, production beside local

| Reading | Production | Local | Verdict |
| --- | --- | --- | --- |
| `version()` | PostgreSQL 17.6 | PostgreSQL 18.6 | **expected difference — the point of this plan** |
| `drizzle.__drizzle_migrations` rows | 17 | 17 | match |
| `public` tables | 16 | 16 | match |
| `public` tables WITHOUT `relrowsecurity` | (none) | (none) | match |
| this phase's twelve tables, present AND `relrowsecurity = true` | 12 | 12 | match |
| `pg_policy` total | 56 | 56 | match |
| `pg_policy` in `public` | 56 | 56 | match |
| the eight named constraints | 8 of 8 | 8 of 8 | match |
| `app.*` functions | 11 | 11 | match |
| this phase's five `app.*` functions | 5 of 5 | 5 of 5 | match |
| non-internal triggers **in `public`** | 19 | 19 | match |
| non-internal triggers, unscoped | 27 | 19 | **expected difference — see below** |
| `search_versions` grants to `authenticated` | `INSERT, SELECT` | `INSERT, SELECT` | match |
| `budget_periods` grants to `authenticated` | `SELECT` | `SELECT` | match |
| `cost_reservations` grants to `authenticated` | `SELECT` | `SELECT` | match |
| `cost_ledger` grants to `authenticated` | `SELECT` | `SELECT` | match |
| `runs` table-level grants to `authenticated` | `INSERT, SELECT` | `INSERT, SELECT` | match |
| `runs` columns `authenticated` may UPDATE | `calls_count, cost_micro_usd, finished_at, started_at, status, stopped_reason` | identical | match |
| `counties` rows (`org_id is null`) | 254 | 254 | match |
| `cities` rows | 17 | 17 | match |
| `industry_clusters` rows | 4 | 4 | match |
| `industry_terms` rows | 33 | 33 | match |
| `geo_presets` rows | 3 | 3 | match |
| `outlet_counts` rows | 20 | 20 | match |
| `counties where county_fips <> 2 * comptroller_code - 1` | 0 | 0 | match |
| `budget_periods_event_upd` `pg_get_triggerdef` | present | present | **byte-identical** |

**Every pair matches.** The two rows marked as differences are the two that are *supposed*
to differ, and both were predicted:

1. **17.6 versus 18.6 is the entire subject of this plan.** Every other gate in Phase 2 ran
   on 18; this is the only run that proves 17 accepts the same SQL.
2. **The unscoped trigger count is the 01-10 gotcha, repeated exactly.** Supabase ships
   non-internal triggers of its own outside `public`: `realtime` 1 + `storage` 7 = 8, so
   production reads `19 + 8 = 27` where local reads 19. Broken out by schema:

   | Schema | Production | Local |
   | --- | --- | --- |
   | `public` | 19 | 19 |
   | `realtime` | 1 | 0 |
   | `storage` | 7 | 0 |

   The **schema-scoped** count is the one that means anything, and it matches. A catalog
   count used as an acceptance criterion must be schema-scoped — 01-10 recorded this after
   the same criterion read 13 against a correct database.

### The trigger set, name for name

The 19 `public` triggers are identical on both, as sets — the local-minus-production and
production-minus-local differences are both empty:

```
budget_periods.budget_periods_event_ins_del   industry_terms.industry_terms_touch
budget_periods.budget_periods_event_upd       orgs.orgs_event
budget_periods.budget_periods_touch           orgs.orgs_touch
businesses.businesses_event                   outlet_counts.outlet_counts_touch
businesses.businesses_touch                   runs.runs_touch
cities.cities_touch                           search_versions.search_versions_event
cost_reservations.cost_reservations_touch     searches.searches_event
counties.counties_touch                       searches.searches_touch
geo_presets.geo_presets_touch                 source_records.source_records_touch
industry_clusters.industry_clusters_touch
```

`budget_periods_event_upd` carries its `WHEN` clause on production, read from
`pg_get_triggerdef` rather than assumed:

```sql
CREATE TRIGGER budget_periods_event_upd AFTER UPDATE ON public.budget_periods
  FOR EACH ROW WHEN ((old.cap_micro_usd IS DISTINCT FROM new.cap_micro_usd))
  EXECUTE FUNCTION app.log_event()
```

That `WHEN` is what keeps a cap that did not change from emitting an event — the same
class of defect as BIS's 10 spurious `update` events. It survived the trip to 17.6 intact.

### The grant facts, read as negatives

A grant table is easy to read optimistically. These were read as counts of what must be
**absent**, from `information_schema`, on production:

| Assertion | Production | Local |
| --- | --- | --- |
| `authenticated` rows granting UPDATE or DELETE on `search_versions` | **0** | 0 |
| `authenticated` rows granting INSERT/UPDATE/DELETE on `budget_periods`, `cost_reservations`, `cost_ledger` | **0** | 0 |
| `authenticated` rows granting UPDATE on `runs.search_version_id` | **0** | 0 |

- **T-2-12** rests on the first and third: a version is append-only and a run cannot be
  re-pointed at a different version after the fact.
- **T-2-02** rests on the second: the only write path to a cap is `app.set_budget_cap` with
  its SQL role check.
- **T-2-03** additionally requires `cost_ledger.reservation_id` to be `NOT NULL` behind a
  foreign key. On production: `attnotnull = true`, foreign keys referencing the column = 1.
  Identical locally. A ledger line cannot exist without the reservation that paid for it.
- **T-2-09**: the seed ran as the owner, which is the only role that can write an
  `org_id IS NULL` row at all, because `referencePolicies()` excludes NULL-org rows from
  every write policy. The reference tables show `authenticated` with
  `SELECT, INSERT, UPDATE, DELETE` at the *grant* layer — the exclusion is enforced by RLS
  policy, not by grant, which is why the policy count (56 = 56) is the load-bearing reading
  for this threat and not the grant list.

### Rows that differ for known test reasons

| Reading | Production | Local | Why |
| --- | --- | --- | --- |
| `orgs` total rows | 1 | 2 | a local fixture org from the wave-5 suites; not part of the comparison |
| `geo_presets` total rows | 3 | 3 | the wave-5 `e2e-*` presets were rolled back and are absent — built-ins only, on both |

## Findings

**1. `drizzle-kit migrate` announces success identically on a no-op run.** Recorded above
and now written into `docs/deploy.md`, because "the second run exited 0 and said it applied
migrations successfully" is exactly what a *broken* idempotency check would also print. The
journal row count is the witness.

**2. Nothing else.** No statement was refused, no object count diverged, no grant was
missing, no seeded count was off by a row, and the FIPS bijection holds on production.

## Credential scan

The plan's literal criterion `git grep -nE 'sk_|eyJ|://[^ ]*:[^ ]*@'` is unsatisfiable by
construction — the regex contains `sk_`, so every document that writes the regex down
matches itself (01-10 recorded this first; `02-14-PLAN.md` contributes two such lines and
`02-14-PREFLIGHT.md` a third). The discriminating scan 01-10 settled on was run instead and
is unchanged by this plan: no live-shaped key, no non-localhost connection string with a
real password, and the Supabase project ref appearing only as the identifier it is —
`docs/deploy.md` has published it since Phase 1.

No value printed by any command in this task was a credential; every script's output was
passed through a redactor before it was read.
