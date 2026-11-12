/**
 * Web Push with nothing but Web Crypto, so it runs in the Worker as is:
 * - message encryption, "aes128gcm" (RFC 8291 and RFC 8188), one record;
 * - VAPID (RFC 8292): an ES256 JWT that ties each push to Tend's key pair.
 *
 * Keys: the VAPID private key is the 32-byte P-256 scalar, as 64 hex
 * characters or 43 base64url ones; the public key, derived from it, is the
 * 65-byte uncompressed point (what the browser's pushManager.subscribe() takes).
 */

const encoder = new TextEncoder()

/* Encoding ----------------------------------------------------------------- */

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** The VAPID private key's 32 bytes, from hex or base64url; null when malformed. */
export function parsePrivateKey(text: string): Uint8Array<ArrayBuffer> | null {
  const value = text.trim()
  if (/^[0-9a-f]{64}$/i.test(value)) return Uint8Array.from(value.match(/../g)!, (h) => parseInt(h, 16))
  if (/^[A-Za-z0-9_-]{43}$/.test(value)) return base64UrlDecode(value)
  return null
}

/* Keys --------------------------------------------------------------------- */

function jwk(publicKey: Uint8Array, privateKey?: Uint8Array): JsonWebKey {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: base64UrlEncode(publicKey.subarray(1, 33)),
    y: base64UrlEncode(publicKey.subarray(33, 65)),
    ...(privateKey ? { d: base64UrlEncode(privateKey) } : {}),
    ext: true,
  }
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

/* Encryption (RFC 8291) ---------------------------------------------------- */

const RECORD_SIZE = 4096

export interface EncryptOptions {
  /** Test vectors only: a fixed salt and sender key pair instead of fresh random ones. */
  salt?: Uint8Array<ArrayBuffer>
  sender?: { publicKey: Uint8Array<ArrayBuffer>; privateKey: Uint8Array<ArrayBuffer> }
}

/**
 * Encrypts a push message for one subscription: `p256dh` is the browser's
 * public key and `auth` its 16-byte secret. Returns the request body.
 */
export async function encryptPush(
  plaintext: Uint8Array<ArrayBuffer>,
  p256dh: Uint8Array<ArrayBuffer>,
  auth: Uint8Array<ArrayBuffer>,
  options: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (p256dh.length !== 65 || p256dh[0] !== 4) throw new Error('bad p256dh key')
  if (auth.length !== 16) throw new Error('bad auth secret')
  // One record: the plaintext, the 0x02 delimiter and the 16-byte tag must fit.
  if (plaintext.length + 17 > RECORD_SIZE - 86) throw new Error('push message too long')

  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16))
  let senderPrivate: CryptoKey
  let senderPublic: Uint8Array<ArrayBuffer>
  if (options.sender) {
    senderPrivate = await crypto.subtle.importKey('jwk', jwk(options.sender.publicKey, options.sender.privateKey), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
    senderPublic = options.sender.publicKey
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    senderPrivate = pair.privateKey
    senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  }

  const receiver = await crypto.subtle.importKey('raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: receiver }, senderPrivate, 256))

  const keyInfo = concat(encoder.encode('WebPush: info\0'), p256dh, senderPublic)
  const ikm = await hkdf(auth, ecdhSecret, keyInfo, 32)
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12)

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))))

  const header = new Uint8Array(21)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = senderPublic.length
  return concat(header, senderPublic, ciphertext)
}

/* VAPID (RFC 8292) --------------------------------------------------------- */

export interface VapidKeys {
  publicKey: Uint8Array<ArrayBuffer>
  privateKey: Uint8Array<ArrayBuffer>
  /** A contact for the push services: a mailto: or https: URL. */
  subject: string
}

/** The Authorization header for a push to `endpoint`, valid for 12 hours. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = Date.now()): Promise<string> {
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = base64UrlEncode(
    encoder.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: vapid.subject })),
  )
  const key = await crypto.subtle.importKey('jwk', jwk(vapid.publicKey, vapid.privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  // Web Crypto's ECDSA signature is already r || s, the form JWS wants.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(`${header}.${claims}`)))
  return `vapid t=${header}.${claims}.${base64UrlEncode(signature)}, k=${base64UrlEncode(vapid.publicKey)}`
}

// PKCS #8 for a P-256 key holding only the private scalar (RFC 5915 with the
// optional public key left out); the 32 key bytes follow.
const PKCS8_P256_PREFIX = Uint8Array.from(
  '3041020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420'.match(/../g)!,
  (h) => parseInt(h, 16),
)

/**
 * The public key (65-byte uncompressed point) for a private key. Web Crypto
 * computes it when importing a PKCS #8 key without one, so only the private
 * key needs to be kept: there is no second value to keep in step.
 */
export async function derivePublicKey(privateKey: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (privateKey.length !== 32) throw new Error('bad private key')
  const key = await crypto.subtle.importKey('pkcs8', concat(PKCS8_P256_PREFIX, privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
  const { x, y } = await crypto.subtle.exportKey('jwk', key)
  return concat(new Uint8Array([4]), base64UrlDecode(x!), base64UrlDecode(y!))
}
