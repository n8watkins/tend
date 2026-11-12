import { createECDH } from 'node:crypto'

import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests against a production build (`next build` first), served in
 * test mode: a fresh local libSQL file database, and emails (sign-in links,
 * reminders) written to .e2e/email instead of sent. No secrets are needed.
 */

const PORT = Number(process.env.E2E_PORT || 7842)
const baseURL = `http://localhost:${PORT}`
const TELEGRAM_MOCK_PORT = Number(process.env.E2E_TELEGRAM_PORT || 7843)

const vapid = createECDH('prime256v1')
vapid.generateKeys()

export const E2E_ENV = {
  APP_ENV: 'test',
  // The explicit dev opt-out for the bot check (lib/server/turnstile.ts); ignored in production.
  TURNSTILE: 'off',
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
  // Telegram goes to e2e/telegram-mock.mjs, which logs every call to .e2e/telegram.jsonl.
  TELEGRAM_BOT_TOKEN: 'e2e-telegram-token',
  TELEGRAM_WEBHOOK_SECRET: 'e2e-telegram-webhook-secret',
  TELEGRAM_API_BASE: `http://localhost:${TELEGRAM_MOCK_PORT}`,
  TELEGRAM_PER_USER_DAILY: '1000',
  TELEGRAM_SITE_DAILY: '1000',
  // Web Push: a fresh VAPID key for each run; the push service is
  // e2e/telegram-mock.mjs, which logs to .e2e/push.jsonl.
  VAPID_PRIVATE_KEY: vapid.getPrivateKey('hex').padStart(64, '0'),
  PUSH_TEST_BASE: `http://localhost:${TELEGRAM_MOCK_PORT}/push`,
  PUSH_PER_USER_DAILY: '1000',
  PUSH_SITE_DAILY: '1000',
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
  webServer: [
    {
      command: 'node e2e/telegram-mock.mjs',
      url: `http://localhost:${TELEGRAM_MOCK_PORT}`,
      reuseExistingServer: false,
      env: { TELEGRAM_MOCK_PORT: String(TELEGRAM_MOCK_PORT) },
    },
    {
      command: `node scripts/migrate.mjs --fresh && npx next start -p ${PORT}`,
      url: baseURL,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      env: E2E_ENV,
    },
  ],
})
