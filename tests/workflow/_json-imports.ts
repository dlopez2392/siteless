/**
 * Workflow-lane setup file (04-22): lets Node's native ESM loader import the JSON the step
 * bundle leaves external.
 *
 * `@workflow/vitest` builds `.workflow-vitest/steps.mjs` and loads it with a native `import()`
 * (no vite in between). Its builder bundles project TypeScript inline but leaves every JSON
 * import EXTERNAL and strips any import attribute — the seed tables `presets.ts` imports, the
 * geo shapes a step loads, and `builtin-modules.json` from the builder's own serde checker.
 * Node then refuses each one: `ERR_IMPORT_ATTRIBUTE_MISSING … needs an import attribute of
 * "type: json"`, the workflow's queue fails, and the test times out with no other symptom.
 *
 * Lane-only, deliberately. In the deployed app the step route is compiled by Next, which
 * bundles JSON like any other module; nothing in `src/` changes to suit this runner. The hook
 * adds `type: 'json'` to a `file:` URL ending in `.json` that arrived without it, and passes
 * everything else through untouched.
 */
import { registerHooks } from 'node:module';

registerHooks({
  load(url, context, nextLoad) {
    if (
      url.startsWith('file:') &&
      url.endsWith('.json') &&
      context.importAttributes?.type !== 'json'
    ) {
      return nextLoad(url, {
        ...context,
        importAttributes: { ...context.importAttributes, type: 'json' },
      });
    }
    return nextLoad(url, context);
  },
});
