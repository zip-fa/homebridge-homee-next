import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import jsonc from 'eslint-plugin-jsonc';
import promise from 'eslint-plugin-promise';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Rule set adapted from jabka, minus Angular/Nx/rxjs. */
const sharedRules = {
  'no-constant-binary-expression': 'error',
  'no-else-return': ['error', { allowElseIf: true }],
  'padding-line-between-statements': [
    'error',
    { blankLine: 'always', prev: '*', next: 'return' },
    { blankLine: 'always', prev: '*', next: 'if' },
    { blankLine: 'always', prev: 'block-like', next: '*' },
    { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
    {
      blankLine: 'any',
      prev: ['const', 'let', 'var'],
      next: ['const', 'let', 'var'],
    },
    { blankLine: 'always', prev: 'import', next: '*' },
    { blankLine: 'any', prev: 'import', next: 'import' },
  ],
  'import/order': [
    'error',
    {
      'newlines-between': 'always',
      groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
      alphabetize: { order: 'asc', caseInsensitive: true },
    },
  ],
  'import/no-duplicates': 'error',
  'promise/param-names': 'off',
};

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'reference/**'] },

  {
    files: ['**/*.{ts,js,mjs}'],
    extends: [js.configs.recommended],
    plugins: { import: importPlugin, promise },
    rules: { ...promise.configs.recommended.rules, ...sharedRules },
  },

  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import/resolver': { typescript: { project: 'tsconfig.json' } },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-deprecated': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-exports': [
        'error',
        { fixMixedExportsWithInlineTypeSpecifier: false },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        {
          accessibility: 'no-public',
          overrides: {
            properties: 'explicit',
            parameterProperties: 'explicit',
          },
        },
      ],
    },
  },

  {
    // node:test's describe/it return promises the runner tracks itself.
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },

  {
    files: ['ui/**/*.js'],
    languageOptions: { globals: globals.browser, sourceType: 'module' },
  },

  {
    files: ['*.mjs'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['**/*.json'],
    extends: [jsonc.configs['flat/recommended-with-json']],
  },

  eslintConfigPrettier,
);
