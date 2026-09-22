---
phase: 02-budget-governor-search-presets
plan: 01
subsystem: ui
tags:
  [
    shadcn,
    tailwind-v4,
    radix,
    next-themes,
    sonner,
    inter,
    vitest,
    jsdom,
    testing-library,
    eslint-react-hooks,
  ]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "Next 16 app shell, src/app/layout.tsx with the ClerkProvider + ActivateSoleOrganization boundary pattern, vitest.config.ts with the main-process TZ=UTC pin, eslint flat config"
provides:
  - "Tailwind v4 compiling on Next 16 / Turbopack (postcss.config.mjs, no tailwind.config.* ever)"
  - "shadcn initialised on the radix-nova preset with baseColor zinc, 35 primitives under src/components/ui"
  - "Both UI-SPEC palettes painted as literal hex on :root and .dark, verified present in the BUILT css bundle"
  - "Inter bound to --font-sans-inter and fronting the painted --font-sans stack; no geist package"
  - "next-themes ThemeProvider (attribute=class, defaultTheme=system) and sonner Toaster mounted inside ClerkProvider"
  - "A jsdom component-test lane for *.test.tsx that does not weaken the node lane's UTC pin"
  - "React hook lint rules (rules-of-hooks, exhaustive-deps), both error — first in this repo"
affects:
  [
    02-02,
    02-05,
    02-06,
    02-07,
    02-08,
    02-09,
    02-10,
    02-11,
    02-12,
    02-13,
    02-14,
    phase-05,
    phase-07,
    phase-09,
  ]

# Tech tracking
tech-stack:
  added:
    [
      tailwindcss@4.3.3,
      "@tailwindcss/postcss@4.3.3",
      lucide-react@1.47.0,
      class-variance-authority@0.7.1,
      tailwind-merge@3.7.0,
      next-themes@0.4.6,
      sonner@2.0.8,
      vaul@1.1.2,
      motion@13.4.0,
      cn@0.3.2,
      radix-ui@1.6.7,
      tw-animate-css@1.4.0,
      shadcn@4.21.0,
      cmdk@1.1.1,
      "@testing-library/react@16.3.3",
      "@testing-library/jest-dom@7.0.1",
      jsdom@30.1.1,
      "@vitejs/plugin-react@6.1.1",
      msw@2.15.0,
      eslint-plugin-react-hooks@7.1.1,
    ]
  patterns:
    - "Painted hex on :root/.dark + @theme inline mapping; `inline` is load-bearing, not cosmetic"
    - "Three declared radii mapped onto the rounded-* namespaces the copy-ins actually use"
    - "Two vitest lanes as inline test.projects in ONE config file, so one TZ pin covers both"
    - "Every provider crosses the server/client boundary as a component, never as data"

key-files:
  created:
    - src/app/globals.css
    - postcss.config.mjs
    - components.json
    - src/components/theme-provider.tsx
    - src/lib/utils.ts
    - src/components/ui/ (35 primitives)
    - src/hooks/use-mobile.ts
    - tests/unit/_setup-dom.ts
    - tests/unit/jsdom-lane.test.tsx
  modified:
    - src/app/layout.tsx
    - vitest.config.ts
    - eslint.config.mjs
    - pnpm-workspace.yaml
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "Tailwind v4 had to be installed BEFORE shadcn init — init's preflight aborts without it, so it never creates postcss.config.mjs or globals.css (RESEARCH assumption A8 was wrong on this point)"
  - "shadcn's dependency install shells out to bare `pnpm`, which is the broken 11.9.0 shim on this machine; a pnpm.cmd shim under node_modules/.pnpm-shim was prepended to PATH for the CLI invocations only"
  - "Used vitest 5 inline test.projects rather than a second vitest.dom.config.ts, so the main-process TZ='UTC' pin is declared once and cannot drift between lanes"
  - "Radius namespaces mapped to the UI-SPEC's three values (rounded-lg 8px, rounded-xl 12px, rounded-4xl pill) rather than the plan's illustrative --radius-lg: var(--radius), which would have made buttons 12px against the spec's 8px"
  - "react-hooks/exhaustive-deps set to error rather than warn — a missing dep on the debounced estimate is exactly Pitfall 5"
  - "msw's build script denied explicitly in pnpm-workspace.yaml; its postinstall is a no-op without msw.workerDirectory and the placeholder pnpm wrote would have failed CI"

patterns-established:
  - "Painted values, never CSS custom properties, for anything a test pins — and the claim is checked against the BUILT bundle, not the source"
  - "A lint rule or test lane is not trusted until a deliberate violation has been watched fail by name"

requirements-completed: [SRCH-01, SRCH-04, BUDG-04]

# Metrics
duration: 24min
completed: 2026-09-22
---

# Phase 02 Plan 01: Design System Foundation Summary

**Tailwind v4 + shadcn radix-nova with 35 primitives, both UI-SPEC palettes painted as literal hex and verified in the built CSS bundle, Inter replacing the preset's Geist, next-themes and sonner mounted inside ClerkProvider, and a jsdom component-test lane that leaves the node lane's UTC pin intact.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-09-22T13:44:58Z
- **Completed:** 2026-09-22T14:09:02Z
- **Tasks:** 3 of 3
- **Files modified:** 48 created/modified across three commits

## Accomplishments

- The repo has a design system for the first time. Phase 1's unstyled shell now compiles Tailwind v4 on Turbopack, with 35 shadcn primitives copied in from the official registry only.
- Both palettes ship. Every one of the 25 hex literals from UI-SPEC § Color is physically present in `src/app/globals.css`, and the accent, the dark palette and all three radii were confirmed **in the production CSS bundle**, not merely in the source.
- The font contract holds: Inter on `--font-sans-inter`, fronting the painted fallback stack. No `geist` package exists and no `tailwind.config.*` file exists.
- A `.test.tsx` now runs under jsdom with React and jest-dom matchers, while `suite-zone.test.ts` and `time.test.ts` still run under `environment: 'node'` with `TZ=UTC` — proved by the lane labels in the verbose output, not assumed.
- React hook lint rules exist for the first time in this repo, and were proved to actually fire.

## Task Commits

1. **Task 1: shadcn init on the Radix/nova preset, pin every floated version, add the 33 components** — `3beccb1` (feat)
2. **Task 2: Paint the UI-SPEC palette into globals.css, swap Geist for Inter, mount ThemeProvider and Toaster** — `f4ffebc` (feat)
3. **Task 3: Open the jsdom component-test lane without weakening the node lane's UTC pin** — `ba6c066` (test)

## Verbatim `shadcn init` stdout

Command (exactly as the plan and UI-SPEC specify, no `-t next`, no `--base-color` flag):

```
npx shadcn@4.21.0 init -b radix -p nova -y --css-variables --pointer --no-monorepo --no-rtl
```

Output of the run that succeeded:

```
- Preflight checks.
✔ Preflight checks.
- Verifying framework.
✔ Verifying framework. Found Next.js.
- Validating Tailwind CSS. Found v4.
✔ Validating Tailwind CSS. Found v4.
- Validating import alias.
✔ Validating import alias.
- Writing components.json.
✔ Writing components.json.
- Checking registry.
✔ Checking registry.
- Installing dependencies.
- Installing dependencies.
✔ Installing dependencies.
- Updating fonts.
✔ Updating fonts.
- Updating files.
✔ Created 1 file:
  - src\lib\utils.ts
- Updating src\app\globals.css
✔ Updating src\app\globals.css

Project initialization completed.
You may now add components.
```

Two earlier invocations failed first; both are documented under **Deviations** below, with their verbatim errors.

## The file list `init` actually wrote, versus RESEARCH assumption A8

A8 predicted: _"`shadcn init` writes `postcss.config.mjs`, `src/app/globals.css`, `src/lib/utils.ts`, `components.json` and rewrites `layout.tsx`'s font import."_

What actually happened. Recorded as observed; **not corrected to match the prediction** (UI-SPEC Step 4, Pitfall 10):

| A8 predicted            | Reality                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postcss.config.mjs`    | ❌ **init does not write it.** init's preflight *requires* Tailwind to already be configured and aborts otherwise. Hand-written before init could run.                  |
| `src/app/globals.css`   | ⚠️ **Partly.** init does not create it — it has to already exist for preflight to pass. init then *rewrites* the existing file (`Updating src\app\globals.css`).        |
| `src/lib/utils.ts`      | ✅ Created. Content is not the expected clsx + tailwind-merge composition but `export { cn } from "cn"` — shadcn 4.21 delegates to the `cn` npm package.                 |
| `components.json`       | ✅ Created.                                                                                                                                                            |
| `layout.tsx` font import | ✅ Rewritten exactly as predicted: added `import { Geist } from "next/font/google"`, `const geist = Geist({subsets:['latin'],variable:'--font-sans'})`, and `cn(...)` on `<html>`. |
| _(not predicted)_       | init did **not** add `import './globals.css'` to the root layout. The stylesheet was unreferenced until Task 2 added the import.                                       |

`git status --short` was **empty** before init, at `131bf02`. After init:

```
 M package.json
 M pnpm-lock.yaml
 M src/app/layout.tsx
?? components.json
?? postcss.config.mjs        (hand-written pre-init)
?? src/app/globals.css       (hand-written pre-init, then rewritten by init)
?? src/lib/utils.ts
```

## Verbatim `npx shadcn@4.21.0 info`

**The real values: `style` = `radix-nova`, `baseColor` = `zinc`, `iconLibrary` = `lucide`.** All three match the contract, so nothing needed recording-without-fixing.

```
Project
  framework         Next.js (next-app)
  frameworkVersion  16.3.5
  srcDirectory      Yes
  rsc               Yes
  typescript        Yes
  tailwindVersion   v4
  tailwindConfig    -
  tailwindCss       src/app/globals.css
  importAlias       @

Configuration
  style        radix-nova
  base         radix
  rsc          Yes
  typescript   Yes
  iconLibrary  lucide
  rtl          No
  menuColor    default
  menuAccent   subtle

Preset
  code         bcivVNCa
  version      b
  style        nova
  baseColor    zinc
  theme        zinc
  chartColor   zinc
  iconLibrary  lucide
  font         geist
  fontHeading  inherit
  radius       default
  menuAccent   subtle
  menuColor    default
  url          https://ui.shadcn.com/create?preset=bcivVNCa

Aliases
  components  @/components
  utils       @/lib/utils
  ui          @/components/ui
  lib         @/lib
  hooks       @/hooks

registries:
  @shadcn  https://ui.shadcn.com/r/styles/{style}/{name}.json

Installed Components
  alert, avatar, badge, breadcrumb, button, card, checkbox, collapsible, command, dialog, drawer, dropdown-menu, empty, field, input-group, input, item, label, popover, progress, radio-group, scroll-area, select, separator, sheet, sidebar, skeleton, sonner, spinner, table, tabs, textarea, toggle-group, toggle, tooltip
```

Note the `Preset` block still reports `font geist` — that is the preset *descriptor* from the registry, not the state of `layout.tsx`. The actual import was swapped to Inter in Task 2 and `grep -c 'Geist' src/app/layout.tsx` returns 0.

**35 primitives, not 33.** The 33 requested plus `toggle.tsx` and `textarea.tsx`, which the registry pulls in as dependencies of `toggle-group` and `field`. `src/hooks/use-mobile.ts` also arrived with `sidebar`.

## Which jsdom lane mechanism was used, and why

**The PREFERRED mechanism: vitest 5 inline `test.projects` inside `vitest.config.ts`.** The fallback `vitest.dom.config.ts` was not needed — vitest 5.0.1 accepted `projects` without complaint.

This is the better of the two on this specific repo, for a reason beyond taste: the `process.env.TZ = 'UTC'` assignment is a **main-process** statement, and inline projects share that one main process. A separate `vitest.dom.config.ts` would have required a second, duplicated copy of the pin, which is exactly the kind of thing that drifts. One pin, two lanes.

The three invariants the plan required all hold:

- `process.env.TZ = 'UTC'` sits textually above the first `import` in every `vitest*.config.ts`. The plan's scanner one-liner prints `ok`.
- `tests/unit/**/*.test.ts` still runs under `environment: 'node'` — visible as the `|node|` lane label on every one of those tests.
- `pnpm test:unit` runs BOTH lanes in one invocation, so a `-t` filter matching only a `.tsx` test still executes.

## The real `pnpm test:unit` pass list

`pnpm test:unit --reporter=verbose`, read by **name** rather than by exit code:

```
 ✓ |node| tests/unit/sole-organization.test.ts > sole organization > sole organization: activates when there is exactly one membership 5ms
 ✓ |node| tests/unit/sole-organization.test.ts > sole organization > sole organization: returns null when not signed in 1ms
 ✓ |node| tests/unit/sole-organization.test.ts > sole organization > sole organization: returns null when an organization is already active 1ms
 ✓ |node| tests/unit/sole-organization.test.ts > sole organization > sole organization: returns null with zero memberships 0ms
 ✓ |node| tests/unit/sole-organization.test.ts > sole organization > sole organization: returns null with two memberships 1ms
 ✓ |node| tests/unit/suite-zone.test.ts > timezone pinning > the suite runs in a zone that can discriminate 67ms
 ✓ |node| tests/unit/no-internal-leak.test.ts > internal annotations never leave the building > no registered payload builder emits an internal annotation 7ms
 ✓ |node| tests/unit/no-internal-leak.test.ts > internal annotations never leave the building > every module under src/lib/export is represented in the registry 4ms
 ✓ |node| tests/unit/time.test.ts > timezone discipline > one instant renders on opposite days in UTC and America/Chicago 69ms
 ✓ |node| tests/unit/time.test.ts > timezone discipline > pins the zone and the locale on every Intl call 7ms
 ✓ |node| tests/unit/time.test.ts > timezone discipline > formatLocal ignores a caller-supplied timeZone 2ms
 ✓ |node| tests/unit/env-alias.test.ts > src/env.ts runtime pool URL > uses SUPABASE_DB_POOL_URL when it is set 297ms
 ✓ |node| tests/unit/env-alias.test.ts > src/env.ts runtime pool URL > RUNTIME_DB_URL is accepted when the vendor-named variable is absent 4ms
 ✓ |node| tests/unit/env-alias.test.ts > src/env.ts runtime pool URL > an EMPTY vendor-named variable falls through to RUNTIME_DB_URL 3ms
 ✓ |node| tests/unit/env-alias.test.ts > src/env.ts runtime pool URL > the vendor-named variable wins when both are set 3ms
 ✓ |node| tests/unit/env-alias.test.ts > src/env.ts runtime pool URL > neither set is still a boot-time throw naming the variable 6ms
 ✓ |dom| tests/unit/jsdom-lane.test.tsx > jsdom lane > jsdom lane renders a shadcn primitive 219ms

 Test Files  6 passed (6)
      Tests  17 passed (17)
```

All three names the plan demanded are present: `jsdom lane renders a shadcn primitive` (in the `|dom|` lane), `the suite runs in a zone that can discriminate`, and the opposite-days test `one instant renders on opposite days in UTC and America/Chicago` (both `|node|`).

## Mutation checks (a green suite proves nothing a mutation hasn't)

Two things in this plan could have been inert while still reporting success. Both were deliberately broken and watched fail **by name**, then reverted.

| Mutation                                                                      | Result                                                                                                                             | Reverted |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `<Button>Create preset</Button>` → `Create preseX` in `jsdom-lane.test.tsx`    | `× \|dom\| … > jsdom lane renders a shadcn primitive` — `Unable to find an accessible element with the role "button" and name "Create preset"`. `1 failed \| 16 passed` | ✅        |
| Temporary `src/lib/__hook-rule-probe.tsx` with a conditional hook and a missing dep | 2 errors: `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps`, lint exit 1                                                | ✅ (file deleted) |

The second one matters because of the recorded lesson that an agent whose plugin doesn't resolve still reports success: a `react-hooks` config that silently failed to load would have produced exactly the same clean `eslint .` output as a working one.

## Built-bundle probe (Executor Rule 2 / Rule 3)

Claiming the token pass shipped is not the same as it shipping. Probed `.next/static/chunks/1uey23bmgbwwr.css` (107,055 bytes) after `next build`:

- Present: `#0f766e` `#2dd4bf` `#f4f6f7` `#0e1416` `#eaeeef` `#b42318` `#fdb022`, `--radius:12px`, `--radius-control:8px`, `--radius-pill:999px`.
- `.dark{--background:#0e1416;--foreground:#e7edee;--card:#161e21;…}` — the dark palette is a real rule, not dead source.
- `.bg-background{background-color:var(--background)}` — resolves to the raw token, **not** through a `--color-*` indirection. This is why `@theme inline` was kept.
- Exactly one rule in the whole bundle consumes `var(--color-*)`, and it is `var(--color-black)` — theme-independent. No theme-dependent token is frozen at `:root`. Executor Rule 3 is satisfied in the shipped artifact, not just in intent.
- `.rounded-lg{border-radius:var(--radius-control)}` (8px, buttons/inputs/popovers/menus) and `.rounded-xl{border-radius:var(--radius)}` (12px, cards/dialogs/drawers).

## Decisions Made

- **`@theme inline` kept, deliberately.** Without `inline`, Tailwind interposes `--color-background: var(--background)` on `:root` and utilities read *that* — which resolves once at `:root` and freezes the light palette document-wide. Same class of defect as Executor Rule 3. The built-bundle probe above is the proof it behaves.
- **Radius namespaces mapped to the spec's three values, not to the plan's illustrative example.** The plan's action text showed `--radius-lg: var(--radius)` as an `e.g.`; taking it literally would have made every shadcn button and input 12px, against UI-SPEC § Design System's explicit "8px (buttons, inputs, chips)". Grepped the copy-ins to find which namespaces they actually use, then mapped `sm`/`md`/`lg` → 8px, `xl`/`2xl`/`3xl` → 12px, `4xl` → pill. Every surface now lands on one of the three declared radii instead of shadcn's 0.625rem default.
- **Full sidebar token set painted, not just `--sidebar` and `--sidebar-foreground`.** The generated `sidebar.tsx` consumes `sidebar-accent`, `sidebar-accent-foreground`, `sidebar-border` and `sidebar-ring` as well; leaving them undefined would have rendered the Phase-2 shell's chrome with no background and no border. Values derived from the UI-SPEC tables — `--sidebar-accent` is the muted fill, because UI-SPEC § App shell specifies the active nav row as muted background with the accent carried by the label, icon and 2px edge bar.
- **`--chart-1..5` dropped entirely.** UI-SPEC: "No chart library. `recharts` does not enter the bundle in this phase." Keeping five unused token declarations plus their `@theme` mappings would have been five tokens nobody had measured for contrast.
- **`react-hooks/exhaustive-deps` is `error`, not `warn`.** The plan allowed either. Plan 02-10's debounced estimate is the first hook-heavy code here, and a missing dependency there is precisely 02-RESEARCH Pitfall 5 (a stale estimate repainting over a fresh one). A warning in a repo whose lint gate only checks the exit code is invisible.
- **Inter's next/font variable is `--font-sans-inter`, not `--font-sans`.** UI-SPEC § Typography names `--font-sans`, but `--font-sans` is also the Tailwind namespace that carries the painted fallback stack; binding next/font to the same name makes the self-reference unresolvable — which is exactly the `--font-sans: var(--font-sans)` that `shadcn init` emitted. The plan already anticipated this and specified `--font-sans-inter`; followed as written.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `shadcn init` aborts unless Tailwind v4 is already installed and configured**

- **Found during:** Task 1
- **Issue:** The very first `init` invocation failed preflight. RESEARCH assumption A8 had it backwards — init does not bootstrap Tailwind, it requires it:
  ```
  ✖ Validating Tailwind CSS.
  No Tailwind CSS configuration found at C:\Users\danlo\prospector\.claude\worktrees\agent-a430bef81523dbaa5.
  It is likely you do not have Tailwind CSS installed or have an invalid configuration.
  ```
- **Fix:** Installed `tailwindcss@4.3.3` and `@tailwindcss/postcss@4.3.3` through the store launcher, then hand-wrote `postcss.config.mjs` (`{ plugins: { '@tailwindcss/postcss': {} } }`) and a one-line `src/app/globals.css` (`@import "tailwindcss";`) — exactly the shape Next 16.3.5's own CSS guide prescribes and which the plan's own steps 5 and 9 required anyway. Re-ran init, which then passed preflight and rewrote `globals.css` with the preset theme.
- **Files modified:** `postcss.config.mjs`, `src/app/globals.css`, `package.json`, `pnpm-lock.yaml`
- **Verification:** Second init run reached `Project initialization completed`; `pnpm build` compiles Tailwind.
- **Committed in:** `3beccb1`

**2. [Rule 3 - Blocking] shadcn's dependency install shells out to bare `pnpm`, which is the broken global shim on this machine**

- **Found during:** Task 1
- **Issue:** With Tailwind present, init got as far as writing `components.json` and then died:
  ```
  Command failed with exit code 1: pnpm add -- cn "shadcn@latest" class-variance-authority tw-animate-css radix-ui lucide-react
  '"C:\Users\danlo\AppData\Local\pnpm\store\v11\links\@\pnpm\12.5.1\…\bin\..\node_modules\pnpm\pnpm"' is not recognized as an internal or external command
  ```
  This is the known machine defect (bare `pnpm` → global 11.9.0 → broken `packageManager` self-switch shim). It cannot be worked around by running the constituents manually, because `shadcn add` shells out the same way for every component.
- **Fix:** Wrote a two-line `pnpm.cmd` at `node_modules/.pnpm-shim/pnpm.cmd` forwarding to the pinned 12.5.1 launcher, and prepended that directory to `PATH` for the `npx shadcn` invocations only. `node_modules/` is gitignored, so nothing about this lands in the repo and nothing about the machine's global state was touched.
- **Files modified:** none tracked
- **Verification:** init and `add` both completed; `pnpm-lock.yaml` shows the deps resolved by pnpm 12.5.1.
- **Committed in:** n/a (untracked tooling)

**3. [Rule 3 - Blocking] `init -f` on an existing `components.json` turns interactive**

- **Found during:** Task 1
- **Issue:** After failure 2, `components.json` already existed, so a plain re-run would abort (Pitfall 10). Passing `-f` to force it prompts `Would you like to re-install existing UI components? (y/N)` and hangs — unusable non-interactively.
- **Fix:** Deleted the orphaned `components.json` and re-ran init **without** `-f`, which is the CLI's own documented recovery and keeps the command byte-identical to the one UI-SPEC specifies.
- **Files modified:** `components.json` (removed, then recreated by init)
- **Verification:** `npx shadcn@4.21.0 info` reports `style radix-nova`, `baseColor zinc`.
- **Committed in:** `3beccb1`

**4. [Rule 2 - Missing Critical] Four more floated versions than the plan's nine, all pinned**

- **Found during:** Task 1
- **Issue:** The plan pinned nine packages and greps six of them for caret ranges. `init` and `add` also installed `cn@^0.3.2`, `radix-ui@^1.6.7`, `tw-animate-css@^1.4.0`, `shadcn@^4.21.0` and `cmdk@^1.1.1` at floating versions. This repo pins exactly everywhere else, and UI-SPEC Executor Rule 12 is "pin the toolchain after `shadcn init`" without a carve-out. A floating `radix-ui` is the entire behaviour layer of all 35 primitives.
- **Fix:** Pinned every one to its resolved exact version. `pnpm add --save-exact` no-ops when the lockfile is already satisfied, so the caret prefixes were stripped from `package.json` directly and the lockfile reconciled with `pnpm install`.
- **Files modified:** `package.json`, `pnpm-lock.yaml`
- **Verification:** `grep -cE '": "[\^~]' package.json` returns **0** across the whole file, not just the six the plan greps.
- **Committed in:** `3beccb1`

**5. [Rule 2 - Missing Critical] `pnpm-workspace.yaml` left with a placeholder that fails CI**

- **Found during:** Task 3
- **Issue:** Installing msw made pnpm write `msw: set this to true or false` into `allowBuilds` and exit 1 with `ERR_PNPM_IGNORED_BUILDS`. That literal placeholder is not a boolean, so it would have failed `pnpm install --frozen-lockfile` in CI — which the file's own comment says is the failure mode it exists to prevent.
- **Fix:** Read msw 2.15.0's postinstall first: it reads the parent `package.json` and returns immediately unless `msw.workerDirectory` is set, existing only to refresh the browser service-worker script. This phase uses msw in the Node lane only, so the build is denied explicitly with `msw: false` and a comment recording why denying it is lossless.
- **Files modified:** `pnpm-workspace.yaml`
- **Verification:** `pnpm install --frozen-lockfile` exits 0.
- **Committed in:** `ba6c066`

**6. [Rule 1 - Bug] My own comments tripped three of the plan's grep criteria**

- **Found during:** Task 2
- **Issue:** Three acceptance criteria are greps that must return 0: `-webkit-` in `globals.css`, the retired Tailwind v3 bare-dash arbitrary-value shorthand in `globals.css`/`layout.tsx`, and `Geist` in `layout.tsx`. All three returned 1 — every hit was prose in a comment I had written *warning against* that exact pattern.
- **Fix:** Reworded the three comments to describe the forbidden pattern without spelling it. The warnings are preserved; the greps now return 0. (Arguably the criteria are the ones being literal-minded, but a grep gate that a future executor cannot distinguish from a real violation is worse than a slightly wordier comment.)
- **Files modified:** `src/app/globals.css`, `src/app/layout.tsx`
- **Verification:** all three greps return 0; `#0F766E` still present; `pnpm build` re-run green.
- **Committed in:** `f4ffebc`

---

**Total deviations:** 6 auto-fixed (4 blocking, 2 missing-critical/bug)
**Impact on plan:** No scope creep. Deviations 1–3 were all one blocker — getting `shadcn init` to run at all on this machine — and the plan's own objective could not be reached without them. 4 and 5 close gaps that would have surfaced later as version drift and a red CI. 6 is cosmetic. Nothing in the plan's intent was changed.

## Issues Encountered

- **RESEARCH assumption A8 is wrong in its load-bearing direction** and should be corrected before any future phase leans on it. `shadcn init` is not a bootstrapper: it validates that Tailwind is already configured and refuses otherwise. It also does not wire the stylesheet into the root layout — `import './globals.css'` was added by hand in Task 2. Anyone planning a future `init` should treat "install and configure Tailwind, then init" as the fixed order.
- **`shadcn init` on 4.21.0 no longer composes `cn()` from clsx + tailwind-merge.** `src/lib/utils.ts` is literally `export { cn } from "cn"`, delegating to the `cn` npm package. `tailwind-merge@3.7.0` is therefore a direct dependency only because the plan and STACK.md pin it; nothing in `src/` imports it today.
- **`pnpm test:db` was deliberately not run.** This plan touches no migration and no schema, and sibling plan 02-03 is applying migrations to the shared `siteless_test` database concurrently. The plan's own `<verification>` block lists typecheck, lint, test:unit and build, all of which are green.

## Threat Flags

No new security surface. Checked T-2-15 explicitly: the only match for `google` in anything this plan touched is `import { Inter } from 'next/font/google'` and a comment about it. No `NEXT_PUBLIC_GOOGLE*` name was introduced and nothing in `globals.css`, `layout.tsx`, `theme-provider.tsx` or any primitive reads a credential.

⚠️ **One cross-plan note for 02-02:** its standing `no google credential` grep test over `src/` will now match `next/font/google` in `src/app/layout.tsx`. That is a font loader, not a credential — the test needs to be written against credential-shaped names (`NEXT_PUBLIC_GOOGLE`, `GOOGLE_*_KEY`, `PLACES_API_KEY`) rather than the bare substring `google`, or it will fail on a false positive the day it lands.

T-2-16 (supply chain): only the official registry `https://ui.shadcn.com/r` was used, no `--registry` flag. The `cn`, `radix-ui`, `tw-animate-css` and `shadcn` packages that looked surprising in init's install line were verified against the registry's own `https://ui.shadcn.com/r/styles/radix-nova/index.json`, which declares exactly that dependency set. Every floated version is now pinned.

T-2-17 (test harness): the `TZ='UTC'` main-process pin is above the first import in every `vitest*.config.ts`, verified by the plan's scanner, and the new lane shares the existing pin rather than introducing a second one.

## Known Stubs

None. Every file this plan created is fully wired: `globals.css` is imported by the root layout, `ThemeProvider` and `Toaster` are mounted, and the 35 primitives are real registry copy-ins. The primitives are not yet *used* by any screen — that is by design, they are the inventory plans 02-05 onward draw from.

## Verification Results

All four constituents run individually through the pinned store launcher (`pnpm verify` does not run on this machine — Pitfall 12):

| Gate         | Result                                                    |
| ------------ | --------------------------------------------------------- |
| `typecheck`  | ✅ exit 0                                                  |
| `lint`       | ✅ exit 0                                                  |
| `test:unit`  | ✅ exit 0 — 6 files, 17 tests, both lanes                  |
| `build`      | ✅ exit 0 — route listing still shows `ƒ Proxy (Middleware)` |
| `test:db`    | ⏭️ not run — see Issues Encountered                        |

Acceptance criteria, measured:

- `components.json`: `"config": ""` ×1, `zinc` ×1, `lucide` ×1
- `ls tailwind.config.*` → nothing
- `ls src/components/ui/*.tsx | wc -l` → **35** (≥33), all 20 named primitives present
- `postcss.config.mjs` contains `@tailwindcss/postcss`
- all 9 exact version strings present in `package.json`; `"geist"` ×0; floating ranges ×0 **across the entire file**
- all 25 UI-SPEC hex literals present in `globals.css`; `@import "tailwindcss"` ✓; `@theme inline` ✓; `--radius: 12px` ✓
- bare-dash arbitrary-value shorthand ×0; `-webkit-` ×0; `Geist` in `layout.tsx` ×0
- `layout.tsx` contains `Inter(`, `--font-sans-inter`, `suppressHydrationWarning`, `ThemeProvider`, `Toaster`, `globals.css`, `ActivateSoleOrganization`, `themeColor` with both `#F4F6F7` and `#0E1416`
- `theme-provider.tsx` contains `'use client'`, `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`
- TZ scanner one-liner prints `ok`
- `eslint.config.mjs` contains `react-hooks/rules-of-hooks` and `src/components/ui/**`

## User Setup Required

None — no external service configuration. (BUDG-03's Google Cloud key remains a human checkpoint owned by plan 02-14; nothing in this plan depends on it, per Executor Rule 14.)

## Next Phase Readiness

Ready. Every downstream plan in this phase can now import from `@/components/ui/*`, use the painted tokens, and write `.test.tsx` component tests.

Three things a downstream plan should know:

1. **Do not run `shadcn init` again**, and do not create a `tailwind.config.*`. If a future plan needs another primitive, `npx shadcn@4.21.0 add -y <name>` needs the `pnpm` shim described in deviation 2, and any version it floats must be pinned in the same task.
2. **The primitives are ignored by ESLint** (`src/components/ui/**`). That is deliberate — they are never hand-edited beyond the token pass — but it means a bug introduced by editing one will not be caught by lint.
3. **02-02's `no google credential` test needs a credential-shaped pattern**, not the substring `google`. See Threat Flags.

Screenshots of the real screens in both themes on the built app (Executor Rule 8) are plan 02-14's job; this plan built the tokens they will be taken against.

---

_Phase: 02-budget-governor-search-presets_
_Completed: 2026-09-22_
