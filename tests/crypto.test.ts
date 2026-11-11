import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { decrypt, encrypt, randomToken } from '@/lib/crypto'

const KEY = 'a'.repeat(48)

describe('field encryption', () => {
  beforeEach(() => {
    process.env.DATA_ENCRYPTION_KEY = KEY
  })
  afterEach(() => {
    delete process.env.DATA_ENCRYPTION_KEY
  })

  it('round-trips and never stores the plain text', async () => {
    const sealed = await encrypt('+15551234567')
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+$/)
    expect(sealed).not.toContain('5551234567')
    expect(await decrypt(sealed)).toBe('+15551234567')
  })

  it('uses a fresh IV every time', async () => {
    expect(await encrypt('same')).not.toBe(await encrypt('same'))
  })

  it('passes empty values through as null', async () => {
    expect(await encrypt('')).toBeNull()
    expect(await decrypt(null)).toBeNull()
  })

  it('fails on tampered ciphertext or a wrong key', async () => {
    const sealed = (await encrypt('secret'))!
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA')
    await expect(decrypt(tampered)).rejects.toThrow()
    process.env.DATA_ENCRYPTION_KEY = 'b'.repeat(48)
    await expect(decrypt(sealed)).rejects.toThrow()
  })

  it('refuses a short key', async () => {
    process.env.DATA_ENCRYPTION_KEY = 'short'
    await expect(encrypt('x')).rejects.toThrow(/at least 32/)
  })
})

describe('randomToken', () => {
  it('is 43 base64url characters and unique', () => {
    const a = randomToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(randomToken()).not.toBe(a)
  })
})
