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
  DATA_ENCRYPTION_KEY: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=',
  CRON_SECRET: 'e2e-cron-secret',
  E2E_EMAIL_DIR: '.e2e/email',
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
