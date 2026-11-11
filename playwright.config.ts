import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests against a production build (`next build` first), served in
 * test mode: a fresh local libSQL file database, and emails (sign-in links,
 * reminders) written to .e2e/email instead of sent. No secrets are needed.
 */

const PORT = Number(process.env.E2E_PORT || 7842)
const baseURL = `http://localhost:${PORT}`

export const E2E_ENV = {
  APP_ENV: 'test',
  TURSO_DATABASE_URL: 'file:.e2e/test.db',
  AUTH_SECRET: 'e2e-only-auth-secret-not-used-anywhere-else',
  AUTH_URL: baseURL,
  PUBLIC_URL: baseURL,
  DATA_ENCRYPTION_KEY: 'e2e-only-field-key-not-used-anywhere-else',
  CRON_SECRET: 'e2e-cron-secret',
  E2E_EMAIL_DIR: '.e2e/email',
  // Test-only: the suite signs in far more often than the production caps allow.
  SIGNIN_SITE_DAILY: '1000',
  REMINDER_EMAILS_DAILY: '1000',
  // Dummy GitHub OAuth app, so the GitHub button shows; the test stops at github.com.
  AUTH_GITHUB_ID: 'e2e-github-client-id',
  AUTH_GITHUB_SECRET: 'e2e-github-client-secret',
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node scripts/migrate.mjs --fresh && npx next start -p ${PORT}`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    env: E2E_ENV,
  },
})
