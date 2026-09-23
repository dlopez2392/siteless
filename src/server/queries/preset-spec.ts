import 'server-only';

/**
 * The step-safe path from a stored version to a `PresetSpec` (04-22).
 *
 * The places-sweep `beginRun` step builds the run's spec exactly as `queueRun` priced it — the
 * same four functions, in the same order — so admission and execution plan the same searches
 * (D-16). Steps import them from HERE, never from a module that could grow a `next/*` or
 * `@clerk/*` import: a step bundle runs outside a Next request, and `next/headers` or Clerk's
 * `auth()` inside one throws at runtime, long after typecheck, lint and build were green.
 *
 * `./presets.ts` is step-safe today (its imports are drizzle, zod, the db client, the seed JSON
 * and `./budget`), so this module is a re-export rather than a move, and no caller changed.
 * `tests/unit/places-sweep-imports.test.ts` walks every module a step can reach from
 * `src/workflows/places-sweep/steps.ts` — this one and `./presets.ts` included — and fails on a
 * `next/*` or `@clerk/*` import or a `'use server'` directive, so if `presets.ts` ever grows
 * one, the fix is to move these four here rather than to relax that test.
 */
export { getSeedTables, readReferenceIndex, resolveSpec, specInputOfVersion } from './presets';
