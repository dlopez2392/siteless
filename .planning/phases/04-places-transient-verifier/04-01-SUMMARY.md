---
phase: 04-places-transient-verifier
plan: 01
subsystem: infra
tags: [workflow-devkit, vitest, next16, proxy, ci, pnpm]
requires: []
provides:
  - "workflow@4.8.9 (dep) + @workflow/vitest@4.0.25 (devDep), exact pins, clean frozen install"
  - "next.config.ts wrapped in withWorkflow()"
  - "src/proxy.ts first matcher excludes /.well-known/workflow/"
  - "pnpm test:workflow — third vitest lane (vitest.workflow.config.ts) + tests/workflow/lane.test.ts"
  - "every vitest config forces GOOGLE_PLACES_API_KEY='test-key-not-real'"
  - "CI db job runs pnpm test:workflow after pnpm test:db"
affects: [04-02, 04-22, every plan that writes "use workflow" / "use step"]
tech-stack:
  added: [workflow@4.8.9, "@workflow/vitest@4.0.25"]
  patterns:
    - "Third test lane: workflow() vite plugin, TZ/LANG pinned on line 1, forced fake Places key + PLACES_MODE=enterprise after .env.local"
    - "pnpm allowBuilds: every entry carries a written reason (@swc/core true, cbor-extract false)"
key-files:
  created:
    - vitest.workflow.config.ts
    - tests/workflow/lane.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml
    - pnpm-workspace.yaml
    - next.config.ts
    - src/proxy.ts
    - .gitignore
    - .prettierignore
    - eslint.config.mjs
    - vitest.config.ts
    - vitest.db.config.ts
    - .github/workflows/ci.yml
decisions:
  - "@swc/core build script ALLOWED (exact peer 1.15.3 of @workflow/swc-plugin, verified in its package.json); cbor-extract DENIED (cbor-x pure-JS fallback)"
  - "CI step comment avoids spelling the three forbidden variable names so the acceptance grep over ci.yml stays empty; comment sits below the step so test:workflow is the line directly after test:db"
metrics:
  duration: "~33 min"
  completed: 2026-09-23
  tasks: 3
  files: 13
---

# Phase 4 Plan 01: Workflow DevKit install, proxy exclusion, and workflow test lane Summary

Workflow DevKit 4.8.9 is installed with exact pins and both of its install scripts decided in writing. `next build` compiles it through `withWorkflow()` and emits the three `/.well-known/workflow/v1/*` routes, and the proxy matcher now skips those routes. The new `pnpm test:workflow` lane loads the `workflow()` vite plugin and pins its settings (zone, locale, fake Places key, paid mode, `server-only` no-op), and the CI db job runs it.

## What was done

**Task 1 (eb936f3): pinned the packages, decided the build scripts, ignored the generated trees**
- `workflow: "4.8.9"` goes in dependencies and `@workflow/vitest: "4.0.25"` in devDependencies, both exact.
- The first `pnpm add` exited 1 with `ERR_PNPM_IGNORED_BUILDS` for `@swc/core@1.15.3` and `cbor-extract@2.2.2`, as expected. Both now have `allowBuilds` entries, each with a written reason:
  - `@swc/core` is allowed. `pnpm why` shows it pulled by `@workflow/builders`, and `@workflow/swc-plugin@4.1.3` declares `peerDependencies: { "@swc/core": "1.15.3" }`.
  - `cbor-extract` is denied. It comes in through `cbor-x` from `@workflow/world-vercel`.
- I deleted `node_modules` with Node `rmSync` and ran `pnpm install --frozen-lockfile`. It exited 0 with no `ERR_PNPM_IGNORED_BUILDS`, and the `@swc/core postinstall: Done` line was in the log.
- Added the `test:workflow` script and chained it into `verify` after `test:db`.
- Ignore entries went into `.gitignore` (`.workflow-data/`, `.workflow-vitest/`, `.swc/`, `src/app/.well-known/workflow/`), `.prettierignore` (three entries) and the ESLint ignores (three entries, each with a why-comment).

**Task 2 (c0b5c17): withWorkflow, the proxy exclusion, and the workflow lane**
- `next.config.ts` now exports `withWorkflow(nextConfig)`.
- In `src/proxy.ts`, `\\.well-known/workflow/` is added to the first matcher's negative lookahead, with a one-line comment above `config`. I tested the matcher as a JS regex: `/.well-known/workflow/v1/{flow,step,webhook/abc}` no longer match, while `/businesses`, `/api/health` and `/.well-known/other` still do. The Phase 1 token greps still pass: `createRouteMatcher` 0, `auth.protect` 0, `runtime` 0, `__clerk` 1.
- `vitest.config.ts`, `vitest.db.config.ts` and `vitest.workflow.config.ts` each contain `test-key-not-real` exactly once.
- `vitest.workflow.config.ts`:
  - pins TZ and LANG on its first lines, then loads `.env.local` with `override:false`
  - then forces the fake key, `PLACES_MODE=enterprise` and the Clerk placeholder
  - uses `plugins: [workflow()]` and aliases `@` and `server-only` (the latter to the same `require.resolve` no-op target the unit lane uses)
  - runs with forks, `fileParallelism:false` and 60 s timeouts.
- `tests/workflow/lane.test.ts` has one test, `the workflow lane pins zone, locale and a fake Places key`. It asserts:
  - TZ is UTC and LANG is en_US.UTF-8
  - the zone actually reached the process: `new Date(Date.UTC(2026,0,1)).getHours() === 0`
  - the fake key and `PLACES_MODE=enterprise` are set
  - `import('server-only')` resolves.
- **Mutation checks.** I read the test name in each red run:
  - Removing the key assignment from `vitest.workflow.config.ts` made the named test fail with `expected undefined to be 'test-key-not-real'`.
  - Removing the `server-only` alias made it fail with `promise rejected "Error: This module cannot be imported fro…"`.
  - I reverted both; `grep -c MUT` returns 0 and both lines are back in place.

**Task 3 (c857cd2): CI runs the lane**
- In the db job, `- run: pnpm test:workflow` is on the line directly after `- run: pnpm test:db`. I parsed ci.yml with js-yaml: the db steps end `... pnpm db:seed | pnpm test:db | pnpm test:workflow`.
- `grep -n "GOOGLE_PLACES_API_KEY\|PLACES_MODE\|CRON_SECRET" .github/workflows/ci.yml` returns nothing (grep exit 1).

## Gates run (worktree, branch worktree-agent-a2e5703d30b80f430)

| Gate | Result |
|------|--------|
| `pnpm install --frozen-lockfile` from empty node_modules | exit 0, no ignored builds |
| `npx tsc --noEmit` | exit 0 (run after Task 1 and after Task 2) |
| `npx eslint . --ignore-pattern ".claude/**"` | exit 0 (before and after build) |
| `vitest --config vitest.workflow.config.ts` | 1 file / 1 test passed; name read in verbose output |
| `tests/unit/server-actions-guard.test.ts` | 6/6 passed |
| `npx next build` | exit 0; reported `workflows build complete (3 steps, 0 workflows)`; routes `/.well-known/workflow/v1/{flow,step,webhook/[token]}` emitted; after the build, branch `worktree-agent-a2e5703d30b80f430` @ `c0b5c17` |
| `npx vitest run tests/unit` (after build, with generated tree present) | 46 files / 340 tests passed |
| `vitest --config vitest.db.config.ts` | 218 passed / 4 failed. All 4 are noise from other plans sharing the database (see below) |

## Deviations from Plan

1. **[Rule 3 - Blocking] `vitest.config.ts` never loads `.env.local`.** The plan says to add the assignment "after their `.env.local` load", but the unit config has no such load. I put the assignment right after the imports, above `alias`, and noted in its comment that it runs unconditionally, so it also overwrites a key exported in the shell. The db and workflow configs place it after `loadEnv` as planned.
2. **[Rule 1 - Plan conflict] The CI comment.** The plan's comment text spelled `CRON_SECRET`, which would have failed its own acceptance criterion that `grep ... CRON_SECRET` over ci.yml returns nothing. It also put the comment before the step, which contradicts "on the line after `pnpm test:db`". I reworded it to "no Places key, Places mode or cron secret" and moved it below the step (`# ^ ...`).
3. **The lane test also asserts LANG and a process-level zone check**, in addition to the four assertions the plan asked for. The test name says "locale", and an env var alone doesn't prove the zone reached `Date`.
4. **Commands used the direct tools** (`npx tsc`, `npx eslint`, `npx vitest`, `npx next build`) rather than `$PNPM <script>`, following the orchestrator's Windows guidance. Install and add used pnpm 12.5.1 through the store launcher.

## Notes for the orchestrator / merge

- **Pitfall 6 did not fire here.** With the generated `src/app/.well-known/workflow/**` tree present after the build, `field-mask-tier`, `no-network` and `no-google-credential` all passed. The generated bundles contain 0 workflows and no Places tokens yet (checked for `X-Goog-FieldMask` and `places.googleapis` with grep). They will trip the walkers once a step references the Places client, so 04-02's shared excluding walker is still required. The wave-end order (build, then test:unit) should run with 04-02 merged.
- **The db-lane failures come from other plans sharing the local database, not from this change**, whose only db-lane edit is one env assignment:
  - `grants-audit` shows extra tables such as `place_attachments`, which come from 04-09's migrations.
  - `event-trigger` expects 7 trigger rows and got 8, another table added by a different plan.
  - `versioned-presets` fails on `runs_one_active_per_org`; that constraint is in no file in this tree.
  - `blocking` hit a duplicate `businesses_external_key_uniq` under contention, and it passed when re-run alone.
- **Prettier `--check` warns on the pre-existing files I edited.** That is because the worktree was checked out with CRLF line endings: `src/env.ts`, which I did not touch, warns the same way, and all six pass with `--end-of-line crlf`. My new files are LF and pass. Nothing needs fixing.
- There is no unit-level test that the unit or db configs keep the fake key. The workflow lane's test covers its own config only.
- `.workflow-data/`, `.workflow-vitest/` and `src/app/.well-known/workflow/` were created locally by the runs. All three are gitignored, and `git status` is clean.

## Threat Flags

None. The only new surface is the generated `/.well-known/workflow/v1/*` handlers. They are covered by T-4-14 in the plan's threat model, and the proxy exclusion mitigates it.

## Self-Check: PASSED

- vitest.workflow.config.ts, tests/workflow/lane.test.ts, next.config.ts (withWorkflow): FOUND
- commits eb936f3, c0b5c17, c857cd2: FOUND in `git log`
