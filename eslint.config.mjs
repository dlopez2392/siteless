import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'drizzle/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      // Generated shadcn copy-ins. They are never hand-edited beyond the token pass
      // (02-UI-SPEC.md), so linting them can only produce noise that someone is then
      // tempted to silence by editing a primitive.
      'src/components/ui/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // First React rules in this repo. Phase 1 had no hooks at all; plan 02-10's debounced
  // estimate is the first hook-heavy code, and nothing in the config above would catch a
  // single hook mistake. rules-of-hooks is an error because violating it is a runtime
  // bug, not a style opinion; exhaustive-deps is an error too, because a missing
  // dependency on a debounced estimate is exactly how a stale figure repaints over a
  // fresh one (02-RESEARCH.md Pitfall 5).
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
