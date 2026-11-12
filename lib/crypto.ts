/**
 * Field encryption for phone numbers and notes (docs/SPEC.md section 10):
 * AES-256-GCM through WebCrypto, which Workers and Node both provide.
 * Stored as "v1.<iv>.<ciphertext>" in base64url. The AES key is derived with
 * HKDF-SHA-256 from the DATA_ENCRYPTION_KEY secret (any random string of 32
 * or more characters, such as `pass-env generate`'s 48).
 */

const VERSION = 'v1'
let cached: { raw: string; key: Promise<CryptoKey> } | undefined

function b64urlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64Decode(value: string): Uint8Array<ArrayBuffer> {
  const normal = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normal + '='.repeat((4 - (normal.length % 4)) % 4))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function key(): Promise<CryptoKey> {
  const raw = process.env.DATA_ENCRYPTION_KEY
  if (!raw) throw new Error('DATA_ENCRYPTION_KEY is not set')
  if (raw.length < 32) throw new Error('DATA_ENCRYPTION_KEY must be at least 32 characters')
  if (cached?.raw !== raw) {
    const material = crypto.subtle.importKey('raw', new TextEncoder().encode(raw), 'HKDF', false, ['deriveKey'])
    cached = {
      raw,
      key: material.then((base) =>
        crypto.subtle.deriveKey(
          { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('tend'), info: new TextEncoder().encode('field-encryption-v1') },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        ),
      ),
    }
  }
  return cached.key
}

export async function encrypt(plain: string | null | undefined): Promise<string | null> {
  if (!plain) return null
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(plain)
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), data))
  return `${VERSION}.${b64urlEncode(iv)}.${b64urlEncode(sealed)}`
}

export async function decrypt(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null
  const [version, iv, sealed] = stored.split('.')
  if (version !== VERSION || !iv || !sealed) throw new Error('Unknown encrypted value format')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64Decode(iv) }, await key(), b64Decode(sealed))
  return new TextDecoder().decode(plain)
}

let indexCache: { raw: string; key: Promise<CryptoKey> } | undefined

/**
 * A keyed hash (HMAC-SHA-256, key derived from DATA_ENCRYPTION_KEY) of a
 * value Tend must recognise but not keep, such as an imported contact's
 * email address: equal inputs give equal outputs, and without the key the
 * value cannot be recovered or guessed by hashing candidates.
 */
export async function blindIndex(value: string): Promise<string> {
  const raw = process.env.DATA_ENCRYPTION_KEY
  if (!raw || raw.length < 32) throw new Error('DATA_ENCRYPTION_KEY is not set')
  if (indexCache?.raw !== raw) {
    const material = crypto.subtle.importKey('raw', new TextEncoder().encode(raw), 'HKDF', false, ['deriveKey'])
    indexCache = {
      raw,
      key: material.then((base) =>
        crypto.subtle.deriveKey(
          { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('tend'), info: new TextEncoder().encode('blind-index-v1') },
          base,
          { name: 'HMAC', hash: 'SHA-256', length: 256 },
          false,
          ['sign'],
        ),
      ),
    }
  }
  const mac = await crypto.subtle.sign('HMAC', await indexCache.key, new TextEncoder().encode(value))
  return `v1.${b64urlEncode(new Uint8Array(mac))}`
}

/** 32 random bytes as base64url: stop tokens. */
export function randomToken(): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(32)))
}

/** SHA-256 of a value with a fixed salt, base64url: rate-limit keys for emails and IPs. */
export async function hashKey(value: string): Promise<string> {
  const salt = process.env.AUTH_SECRET ?? 'tend'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${value}`))
  return b64urlEncode(new Uint8Array(digest)).slice(0, 32)
}
