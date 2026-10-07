// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const NODE_BUILTINS = [
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'dns',
  'events',
  'fs',
  'http',
  'https',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'stream',
  'timers',
  'url',
  'util',
  'worker_threads',
];

export default defineConfig(
  globalIgnores(['**/node_modules/', '**/dist/', '**/coverage/', 'local-assets/']),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.ts', 'apps/*/*.ts', 'tools/*/*.ts', 'packages/*/*.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Plain JS config files have no type info.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['apps/server/**', 'tools/**', 'scripts/**', '*.js', '*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/client/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Rule engine must stay pure and deterministic (CLAUDE.md, .claude/rules/shared-engine.md).
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...[
          'Date',
          'console',
          'setTimeout',
          'setInterval',
          'setImmediate',
          'queueMicrotask',
          'fetch',
          'process',
          'performance',
          'crypto',
          'window',
          'document',
          'globalThis',
        ].map((name) => ({
          name,
          message: 'packages/shared must be pure: no clock, I/O or host APIs.',
        })),
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use state.rngState instead of Math.random.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: NODE_BUILTINS.map((name) => ({
            name,
            message: 'No Node APIs in packages/shared.',
          })),
          patterns: [
            { group: ['node:*'], message: 'No Node APIs in packages/shared.' },
            {
              group: ['@richman/*'],
              message: 'packages/shared must not import other workspace packages.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
