import 'server-only'

/**
 * Cloudflare Turnstile on the email sign-in form, checked on the server by the
 * sign-in action (app/signin/actions.ts).
 *
 * Fails closed in production: with either TURNSTILE_SITE_KEY or
 * TURNSTILE_SECRET_KEY missing (or the secret one of Cloudflare's test
 * secrets) every email sign-in is refused with "not_configured", never
 * silently skipped. With the keys set, a missing token, a network error,
 * anything but `success: true` or a hostname other than the app's own refuses
 * the request.
 *
 * Outside production (next dev, vitest, the e2e suite with APP_ENV=test) the
 * check works with Cloudflare's documented test keys, or is switched off with
 * the explicit dev flag TURNSTILE=off. The flag is ignored in production.
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */

export const TURNSTILE_FIELD = 'cf-turnstile-response'
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Siteverify answers a test secret with this hostname, whatever the page was. */
const TEST_HOSTNAME = 'example.com'

type Env = Record<string, string | undefined>

export type TurnstileResult = 'ok' | 'not_configured' | 'failed'

/** Production unless the process is clearly a test or local dev run. */
export function isProduction(env: Env = process.env): boolean {
  return !(env.APP_ENV === 'test' || env.NODE_ENV === 'development' || env.NODE_ENV === 'test')
}

/** Cloudflare's always-pass / always-fail / forced-challenge test secrets. */
export function isTestSecret(secret: string): boolean {
  return /^[123]x0+AA$/.test(secret)
}

/** The explicit dev opt-out; never honored in production. */
function devOptOut(env: Env): boolean {
  return !isProduction(env) && env.TURNSTILE === 'off'
}

/**
 * The site key when Turnstile is on, or null (no widget) when it is off or not
 * configured. Both keys are runtime Worker settings, so turning it on needs no
 * rebuild.
 */
export function turnstileSiteKey(env: Env = process.env): string | null {
  const site = env.TURNSTILE_SITE_KEY
  return site && env.TURNSTILE_SECRET_KEY && !devOptOut(env) ? site : null
}

/** Hostnames a token may come from: the app's own, plus localhost and the test hostname outside production. */
export function allowedHostnames(env: Env = process.env): string[] {
  const hosts = new Set<string>()
  for (const url of [env.PUBLIC_URL, env.AUTH_URL]) {
    if (!url) continue
    try {
      hosts.add(new URL(url).hostname)
    } catch {
      // A malformed URL allows no host, which fails closed.
    }
  }
  if (!isProduction(env)) {
    hosts.add('localhost')
    hosts.add('127.0.0.1')
  }
  return [...hosts]
}

export async function verifyTurnstile(
  token: string | null,
  ip: string | null,
  { env = process.env, fetchImpl = fetch }: { env?: Env; fetchImpl?: typeof fetch } = {},
): Promise<TurnstileResult> {
  if (devOptOut(env)) return 'ok'
  const secret = env.TURNSTILE_SECRET_KEY
  if (!secret || !env.TURNSTILE_SITE_KEY) return 'not_configured'
  // A test secret accepts a dummy token, so production never trusts one.
  if (isProduction(env) && isTestSecret(secret)) return 'not_configured'
  if (!token || token.length > 2048) return 'failed'
  const body = new FormData()
  body.set('secret', secret)
  body.set('response', token)
  if (ip) body.set('remoteip', ip)
  body.set('idempotency_key', crypto.randomUUID())
  try {
    const response = await fetchImpl(SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return 'failed'
    const result = (await response.json()) as { success?: unknown; hostname?: unknown }
    if (result.success !== true) return 'failed'
    if (isTestSecret(secret)) return result.hostname === TEST_HOSTNAME ? 'ok' : 'failed'
    const hosts = allowedHostnames(env)
    return typeof result.hostname === 'string' && hosts.includes(result.hostname) ? 'ok' : 'failed'
  } catch {
    return 'failed'
  }
}
