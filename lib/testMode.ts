/**
 * Test-only switches for the end-to-end suite. On only when APP_ENV=test, and
 * refused against anything but a local file: database, so they can never be
 * active in production (wrangler.jsonc sets APP_ENV=production).
 */

export function isTestMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.APP_ENV !== 'test') return false
  const url = env.TURSO_DATABASE_URL ?? ''
  if (!url.startsWith('file:')) throw new Error('APP_ENV=test is only allowed with a local file: database')
  return true
}

export function assertTestMode(feature: string): void {
  if (process.env.APP_ENV === 'production' || !isTestMode()) {
    throw new Error(`${feature} is test-only and is disabled outside APP_ENV=test`)
  }
}
