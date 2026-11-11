import 'server-only'

/**
 * Cloudflare Turnstile on the email sign-in form, checked on the server by the
 * sign-in action (app/signin/actions.ts).
 *
 * Optional until the owner creates the widget: with no TURNSTILE_SECRET_KEY
 * the check is skipped (and the form shows no widget, since the site key is
 * missing too). Once the secret is set it fails closed: a missing token, a
 * network error or anything but `success: true` refuses the request.
 */

export const TURNSTILE_FIELD = 'cf-turnstile-response'
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/**
 * The site key when Turnstile is on. Both keys are runtime Worker settings
 * (TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY), so turning it on needs no
 * rebuild, and it is on only when both are set.
 */
export function turnstileSiteKey(): string | null {
  const site = process.env.TURNSTILE_SITE_KEY
  return site && process.env.TURNSTILE_SECRET_KEY ? site : null
}

export async function verifyTurnstile(token: string | null, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret || !process.env.TURNSTILE_SITE_KEY) return true
  if (!token || token.length > 2048) return false
  const body = new FormData()
  body.set('secret', secret)
  body.set('response', token)
  if (ip) body.set('remoteip', ip)
  body.set('idempotency_key', crypto.randomUUID())
  try {
    const response = await fetch(SITEVERIFY, { method: 'POST', body })
    if (!response.ok) return false
    const result = (await response.json()) as { success?: unknown }
    return result.success === true
  } catch {
    return false
  }
}
