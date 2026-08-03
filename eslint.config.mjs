// eslint.config.mjs
// Flat config for the whole workspace. Deliberately small: it enforces the two
// house rules that matter here — no `any` and no silently swallowed errors.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      // TypeScript resolves globals itself; the core rule only produces
      // false positives on `process`, `console` and friends.
      'no-undef': 'off',
    },
  },
);
