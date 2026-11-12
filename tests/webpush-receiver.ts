/**
 * The browser's side of Web Push, for tests: a subscription's keys, and
 * decrypting what lib/webpush.ts encrypted (RFC 8291). Used by the unit tests
 * and the end-to-end suite.
 */

import { base64UrlEncode } from '../lib/webpush'

export interface ReceiverKeys {
  p256dh: Uint8Array<ArrayBuffer>
  auth: Uint8Array<ArrayBuffer>
  privateKey: CryptoKey
}

export async function newSubscriptionKeys(): Promise<ReceiverKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  return {
    p256dh: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
    auth: crypto.getRandomValues(new Uint8Array(16)),
    privateKey: pair.privateKey,
  }
}

/** The subscription JSON a browser would hand over (PushSubscription.toJSON()). */
export function subscriptionJson(endpoint: string, keys: ReceiverKeys) {
  return { endpoint, expirationTime: null, keys: { p256dh: base64UrlEncode(keys.p256dh), auth: base64UrlEncode(keys.auth) } }
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: string | Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: infoBytes }, key, length * 8))
}

export async function decryptPush(body: Uint8Array, keys: ReceiverKeys): Promise<string> {
  const salt = body.slice(0, 16)
  const idLength = body[20]!
  const senderPublic = body.slice(21, 21 + idLength)
  const ciphertext = body.slice(21 + idLength)
  const sender = await crypto.subtle.importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, keys.privateKey, 256))
  const info = new Uint8Array([...new TextEncoder().encode('WebPush: info\0'), ...keys.p256dh, ...senderPublic])
  const ikm = await hkdf(keys.auth, ecdh, info, 32)
  const cek = await hkdf(salt, ikm, 'Content-Encoding: aes128gcm\0', 16)
  const nonce = await hkdf(salt, ikm, 'Content-Encoding: nonce\0', 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext))
  const end = padded.lastIndexOf(2)
  return new TextDecoder().decode(padded.slice(0, end))
}
