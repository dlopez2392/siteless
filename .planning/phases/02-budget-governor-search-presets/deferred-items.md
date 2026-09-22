# Deferred items — phase 02

Out-of-scope discoveries logged rather than fixed, per the executor scope boundary.

---

## 🔴 `readSpendByRun` binds a JS `Date` and will 500 the spend screen

- **Found by:** plan 02-11, while executing its own preset-list query against the real
  local database for the first time (2026-09-22).
- **File:** `src/server/queries/budget.ts`, line ~314 (plan 02-09).

```sql
where r.created_at >= ${from} and r.created_at < ${to}
```

`from` and `to` are JS `Date` objects from `periodWindow()`. drizzle's postgres-js driver
sends `tx.execute` parameters through postgres.js's `unsafe` path, which does **not**
type-infer a `Date` the way its tagged template does. At query time this throws, inside
drizzle's `Failed query:` wrapper:

```
TypeError: The "string" argument must be of type string or an instance of Buffer or
ArrayBuffer. Received an instance of Date
```

Plan 02-11 hit the identical defect in its own new query and fixed it there by binding
`from.toISOString()` with an explicit `::timestamptz` cast. **The occurrence in
`budget.ts` is untouched** — it is 02-09's file and 02-13's screen, and both are being
executed in sibling worktrees right now; editing it here would be a merge conflict for a
line neither of us owns.

**Why no gate caught it:** `pnpm typecheck`, `pnpm lint`, `pnpm build` and `pnpm test:unit`
are all green against it. 02-09's SUMMARY says so itself — "No database was touched… every
statement in these modules is verified by `tsc` and by reading the migrations rather than
by execution." `readSpendByRun` has still never been executed.

**Owner:** plan 02-13 (`/spend` → By run) — it will 500 on first load otherwise.
**Fix:** `${from.toISOString()}::timestamptz` / `${to.toISOString()}::timestamptz`.
**Also worth checking:** any other `tx.execute` in `src/server/` binding a `Date`.
`grep -rn '\${[a-zA-Z]*}' src/server/queries/*.ts` and check each parameter's type.

---

## 🔴 `duplicatePreset` binds a uuid array the same way `savePresetVersion` did

- **Found by:** plan 02-11, by grepping for the defect it had just been blocked by.
- **File:** `src/server/actions/duplicate-preset.ts`, line ~91 (plan 02-09).

```sql
(app.current_org_id(), ${created.id}, 1, ${source.cluster_ids}::uuid[],
```

Plan 02-11 proved, by executing it, that interpolating a **JS array** into a drizzle `sql`
template expands it into a parenthesised list, so Postgres receives
`($3, $4)::uuid[]` — a ROW expression cast to an array, which it refuses. Every save of a
multi-cluster preset failed with `unexpected`. 02-11 fixed its own blocker in
`save-preset-version.ts` with `sql.join` (one bound placeholder per id) and **did not touch
`duplicate-preset.ts`** — that is 02-12's screen (the Duplicate dialog, D-17).

⚠️ **Verify before assuming it is broken.** `source.cluster_ids` there is READ BACK from
Postgres rather than built in TypeScript, and 02-11 separately measured that a `timestamptz`
comes out of `tx.execute` as a **string** — so `cluster_ids` may well arrive as the array
LITERAL `'{a,b}'`, bind as a single parameter, and work by accident. Run the duplicate path
once against the real database before changing the line; if it is broken, the fix is the
same `sql.join` form.

**Owner:** plan 02-12.

---

## Nine `e2e-*` presets remain in the shared `siteless_test` database

`tests/e2e/presets.spec.ts` creates real `searches` + `search_versions` rows named
`e2e-<epoch>-{cities,county,radius}`. Plan 02-11 ran the spec three times end to end while
debugging two blocking defects, so **nine** rows exist, across three run prefixes:
`1790096442647`, `1790096478427`, `1790097027886`. The list reads
`9 presets · none run this month`. **They were not deleted.** Phase 2 ships no archive
and no delete path by design (02-CONTEXT § Deferred Ideas), and `search_versions` is
append-only by GRANT — `revoke update, delete` in `drizzle/0013`, which is the mechanism
behind SRCH-03. So the product itself cannot remove them, and the only way to clean up is a
migration-privileged statement against a database two sibling plans are using concurrently.

They are harmless (the list is ordered by `updated_at desc` and nothing asserts a count) and
identifiable by the `e2e-` prefix. Whoever next has the local database to themselves can
delete them as the owner role.
