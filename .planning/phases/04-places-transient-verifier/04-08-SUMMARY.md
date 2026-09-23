---
phase: 04-places-transient-verifier
plan: 08
subsystem: ui
tags: [places, attribution, google-maps, css-tokens, legal-guard, PLACE-06]
requires: []
provides:
  - "GoogleMapsTag (src/components/places/google-maps-tag.tsx), server-safe, the one attribution component (Rule 29)"
  - "--google-attribution token (#5E5E5E light / #FFFFFF dark) + --color-google-attribution + .google-maps-attribution class"
  - "tests/unit/no-map.test.ts, the Rule 31 no-map guard"
affects: [04-07, 04-28, every Places-signal surface plan that imports GoogleMapsTag]
tech-stack:
  added: []
  patterns:
    - "Legal-policy colour as a literal token on :root/.dark mapped through @theme inline, used by one class"
    - "CSS pinned by reading globals.css as text (jsdom paints nothing); computed style left to the e2e probe"
key-files:
  created:
    - src/components/places/google-maps-tag.tsx
    - tests/unit/google-maps-tag.test.tsx
    - tests/unit/no-map.test.ts
  modified:
    - src/app/globals.css
key-decisions:
  - "'Google Maps' stays an inline literal in GoogleMapsTag until 04-07 lands GOOGLE_MAPS_TAG in copy.ts (wave-1 ordering); 04-07 switches the import"
  - "no-map.test.ts uses a local walker; tests/unit/_walk.ts (04-02) is not in this wave-1 tree"
  - "no-map guard also scans optionalDependencies (beyond the plan's deps + devDeps)"
duration: ~15min
completed: 2026-09-23
---

# Phase 4 Plan 08: Google Maps attribution tag and no-map guard Summary

**`GoogleMapsTag` is one server-safe `<span translate="no">Google Maps</span>`, painted in Google's policy colours (#5E5E5E light, #FFFFFF dark) and Roboto, sans-serif at 14/400. A two-sided guard fails the suite if a map library or a map embed enters the app. Both are mutation-checked.**

## Performance

- **Duration:** about 15 min (first commit 19:12Z, done 19:27Z)
- **Tasks:** 2 of 2
- **Files:** 3 created, 1 modified

## Accomplishments

- `src/components/places/google-maps-tag.tsx`: no client directive. It renders a `span` with `translate="no"`, `className="google-maps-attribution"`, `data-testid="google-maps-attribution"` and the exact text `Google Maps`. It is plain text, never a badge (Rule 22).
- `src/app/globals.css`:
  - `--google-attribution: #5E5E5E;` in `:root` and `#FFFFFF` in `.dark`, both as literals.
  - `--color-google-attribution: var(--google-attribution);` in `@theme inline`.
  - One `.google-maps-attribution` rule: Roboto, sans-serif, 14px, 400, normal style and letter-spacing, nowrap, `color: var(--color-google-attribution)`.
  - No `@font-face`, no font import and no font package.
- `tests/unit/no-map.test.ts`, "no map library or map embed anywhere in the app":
  - **Packages:** fails on the Rule 31 package list and on the `@react-google-maps/*` scope.
  - **Source patterns:** fails on `maps/embed`, `staticmap`, `tile.openstreetmap`, `api.mapbox.com`, `maplibre`, or `<iframe` on a line that also contains `map`, anywhere under `src/`.
  - **Two-sided check:** it asserts more than 50 files were scanned and that `src/app/globals.css` was one of them.

## Task Commits

1. **Task 1 RED:** `f6c1f6b`, test(04-08): add failing tests for GoogleMapsTag and attribution token
2. **Task 1 GREEN:** `8f5d57f`, feat(04-08): add GoogleMapsTag with painted attribution token and class
3. **Task 2:** `36b952c`, test(04-08): add no-map guard (Rule 31, T-4-13)

## Verification (outputs read, not exit codes)

**Task 1 RED run.** The suite failed to resolve `@/components/places/google-maps-tag` because the module did not exist yet. After the component alone was written:
- `the google maps tag is exact text with translate=no` passed.
- `the google maps tag is not a badge` passed.
- `the attribution token is painted in both themes` failed with `no ".google-maps-attribution" block in globals.css`. The `:root`, `.dark` and `@theme inline` positive controls did resolve their blocks.

**Task 1 GREEN run.** All 3 tests passed (named in the verbose output).

**Task 1 mutations.** These go beyond the plan. Both were applied together and restored from backup:
- Changing `--google-attribution: #5E5E5E` to `#5B686D` turned `the attribution token is painted in both themes` red with `expected '…' to contain '--google-attribution: #5E5E5E;'`.
- Removing `translate="no"` turned `the google maps tag is exact text with translate=no` red with `expected null to be 'no'`.
- After restoring, 3/3 passed again.

**Task 2 mutation (Rule 31).** I added `"leaflet": "1.9.4"` to `package.json` dependencies. The run went red:
```
 × |node| tests/unit/no-map.test.ts > no map in the app > no map library or map embed anywhere in the app
   → package.json dependencies: leaflet: expected [ Array(1) ] to deeply equal []
+   "package.json dependencies: leaflet",
      Tests  1 failed (1)
```
I reverted with `git checkout package.json`. After the revert `git diff --stat` printed nothing, and `git status --short` showed only `?? tests/unit/no-map.test.ts`.

**Task 2 extra mutation (src side).** I appended `// <iframe src="https://www.google.com/maps/embed/v1/place?q=x" />` to `google-maps-tag.tsx`. The test went red, naming both `src\components\places\google-maps-tag.tsx:21 [Maps Embed API (maps/embed)]` and `[map <iframe>]`. I reverted with `git checkout` of that file, and `git diff --stat` came back empty.

**Acceptance greps:**
- `translate="no"` matches at line 15.
- `use client` is absent (grep exit 1).
- `grep -c google-attribution globals.css` returns 4.
- `@font-face` and `fonts.googleapis` are absent (grep exit 1).

**Gates in the worktree:**
- `npx vitest run tests/unit`: **48 files, 344 tests, all passed**. That is 46 baseline files plus the 2 new ones.
- `npx tsc --noEmit`: exit 0.
- `npx eslint . --ignore-pattern ".claude/**"`: exit 0.
- The db lane was not run. This plan touches no SQL, schema or db code.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test helper type error caught by tsc**
- **Found during:** Task 1, typecheck
- **Issue:** `blockOf()` returned `match[2]`, which is `string | undefined` under `noUncheckedIndexedAccess`. Vitest passed, but `tsc --noEmit` (which `next build` also runs over tests/) failed with TS2322.
- **Fix:** read `match?.[2]` and throw if it is undefined.
- **Files modified:** tests/unit/google-maps-tag.test.tsx
- **Commit:** `8f5d57f`

### Planned adjustments (as the plan instructed)

- **Literal instead of the copy import.** `GOOGLE_MAPS_TAG` is added by 04-07 in wave 2, so the component writes `'Google Maps'` inline with the comment `04-07 moves this literal into copy.ts as GOOGLE_MAPS_TAG`. **Handoff to 04-07:** replace the literal with `import { GOOGLE_MAPS_TAG } from '@/lib/ui/copy'` and `{GOOGLE_MAPS_TAG}`, and delete the comment. `google-maps-tag.test.tsx` pins the rendered text, so the swap is covered.
- **Local walker instead of `_walk`.** `tests/unit/_walk.ts` (04-02) is not in this tree, so `no-map.test.ts` has its own 7-line walker, the same shape as `no-google-credential.test.ts`. **04-02 note:** once `_walk` has landed, `no-map.test.ts` can import it. That is a mechanical swap with no behaviour change.
- **Paths and launcher.** The plan's commands `cd` to the main repo and use `$PNPM test:unit -t`. I ran everything from the worktree with `npx vitest run <file> -t … --reporter=verbose`, because pnpm 12 does not filter with `-t` through the script.

### Minor additions

- `no-map.test.ts` also scans `optionalDependencies` and asserts a positive control: `next` is found in `dependencies`, which proves the real manifest was parsed.
- `google-maps-tag.test.tsx`:
  - Positive controls: `--warning` in each of the three blocks, so an empty regex match cannot pass.
  - The "not a badge" test also asserts the span has no child elements.
  - The no-web-font assertion is included in the painted-token test.

## TDD Gate Compliance

- Task 1 has a RED commit (`f6c1f6b`, `test(...)`) followed by GREEN (`8f5d57f`, `feat(...)`).
- Task 2 is a guard over code that already complies, so the plan says it "should pass today" and it passed on its first run. Its failing half comes from the Rule 31 mutation (leaflet, red and named) plus the src-embed mutation, both recorded above. It is committed as a single `test(...)` commit, since there is no production code for a GREEN step to add.

## Known Stubs

None. The inline `'Google Maps'` literal is the correct rendered value, not a stub, and is explicitly handed to 04-07.

## Notes for the orchestrator (merge)

- `globals.css` gets three small insertions: after `--warning-surface-foreground` in `:root`, after the same token in `.dark`, and after `--color-warning-surface-foreground` in `@theme inline`. The file also gets one appended rule after `@layer base`. Another wave-1 plan editing the same neighbourhood could produce a textual conflict. Keep both sides.
- `tests/e2e/theme-tokens.spec.ts` was not touched. The computed-colour probe (`rgb(94, 94, 94)` / `rgb(255, 255, 255)`, font-family starting `Roboto`) belongs to 04-28.
- No package.json or lockfile change was committed (verified empty `git diff --stat` after each mutation).

## Self-Check: PASSED

- FOUND: src/components/places/google-maps-tag.tsx
- FOUND: tests/unit/google-maps-tag.test.tsx
- FOUND: tests/unit/no-map.test.ts
- FOUND: src/app/globals.css (4 `google-attribution` occurrences)
- FOUND commits: f6c1f6b, 8f5d57f, 36b952c
