import 'server-only'

/**
 * Shared plumbing for the Signal helper's routes (app/api/helper/*): JSON in
 * and out, no caching, the caller's address as a hashed rate-limit key, and
 * device-token authentication. Every route is a plain 404 while no account
 * is allowed to use the helper (SIGNAL_HELPER_USERS is empty).
 */

import { hashKey } from '@/lib/crypto'
import { authenticateHelper, type HelperAuth } from '@/lib/server/helper'

export function helperFeatureOn(): boolean {
  return Boolean(process.env.SIGNAL_HELPER_USERS?.trim())
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } })
}

export const notFound = () => json({ error: 'not_found' }, 404)

export function ipKey(request: Request): Promise<string> {
  return hashKey(request.headers.get('cf-connecting-ip')?.trim() || 'unknown')
}

/** Reads a JSON object body of at most 16 KB, or null. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text().catch(() => '')
  if (!text || text.length > 16_384) return null
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/** Runs `handler` for an authenticated helper, or answers 401, 404 or 429. */
export async function withHelper(request: Request, handler: (auth: Extract<HelperAuth, { ok: true }>) => Promise<Response>): Promise<Response> {
  if (!helperFeatureOn()) return notFound()
  const auth = await authenticateHelper(request.headers.get('authorization'), await ipKey(request))
  if (!auth.ok) return json({ error: auth.status === 401 ? 'unauthorized' : 'rate_limited' }, auth.status)
  return handler(auth)
}
