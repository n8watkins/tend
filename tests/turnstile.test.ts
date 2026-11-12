import { describe, expect, it, vi } from 'vitest'

import { allowedHostnames, isTestSecret, turnstileSiteKey, verifyTurnstile } from '@/lib/server/turnstile'

const PROD = { PUBLIC_URL: 'https://tend.n8builds.dev', AUTH_URL: 'https://tend.n8builds.dev', APP_ENV: 'production' }
const KEYS = { TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'real-secret' }
const TEST_KEYS = { TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' }

const siteverify = (body: unknown, init?: ResponseInit) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init }))

describe('verifyTurnstile in production', () => {
  it('refuses when either key is missing, without calling Cloudflare', async () => {
    const fetchImpl = siteverify({ success: true, hostname: 'tend.n8builds.dev' })
    for (const keys of [{}, { TURNSTILE_SITE_KEY: 'site' }, { TURNSTILE_SECRET_KEY: 'real-secret' }]) {
      expect(await verifyTurnstile('tok', '1.1.1.1', { env: { ...PROD, ...keys }, fetchImpl })).toBe('not_configured')
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('treats a missing APP_ENV as production', async () => {
    expect(await verifyTurnstile('tok', null, { env: { NODE_ENV: 'production' } })).toBe('not_configured')
  })

  it('ignores the dev flag and refuses a Cloudflare test secret', async () => {
    expect(await verifyTurnstile('tok', null, { env: { ...PROD, TURNSTILE: 'off' } })).toBe('not_configured')
    expect(await verifyTurnstile('tok', null, { env: { ...PROD, ...TEST_KEYS }, fetchImpl: siteverify({ success: true }) })).toBe('not_configured')
    expect(turnstileSiteKey({ ...PROD, ...KEYS, TURNSTILE: 'off' })).toBe('site')
  })

  it('passes a token whose hostname is the app and fails closed on everything else', async () => {
    const env = { ...PROD, ...KEYS }
    expect(await verifyTurnstile('tok', '1.1.1.1', { env, fetchImpl: siteverify({ success: true, hostname: 'tend.n8builds.dev' }) })).toBe('ok')
    expect(await verifyTurnstile(null, null, { env, fetchImpl: siteverify({ success: true }) })).toBe('failed')
    expect(await verifyTurnstile('x'.repeat(2049), null, { env, fetchImpl: siteverify({ success: true }) })).toBe('failed')
    expect(await verifyTurnstile('tok', null, { env, fetchImpl: siteverify({ success: false }) })).toBe('failed')
    expect(await verifyTurnstile('tok', null, { env, fetchImpl: siteverify({ success: true, hostname: 'evil.example' }) })).toBe('failed')
    expect(await verifyTurnstile('tok', null, { env, fetchImpl: siteverify({ success: true, hostname: 'localhost' }) })).toBe('failed')
    expect(await verifyTurnstile('tok', null, { env, fetchImpl: siteverify({ success: true }) })).toBe('failed')
    expect(await verifyTurnstile('tok', null, { env, fetchImpl: siteverify({}, { status: 500 }) })).toBe('failed')
    expect(await verifyTurnstile('tok', null, { env, fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')) })).toBe('failed')
  })
})

describe('verifyTurnstile outside production', () => {
  it('passes with the explicit dev flag', async () => {
    const fetchImpl = siteverify({ success: false })
    expect(await verifyTurnstile(null, null, { env: { APP_ENV: 'test', TURNSTILE: 'off' }, fetchImpl })).toBe('ok')
    expect(turnstileSiteKey({ APP_ENV: 'test', TURNSTILE: 'off', ...KEYS })).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('passes with Cloudflare test keys (hostname example.com) and still fails a failing token', async () => {
    const env = { APP_ENV: 'test', ...TEST_KEYS }
    expect(await verifyTurnstile('XXXX.DUMMY.TOKEN.XXXX', null, { env, fetchImpl: siteverify({ success: true, hostname: 'example.com' }) })).toBe('ok')
    expect(await verifyTurnstile('XXXX.DUMMY.TOKEN.XXXX', null, { env, fetchImpl: siteverify({ success: false }) })).toBe('failed')
    expect(turnstileSiteKey(env)).toBe('1x00000000000000000000AA')
  })

  it('still refuses with no keys and no flag', async () => {
    expect(await verifyTurnstile('tok', null, { env: { NODE_ENV: 'development' } })).toBe('not_configured')
  })
})

describe('helpers', () => {
  it('knows the test secrets and the allowed hostnames', () => {
    expect(isTestSecret('1x0000000000000000000000000000000AA')).toBe(true)
    expect(isTestSecret('0x4AAAAAAAreal')).toBe(false)
    expect(allowedHostnames({ PUBLIC_URL: 'https://tend.n8builds.dev' })).toEqual(['tend.n8builds.dev'])
    expect(allowedHostnames({ PUBLIC_URL: 'not a url' })).toEqual([])
    expect(allowedHostnames({ APP_ENV: 'test', PUBLIC_URL: 'http://localhost:7842' })).toContain('127.0.0.1')
  })
})
