---
phase: 04-places-transient-verifier
plan: 02
subsystem: config + repo guards
tags: [env, kill-switch, places, cron, guards, walker]
requires: []
provides:
  - "env.PLACES_MODE: 'off' | 'ids_only' | 'enterprise' (default 'off'; unknown value throws at boot)"
  - "env.CRON_SECRET: string (min 16) | undefined"
  - "tests/unit/_walk.ts: walk(dir, { exts?, exclude? }) + GENERATED_EXCLUDES"
affects:
  - "04-12 (Places client reads the key directly; owns FORBIDDEN / allow-list / HEADER_MAY_BE_NAMED_IN edits)"
  - "04-17 (purge route must refuse when env.CRON_SECRET is undefined)"
  - "any plan adding a source-walking guard: import { walk } from './_walk'"
tech-stack:
  added: []
  patterns:
    - "Env '' -> undefined via `||` before zod (GitHub Actions empty-secret rule) for PLACES_MODE and CRON_SECRET"
    - "Shared test walker with segment-bounded generated-code exclusion; every guard keeps its two-sided assertion"
key-files:
  created:
    - tests/unit/_walk.ts
    - tests/unit/walk.test.ts
    - tests/unit/places-env.test.ts
  modified:
    - src/env.ts
    - .env.example
    - tests/unit/no-google-credential.test.ts
    - tests/unit/no-network.test.ts
    - tests/unit/field-mask-tier.test.ts
decisions:
  - "walk()'s `exts` is optional (absent = every file) so field-mask-tier's all-extensions walk is preserved rather than narrowed"
  - "The generated-tree exclusion matches whole path segments, not a bare substring, so look-alikes (workflow-notes/, myapp/.well-known/workflow) are still scanned"
metrics:
  duration: "~20 min"
  completed: 2026-09-23
  tasks: 2
  files: 8
---

# Phase 4 Plan 02: PLACES_MODE kill switch + shared guard walker Summary

`PLACES_MODE` (off | ids_only | enterprise, default off, typo throws naming the variable) and a `min(16)` optional `CRON_SECRET` are declared in `src/env.ts`. The Places key is deliberately absent (D-03). The credential guard was watched red and then amended, not deleted. The three repo-grep guards now share one walker that skips `src/app/.well-known/workflow/**`, and each guard proves it still reads real files.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (RED) | d23201e | test(04-02): add failing tests for PLACES_MODE and CRON_SECRET parse contract |
| 1 (GREEN) | 0f6df27 | feat(04-02): declare PLACES_MODE kill switch and CRON_SECRET in src/env.ts |
| 2 | 024e19a | test(04-02): one shared source walker that skips the generated workflow tree |

## Task 1: PLACES_MODE and CRON_SECRET

- RED: `tests/unit/places-env.test.ts` failed 4/4 against the old `src/env.ts`. For example, the CRON case failed with `promise resolved "{ CLERK_SECRET_KEY: 'sk_test_x', …(2) }" instead of rejecting`.
- GREEN: I added the schema entries plus `PLACES_MODE: process.env.PLACES_MODE || undefined` and `CRON_SECRET: process.env.CRON_SECRET || undefined` to the `safeParse` argument. A comment explains why the Places key is absent without spelling its name or the word GOOGLE.
- **Red run of the old guard, before the amendment** (quoted as required):

```
 ✓ |node| tests/unit/no-google-credential.test.ts > no Google credential in the source tree > no google credential is read anywhere in src 614ms
 × |node| tests/unit/no-google-credential.test.ts > no Google credential in the source tree > src/env.ts declares no Google variable 41ms
   → expected 'import \'server-only\';\r\nimport { z…' not to contain 'PLACES'
 ❯ tests/unit/no-google-credential.test.ts:87:24
     86|     expect(source).not.toContain('GOOGLE');
     87|     expect(source).not.toContain('PLACES');
```

- Amended (not deleted): renamed to `src/env.ts declares no Google variable and only the PLACES_MODE switch`, using `expect(source.replaceAll('PLACES_MODE', '')).not.toContain('PLACES')`. I also added a positive control, `expect(source).toContain('PLACES_MODE')`, so the strip always has something to remove.
- `.env.example` now lists `PLACES_MODE=off`, `GOOGLE_PLACES_API_KEY=` and `CRON_SECRET=` as names only, each with its comment. No guard scans `.env.example`: the credential walk covers `src/` only.
- PASS list (all four `places-env` tests named):
  - `PLACES_MODE defaults to off when unset or empty`
  - `PLACES_MODE accepts ids_only and enterprise`
  - `PLACES_MODE refuses an unknown value`
  - `CRON_SECRET is optional and refused when shorter than 16 characters`
  - plus `src/env.ts declares no Google variable and only the PLACES_MODE switch`, and all 5 `env-alias` tests still green.

### Mutation checks (each applied to the committed tree, run, reverted with `git checkout -- src/env.ts`, diff clean)

| Mutation | Went red |
|---|---|
| drop `.default('off')` | `PLACES_MODE defaults to off when unset or empty`. The CRON test was also red as collateral, because a required PLACES_MODE fails every load. |
| enum -> `z.string().default('off')` | `PLACES_MODE refuses an unknown value` (only) |
| drop `.min(16)` | `CRON_SECRET is optional and refused when shorter than 16 characters` (only) |
| drop `|| undefined` on PLACES_MODE | `PLACES_MODE defaults to off when unset or empty` (only) |
| add `PLACES_KEY: z.string().optional()` to env.ts | `src/env.ts declares no Google variable and only the PLACES_MODE switch` (only) |

## Task 2: Shared walker

- `tests/unit/_walk.ts` exports `walk` and `GENERATED_EXCLUDES`. `tests/unit/walk.test.ts` has the three tests below (vitest named them under `tests/unit/_walk.ts`):
  - `the shared walker skips src/app/.well-known/workflow` is two-sided. The same temp tree walked with `exclude: []` does contain the generated route.
  - `the shared walker honours its extension set`
  - `the shared walker does not skip a look-alike sibling` (extra; see Deviations)
- All three guards now `import { walk } from './_walk'`. `grep -c "function walk"` gives 0/0/0 and `grep -c "from './_walk'"` gives 1/1/1. Every existing assertion is kept, and each guard gained `expect(scanned.some(... '.well-known' ... 'workflow' ...)).toBe(false)`. That probe uses the posix form in no-network and field-mask-tier, whose paths are posix-mapped; the plan's `nodePath.join` form would have been vacuous on Windows there. No FORBIDDEN, allow-list or `HEADER_MAY_BE_NAMED_IN` entry changed.

### In-repo proof and mutations

- I planted a fake generated route at `src/app/.well-known/workflow/v1/step/route.ts`. It contained a `GOOGLE_*KEY` env read, the Comptroller host and `X-Goog-FieldMask`. All three guards stayed **green**.
- Mutation `GENERATED_EXCLUDES = []`, with the probe still planted, turned four tests **red**:
  - `no google credential is read anywhere in src`
  - `CI never reaches the network`
  - `X-Goog-FieldMask is named in at most one module under src`
  - `the shared walker skips src/app/.well-known/workflow`
- Mutation: loose `full.includes(x)` match turned `the shared walker does not skip a look-alike sibling` red (only).
- Mutation: extension check removed turned `the shared walker honours its extension set` red (only).
- After each mutation I restored the walker and `cmp` confirmed it was byte-identical to the pre-mutation copy. I then deleted the probe tree, and `git status` was clean apart from the intended files.

## Gates (worktree, HEAD 024e19a)

- `npx vitest run tests/unit`: **48 files / 347 tests passed**, both before and after `next build`.
- `npx tsc --noEmit`: exit 0.
- `npx eslint . --ignore-pattern ".claude/**"`: exit 0.
- `npx next build`: exit 0. It did **not** generate `src/app/.well-known/workflow`, because `withWorkflow` is not wired in this base (`next.config.ts` has `reactStrictMode` only; another Phase 4 plan wires it). So the "survives a build" criterion is proven by the planted-probe run above, not by real generated output. Once `withWorkflow` lands, re-run the unit suite after a build.
- The db lane was not run, since this plan touches no schema or db code.

## Deviations from Plan

**1. [Rule 1 - Correctness] `walk()`'s `exts` is optional rather than required.**
- **Found during:** Task 2.
- **Issue:** the plan's walker required `exts`, but field-mask-tier's private walker had no extension filter and scanned every file. Passing any extension set would have narrowed that guard and opened a hole.
- **Fix:** `exts?: ReadonlySet<string>`, where absent means every file. field-mask-tier calls `walk(dir)` and posix-maps the result, as before.
- **Commit:** 024e19a.

**2. [Rule 2 - Correctness] The exclusion is segment-bounded, not `full.includes(x)`.**
- **Issue:** the plan's `full.includes(x)` would also skip `app/.well-known/workflow-anything/` and `myapp/.well-known/workflow/`. Under the project's own "an exclusion is a hole" rule, both should still be scanned.
- **Fix:** a match on `sep + x + sep` against `sep + full + sep`, pinned by a third walker test that went red under the loose-match mutation.
- **Commit:** 024e19a.

**3. Verify commands.** Per the orchestrator's Windows note, I ran `npx vitest run <file> --reporter=verbose` instead of `$PNPM test:unit -t` and read test names directly.

**4. TDD order for Task 2.** I wrote `_walk.ts` before `walk.test.ts`, and both landed in one `test(...)` commit, because the task is test infrastructure with no separate feature code. Red was demonstrated by the mutations above rather than by a pre-implementation run.

## Known Stubs

None.

## Threat Flags

None. There is no new network or auth surface. T-4-01, T-4-02, T-4-05 and T-4-08 are mitigated as planned:
- T-4-01: the key is not in env.ts, and `.env.example` says it is never `NEXT_PUBLIC_`.
- T-4-02: `PLACES_MODE` defaults to off and a typo throws.
- T-4-05: the exclusion is explicit, tested and two-sided.
- T-4-08: `CRON_SECRET` requires `min(16)`, and absent means `undefined`.

## Notes for the orchestrator / merge

- `tests/unit/no-google-credential.test.ts` and `tests/unit/field-mask-tier.test.ts` are the files 04-12 edits (FORBIDDEN / allow-list / `HEADER_MAY_BE_NAMED_IN`). Expect textual merge proximity. This plan touched only their walker plumbing and the env.ts assertion.
- Any later plan that adds a source-walking guard should `import { walk } from './_walk'` instead of writing a private walker.

## Self-Check: PASSED

- FOUND: tests/unit/_walk.ts, tests/unit/walk.test.ts, tests/unit/places-env.test.ts, src/env.ts, .env.example
- FOUND commits: d23201e, 0f6df27, 024e19a
