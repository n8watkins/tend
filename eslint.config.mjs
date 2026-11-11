import js from '@eslint/js'
import nextVitals from 'eslint-config-next/core-web-vitals'
import tseslint from 'typescript-eslint'

const config = [
  {
    ignores: [
      '.next/**',
      '.open-next/**',
      '.wrangler/**',
      '.cache/**',
      '.e2e/**',
      'node_modules/**',
      'next-env.d.ts',
      'cloudflare-env.d.ts',
      'worker/runtime.d.ts',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextVitals,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
  {
    // Pages and layouts here are server components: they render once per
    // request, so reading the clock while rendering is intended.
    files: ['app/**/page.tsx', 'app/**/layout.tsx'],
    rules: { 'react-hooks/purity': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', setTimeout: 'readonly' } },
  },
]

export default config
