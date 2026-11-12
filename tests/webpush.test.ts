import { describe, expect, it } from 'vitest'

import { base64UrlDecode, base64UrlEncode, derivePublicKey, encryptPush, parsePrivateKey, vapidAuthorization } from '@/lib/webpush'

import { decryptPush, newSubscriptionKeys } from './webpush-receiver'

const b = (text: string) => base64UrlDecode(text.replace(/\s+/g, ''))

// The published example of RFC 8291 (section 5 and appendix A): the
// receiver (ua) and sender (as) key pairs, the 16-byte value the browser
// gives with its key, and the salt. Test vectors, not secrets.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  uaRand16: 'BTBZMqHH6r4Tts7J_aSIgg',
  uaPoint: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaScalar: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  asPoint: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asScalar: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
         mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
         pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`,
}

describe('push encryption (RFC 8291)', () => {
  it('matches the RFC example byte for byte', async () => {
    const body = await encryptPush(new TextEncoder().encode(RFC.plaintext), b(RFC.uaPoint), b(RFC.uaRand16), {
      salt: b(RFC.salt),
      sender: { publicKey: b(RFC.asPoint), privateKey: b(RFC.asScalar) },
    })
    expect(base64UrlEncode(body)).toBe(RFC.body.replace(/\s+/g, ''))
  })

  it('round-trips with fresh keys, and every message differs', async () => {
    const receiver = await newSubscriptionKeys()
    const message = JSON.stringify({ title: 'Time to message Sam', url: '/send/x' })
    const one = await encryptPush(new TextEncoder().encode(message), receiver.p256dh, receiver.auth)
    const two = await encryptPush(new TextEncoder().encode(message), receiver.p256dh, receiver.auth)
    expect(base64UrlEncode(one)).not.toBe(base64UrlEncode(two))
    expect(await decryptPush(one, receiver)).toBe(message)
  })

  it('refuses malformed keys and oversized messages', async () => {
    const receiver = await newSubscriptionKeys()
    await expect(encryptPush(new Uint8Array(4), receiver.p256dh.slice(1), receiver.auth)).rejects.toThrow('p256dh')
    await expect(encryptPush(new Uint8Array(4), receiver.p256dh, receiver.auth.slice(1))).rejects.toThrow('auth')
    await expect(encryptPush(new Uint8Array(4000), receiver.p256dh, receiver.auth)).rejects.toThrow('too long')
  })
})

describe('VAPID (RFC 8292)', () => {
  const vapid = { publicKey: b(RFC.asPoint), privateKey: b(RFC.asScalar), subject: 'https://tend.n8builds.dev' }

  it('signs an ES256 JWT for the push service origin that verifies with the public key', async () => {
    const now = Date.UTC(2026, 10, 11)
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, now)
    const match = header.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/)
    expect(match).not.toBeNull()
    const [, h, c, s, k] = match!
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(h!)))).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(c!)))).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now / 1000 + 12 * 3600,
      sub: 'https://tend.n8builds.dev',
    })
    expect(k).toBe(RFC.asPoint)
    const key = await crypto.subtle.importKey('raw', b(k!), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, base64UrlDecode(s!), new TextEncoder().encode(`${h}.${c}`))
    expect(valid).toBe(true)
  })

  it('reads private keys as hex or base64url, and derives the public key from them', async () => {
    const raw = b(RFC.asScalar)
    const hex = [...raw].map((x) => x.toString(16).padStart(2, '0')).join('')
    expect(parsePrivateKey(hex)).toEqual(raw)
    expect(parsePrivateKey(` ${hex.toUpperCase()}\n`)).toEqual(raw)
    expect(parsePrivateKey(RFC.asScalar)).toEqual(raw)
    expect(parsePrivateKey('not a key')).toBeNull()
    expect(base64UrlEncode(await derivePublicKey(raw))).toBe(RFC.asPoint)
    expect(base64UrlEncode(await derivePublicKey(b(RFC.uaScalar)))).toBe(RFC.uaPoint)
    await expect(derivePublicKey(raw.slice(1))).rejects.toThrow('bad private key')
  })
})
