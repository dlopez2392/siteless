---
phase: 01-foundations-tenancy
plan: 01
subsystem: infra
tags: [nextjs, typescript, pnpm, eslint, prettier, zod, server-only, tooling]

# Dependency graph
requires: []
provides:
  - "package.json with every Phase 1 script name later plans call (typecheck, lint, verify, test:unit, test:db, test:e2e, db:generate, db:custom, db:migrate, db:migrate:prod, db:check)"
  - "Exact-pinned dependency set + committed pnpm-lock.yaml that installs clean with --frozen-lockfile"
  - "typescript held at 6.0.3 so typescript-eslint@8.70.0's peer range holds"
  - "tsconfig.json with strict mode, noUncheckedIndexedAccess and the @/* -> ./src path alias"
  - "eslint.config.mjs flat config over typescript-eslint (no eslint-config-next)"
  - "src/env.ts — server-only, zod-parsed env that throws at boot naming only the missing keys"
  - "Unstyled App Router shell (src/app/layout.tsx, src/app/page.tsx) that builds"
  - "pnpm-workspace.yaml allow-listing esbuild's build script so install exits 0"
affects: [01-03-test-harness, 01-04-drizzle-bootstrap, 01-08-clerk-shell, 01-10-vercel, 01-11-deploy, phase-02-ui]

# Tech tracking
tech-stack:
  added:
    - next@16.3.5
    - react@19.3.0
    - react-dom@19.3.0
    - "@clerk/nextjs@7.9.4"
    - drizzle-orm@0.45.2
    - postgres@3.4.9
    - zod@4.6.5
    - date-fns@4.4.0
    - "@date-fns/tz@1.5.0"
    - server-only@0.0.1
    - typescript@6.0.3
    - "@types/node@26.6.2"
    - "@types/react@19.3.0"
    - "@types/react-dom@19.3.0"
    - drizzle-kit@0.31.10
    - pg@8.23.0
    - "@types/pg@8.23.1"
    - dotenv@18.0.1
    - tsx@4.23.15
    - vitest@5.0.1
    - vite@8.3.0
    - "@playwright/test@1.63.0"
    - "@clerk/testing@2.2.36"
    - eslint@10.11.0
    - typescript-eslint@8.70.0
    - prettier@3.9.8
  patterns:
    - "Exact version pins only — no ^ or ~ anywhere in package.json; a node assertion in the plan gate enforces it"
    - "pnpm version pinned by packageManager field, never installed globally"
    - "Server-only env parsed once at module load and thrown on, never defaulted"
    - "Dependency build scripts allow-listed by name in pnpm-workspace.yaml, never globally re-enabled"

key-files:
  created:
    - package.json
    - pnpm-lock.yaml
    - pnpm-workspace.yaml
    - .nvmrc
    - tsconfig.json
    - next.config.ts
    - eslint.config.mjs
    - .prettierrc.json
    - .prettierignore
    - next-env.d.ts
    - src/app/layout.tsx
    - src/app/page.tsx
    - src/env.ts
  modified:
    - .gitignore

key-decisions:
  - "pnpm 12.5.1 is reached through its Node fallback launcher, not the global shim — the self-switch's generated Windows .CMD is broken on this machine"
  - "esbuild's build script is allow-listed in pnpm-workspace.yaml (allowBuilds), because pnpm 12 blocks dependency scripts by default and ERR_PNPM_IGNORED_BUILDS exits 1"
  - "Next 16's mandatory tsconfig rewrite (jsx: preserve -> react-jsx) is accepted rather than fought, since it recurs on every build"
  - "next-env.d.ts is committed per Next convention; its imports from the gitignored .next/types are absorbed by skipLibCheck, verified by typechecking with .next moved aside"
  - "No Tailwind, no CSS, no design dependencies — the design system is born in Phase 2's UI pass"

patterns-established:
  - "Pinned toolchain: every dependency exact, typescript frozen below 6.1.0 to keep type-aware linting alive"
  - "Fail-loudly env: zod safeParse at module load, error names keys via Object.keys(fieldErrors) and never parsed.error.message"
  - "server-only import as the client-boundary enforcement mechanism, not convention"

requirements-completed: [FOUND-01]

# Metrics
duration: 12 min
completed: 2026-09-22
---

# Phase 01 Plan 01: Repo Scaffold, Pinned Toolchain, Fail-Loudly Env Guard Summary

**An installable, typecheckable, lintable, buildable Next 16 repo with zero application logic: 26 exact-pinned dependencies, TypeScript frozen at 6.0.3 so typescript-eslint keeps working, and a `server-only` zod env guard that throws at boot naming only the missing keys.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-22T01:39:48Z
- **Completed:** 2026-09-22T01:51:59Z
- **Tasks:** 3
- **Files modified:** 14 (13 created, 1 modified)

## Accomplishments

- `pnpm <anything>` is now a real command — every script name plans 03, 04, 05, 07, 09, 10 and 11 call is declared and spelled exactly as the `<interfaces>` contract fixes it.
- The dependency set is deterministic: no `^` or `~` anywhere, `pnpm-lock.yaml` committed, and a genuinely clean `node_modules` reinstall from that lockfile exits 0 in 23s.
- `typescript` resolves to a single `6.0.3`. npm `latest` is `7.0.2` today, which would have produced `ERESOLVE` against `typescript-eslint@8.70.0`'s peer `>=4.8.4 <6.1.0` and silently killed type-aware linting.
- `pnpm typecheck`, `pnpm lint` and `pnpm build` are all green against an unstyled two-file App Router shell, with `/` in the route listing.
- `src/env.ts` exists, is server-only by construction, and is imported by nothing — so the build stays green while `SUPABASE_DB_POOL_URL` is still unset until plan 02's checkpoint.

## Task Commits

Each task was committed atomically:

1. **Task 1: package.json with pinned dependencies and install** — `b83b6c8` (feat)
2. **Task 2: TypeScript, ESLint, Prettier, Next config and the placeholder shell** — `93dc424` (feat)
3. **Task 3: Fail-loudly env guard (src/env.ts)** — `ca77449` (feat)

## Files Created/Modified

- `package.json` — name/private/type=module, `packageManager: pnpm@12.5.1`, `engines.node >=24.0.0`, all 15 contract scripts, 10 exact-pinned dependencies and 16 exact-pinned devDependencies
- `pnpm-lock.yaml` — the deterministic resolution; proven by a clean `--frozen-lockfile` install
- `pnpm-workspace.yaml` — **not in the plan**; `allowBuilds: esbuild: true`, without which `pnpm install` exits 1
- `.nvmrc` — `24`
- `.gitignore` — appended build/test output paths; the existing `.env` / `.env.*` ignore with the `!.env.example` exception is untouched
- `tsconfig.json` — strict, `noUncheckedIndexedAccess`, `@/*` → `./src`; `jsx` is `react-jsx` after Next's mandatory rewrite
- `next.config.ts` — `reactStrictMode: true`, nothing else
- `eslint.config.mjs` — flat config over typescript-eslint; `no-explicit-any: error`, `no-unused-vars` with `^_` escape
- `.prettierrc.json` / `.prettierignore` — 100 cols, single quotes, trailing commas
- `next-env.d.ts` — generated by `next build`, committed per Next convention
- `src/app/layout.tsx` / `src/app/page.tsx` — plain HTML placeholder shell; plan 08 replaces both with the Clerk shell
- `src/env.ts` — `import 'server-only'` on line 1, zod schema over `CLERK_SECRET_KEY` and `SUPABASE_DB_POOL_URL`

## Decisions Made

- **Reached pnpm 12.5.1 through its Node fallback launcher.** The `packageManager` pin worked — pnpm 11.9.0 downloaded 12.5.1 — but the `.CMD` shim it generated tries to `exec` a shebang-less POSIX `sh` script, which Windows cannot run. Every pnpm invocation in this plan ran through `node <store>/node_modules/pnpm/bin/pnpm.mjs`, which reports `12.5.1` and printed `using pnpm v12.5.1` on each install. The plan's instruction not to `pnpm add -g pnpm` was honoured, and no global state was mutated.
- **Allow-listed esbuild by name rather than re-enabling dependency scripts globally.** `esbuild`'s postinstall links its platform binary and `tsx`, `vite`, `vitest` and `drizzle-kit` all run through it.
- **Accepted Next's tsconfig rewrite.** `next build` reports `jsx` → `react-jsx` as a *mandatory* change (Next 16 uses the React automatic runtime) and adds `.next/dev/types/**/*.ts` to `include`. Reverting to `preserve` would be undone by the next build, producing a permanently dirty file.
- **Committed `next-env.d.ts`.** It imports `./.next/types/routes.d.ts`, which is gitignored, so this looked like it would break `tsc --noEmit` on a clean CI checkout. Verified rather than assumed: with `.next` moved aside, `pnpm typecheck` still exits 0, because `skipLibCheck: true` suppresses resolution errors inside declaration files. Relevant to plan 03, whose CI runs `typecheck` before any build.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] pnpm's self-switch shim is broken on this machine**
- **Found during:** Task 1
- **Issue:** `pnpm --version` after adding `"packageManager": "pnpm@12.5.1"` failed with `'"...\node_modules\pnpm\pnpm"' is not recognized as an internal or external command`. pnpm 12 ships its CLI as a native binary installed by a postinstall script; the self-switch downloaded the package with build scripts skipped, leaving a shebang-less `sh` script that the generated Windows `.CMD` cannot execute.
- **Fix:** Invoked the package's own documented Node fallback, `node <store>/.../node_modules/pnpm/bin/pnpm.mjs`, for every pnpm command. No global install, no mutation of the shared pnpm store.
- **Files modified:** none (tooling only)
- **Verification:** the launcher reports `12.5.1`; each install printed `Done in … using pnpm v12.5.1`
- **Committed in:** n/a (no file change)
- **Carry-forward:** plans 03/10/11 and CI must not assume a bare `pnpm` resolves to 12.5.1 on this Windows machine. CI on Linux via `pnpm/action-setup` is unaffected.

**2. [Rule 3 - Blocking] `pnpm install --frozen-lockfile` exited 1 with ERR_PNPM_IGNORED_BUILDS**
- **Found during:** Task 1
- **Issue:** pnpm 12 blocks dependency build scripts by default. `esbuild@0.18.20`, `@0.25.12` and `@0.28.2` were ignored, and pnpm makes that an **error**, not a warning — so the plan's own Task 1 gate (`pnpm install --frozen-lockfile` exits 0) could not pass, and CI would have failed identically.
- **Fix:** Added `pnpm-workspace.yaml` with `allowBuilds: esbuild: true`. Two dead ends were removed on the way: `pnpm.onlyBuiltDependencies` in `package.json` (pnpm 12 warns "the pnpm field is no longer read"), and a top-level `onlyBuiltDependencies` key in `pnpm-workspace.yaml` (pnpm 12 renamed the setting to `allowBuilds` and rewrote the file to say so).
- **Files modified:** `pnpm-workspace.yaml` (new file, not in the plan's `files_modified`)
- **Verification:** `pnpm install --frozen-lockfile` exits 0 and runs the three esbuild postinstalls; re-proven against a deleted `node_modules` (23s, exit 0)
- **Committed in:** `b83b6c8`

**3. [Rule 3 - Blocking] Next 16 rewrote `tsconfig.json` during `pnpm build`**
- **Found during:** Task 2
- **Issue:** The plan specifies `"jsx": "preserve"`. Next 16.3.5 reports that as a **mandatory** change and sets `jsx: "react-jsx"` (automatic runtime), also adding `.next/dev/types/**/*.ts` to `include` and reformatting the file.
- **Fix:** Accepted Next's output. The plan's own acceptance criteria for this file (`"@/*"` and `"strict": true`) both survive the rewrite, and reverting would be undone on every subsequent build.
- **Files modified:** `tsconfig.json`
- **Verification:** `pnpm typecheck`, `pnpm lint` and `pnpm build` re-run green *after* the rewrite
- **Committed in:** `93dc424`

**4. [Rule 1 - Bug] The plan's Task 3 comment text contradicts its own acceptance criterion**
- **Found during:** Task 3
- **Issue:** The criterion requires `grep -c 'NEXT_PUBLIC_' src/env.ts` to return `1`, but the comment block the plan supplies verbatim puts `NEXT_PUBLIC_*` on one line and `process.env.NEXT_PUBLIC_*` on the next — `grep -c` counts lines, so the supplied text returns `2`.
- **Fix:** Reworded the comment so `NEXT_PUBLIC_` appears on exactly one line, preserving the stated intent ("the explanatory comment only — no `NEXT_PUBLIC_*` key is parsed") and the security reasoning. No schema key changed.
- **Files modified:** `src/env.ts`
- **Verification:** `grep -c 'NEXT_PUBLIC_' src/env.ts` → `1`; `grep -c 'CLERK_SECRET_KEY' src/env.ts` → `1`
- **Committed in:** `ca77449`

**5. [Rule 2 - Missing Critical] `next-env.d.ts` was left untracked by the plan**
- **Found during:** Task 2
- **Issue:** `next build` generates `next-env.d.ts`, which `tsconfig.json` `include`s. The plan's `files` list omits it, so it would have been left as an untracked generated file — which the commit protocol forbids.
- **Fix:** Committed it, per Next's own convention. Before doing so, verified the non-obvious risk: it imports the gitignored `./.next/types/routes.d.ts`, but `skipLibCheck: true` absorbs that, proven by running `pnpm typecheck` with `.next` moved aside (exit 0).
- **Files modified:** `next-env.d.ts`
- **Verification:** `pnpm typecheck` exits 0 with `.next` absent
- **Committed in:** `93dc424`

---

**Total deviations:** 5 auto-fixed (3 blocking, 1 bug, 1 missing critical)
**Impact on plan:** No scope creep. Three were environment/tooling blockers standing between the plan as written and its own verification gates; one corrected an internal contradiction in the plan text; one closed a generated-file gap. Every `<interfaces>` name, version and script the plan fixed as a contract is unchanged.

### Non-blocking observation

The plan's Task 1 acceptance criterion says "all **14** script names" and then enumerates **15** (`dev build start typecheck lint format test:unit test:db test:e2e verify db:generate db:custom db:migrate db:migrate:prod db:check`). The enumerated list is the contract other plans call, so all 15 are implemented. The count is a miscount in the plan text, not a missing script.

## Issues Encountered

None beyond the five deviations above. No fix exceeded one attempt except the esbuild allow-list, which took three because pnpm 12 has moved the setting twice (package.json `pnpm` field → `onlyBuiltDependencies` → `allowBuilds`); pnpm itself rewrote `pnpm-workspace.yaml` to name the current key, which is what resolved it.

## Known Stubs

| Stub | File | Reason / resolved by |
|------|------|----------------------|
| Placeholder shell renders two static strings, reads no data | `src/app/layout.tsx`, `src/app/page.tsx` | Intentional and required by the plan and ROADMAP ("Ships an unstyled app shell only"). **Plan 08** replaces both with the Clerk shell (`ClerkProvider` + `ActivateSoleOrganization`); the design system arrives in Phase 2's UI pass. |
| `src/env.ts` is imported by nothing | `src/env.ts` | Intentional and required by the plan — `SUPABASE_DB_POOL_URL` is not set until plan 02's checkpoint, and importing it now would break `pnpm build`. **Plan 08** wires it in from `src/db/client.ts`. |

No unintentional stubs: there are no hardcoded empty collections feeding UI, and no "coming soon" / TODO / FIXME placeholders.

## Verification Results

Plan-level `<verification>`, all re-run after a deleted `node_modules`:

| Check | Result |
|-------|--------|
| `pnpm install --frozen-lockfile` from a clean `node_modules` | exit 0 (23s, `using pnpm v12.5.1`) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0, route listing contains `/` |
| `pnpm why typescript` | `typescript@6.0.3` — `Found 1 version of typescript` |
| `git status --short` lists `.env.local` | no — working tree clean |

`pnpm verify` is correctly **not** runnable yet (no vitest config until plan 03), exactly as the plan states.

## Threat Model Coverage

| Threat ID | Disposition | Evidence |
|-----------|-------------|----------|
| T-1-10 (Information Disclosure — `.env.local`, `src/env.ts`) | mitigated | `.gitignore` keeps `.env` / `.env.*` ignored with the `!.env.example` exception intact; `git status --short` never listed `.env.local` (it is not even present in this worktree); `src/env.ts` line 1 is `import 'server-only';`; the boot error uses `Object.keys(fieldErrors)` and the file contains no `parsed.error.message`; `grep -rn 'sk_\|eyJ\|postgres://' src/` returns no matches |
| T-1-14 (Tampering — supply chain) | mitigated | Zero `^`/`~` in `package.json` (enforced by the plan's node assertion, exit 0); `pnpm-lock.yaml` committed and proven with `--frozen-lockfile`; `typescript` asserted at a single `6.0.3` |
| T-1-16 (Information Disclosure — `src/app/**`) | accepted | Shell renders two static strings and reads no data; nothing is wired to a database |

No new security-relevant surface was introduced beyond the plan's threat model — no network endpoints, no auth paths, no schema changes.

## User Setup Required

None — this plan has no `user_setup` frontmatter and required no external service configuration. Credentials and dashboard settings are plan 01-02's scope.

## Next Phase Readiness

Ready for **01-03** (test harness: vitest configs, DB fixtures, Playwright, CI) and **01-04** (drizzle-kit bootstrap migration), both wave 1.

Carry-forward notes for those plans:

- `vitest.db.config.ts` and `tests/unit` / `tests/db` do not exist yet; `pnpm verify` will fail until 01-03 creates them. This is expected.
- `scripts/db.ts` and `scripts/check-test-db.ts` do not exist yet; the five `db:*` scripts are declared but not yet runnable. Plan 01-04 owns them.
- **Windows caveat:** a bare `pnpm` on this machine does not reach 12.5.1 (deviation 1). Use the Node fallback launcher locally. CI on Linux via `pnpm/action-setup` is unaffected.
- When 01-03 writes CI, `pnpm install --frozen-lockfile` will pick up `allowBuilds` from `pnpm-workspace.yaml` automatically — no `--no-optional` or `approve-builds` step is needed.
- `src/proxy.ts` is deliberately absent (plan 08's file); `src/app/proxy.ts` must never exist.

## Self-Check: PASSED

- All 13 created files verified present on disk with `[ -f ]`; `.gitignore` verified modified and tracked.
- `pnpm-workspace.yaml`, `next-env.d.ts`, `src/env.ts`, `package.json`, `pnpm-lock.yaml` and `.nvmrc` confirmed tracked via `git ls-files`.
- All three task commits verified in `git log`: `b83b6c8`, `93dc424`, `ca77449`.
- Working tree clean; no deletions in any of the three commits (`git diff --diff-filter=D HEAD~1 HEAD` empty each time).

---
*Phase: 01-foundations-tenancy*
*Completed: 2026-09-22*
