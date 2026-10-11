import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.superpowers/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      // A leading underscore marks an intentionally unused parameter.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['src/main/**', 'src/preload/**', 'tests/**', '*.config.ts'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['src/renderer/**'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules
  },
  {
    files: ['src/renderer/**', 'src/shared/**'],
    rules: {
      // Renderer and shared code must stay free of Node/Electron so the sandbox boundary holds.
      'no-restricted-imports': ['error', { patterns: ['electron', 'node:*', 'fs', 'path', 'child_process'] }]
    }
  }
)
