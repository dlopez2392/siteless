# Deferred items — phase 02

## 🔴 `savePresetVersion` cannot insert a version: `cluster_ids` is bound as N placeholders, not one array

**Found during:** plan 02-12, Task 2, by the first e2e run that actually pressed "Create the copy".
**Owner:** whoever holds `src/server/actions/save-preset-version.ts` — it is plan 02-11's
critical path (the preset editor's save), and plan 02-09 wrote it.
**Not fixed in 02-12 because:** 02-11 is executing in a parallel worktree against that exact
file. Two worktrees editing one line is the conflict the file partitioning exists to prevent,
so this is reported for a single central fix rather than raced.

### The defect

`src/server/actions/save-preset-version.ts` line ~143:

```ts
${resolved.clusterIds}::uuid[]
```

A JS array inside a drizzle `sql` template is expanded into a comma-separated **placeholder
list** — that is drizzle's behaviour so `in (...)` works — so it is not one `uuid[]`
parameter. Postgres receives a ROW constructor cast to an array.

Measured directly against the local `siteless_test` database (`test-results/probe-array.mjs`
during 02-12), at every arity:

| clusters | emitted SQL | result |
|---|---|---|
| 2+ | `($1, $2)::uuid[]` | `42846 cannot cast type record to uuid[]` |
| 1 | `($1)::uuid[]` | `22P02 malformed array literal` |

There is no arity at which this succeeds, so **no version can be saved through
`savePresetVersion` at all**. The action's `catch` maps the SQLSTATE to `unexpected`, so the
screen shows "Something broke on our side" and nothing upstream ever names an array problem.
That is why it survived 02-09 green.

### The fix (already applied to the twin defect in `duplicate-preset.ts`, commit in 02-12)

Bind the Postgres array **literal** as a single parameter and cast it once:

```ts
const clusterIdsLiteral = `{${resolved.clusterIds.join(',')}}`;
// ...
${clusterIdsLiteral}::uuid[]
```

It is a bound parameter rather than interpolated SQL, and every element is a uuid that came
out of the database, so there is no quoting or injection surface. A native JS array passed as
a single param (`$1::uuid[]`) also works on postgres.js and is an equally valid fix — both
were verified green in the same probe.

### What would have caught it, and should

`tests/db/versioned-presets.test.ts` exercises the TABLE, not the ACTION, so it inserts
`cluster_ids` with its own correct SQL and cannot see this. A db-level test that calls
`savePresetVersion` / `duplicatePreset` — rather than re-writing their INSERT — is the test
that closes this class. Same for the `$0`-estimate 1 µUSD hold that 02-09 already owes a
db test for.
