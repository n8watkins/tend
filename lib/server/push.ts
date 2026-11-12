import 'server-only'

/**
 * Phone notifications through Web Push (free; docs/SPEC.md section 15).
 *
 * - On only when the VAPID_PRIVATE_KEY secret is set; the public key is
 *   derived from it. lib/webpush.ts does the encryption and signing.
 * - Each browser or installed app that turns notifications on in Settings
 *   stores one subscription; a person can have several devices.
 * - A reminder push spends from per-user and site-wide daily caps first (the
 *   same as the email's), once per reminder run, however many devices.
 * - A subscription the push service reports gone (404 or 410) is deleted.
 */

import { and, eq, inArray, notInArray } from 'drizzle-orm'

import { db } from '@/db'
import { pushSubscriptions } from '@/db/schema'
import { PUSH_PER_USER_DAILY, PUSH_SITE_DAILY, PUSH_SUBSCRIPTIONS_PER_USER } from '@/lib/limits'
import type { NudgeLine } from '@/lib/occasions'
import { reminderPush, type PushItem, type PushPayload } from '@/lib/push'
import { readLimit, spend } from '@/lib/server/limits'
import { siteUrl } from '@/lib/url'
import { base64UrlDecode, base64UrlEncode, derivePublicKey, encryptPush, parsePrivateKey, vapidAuthorization, type VapidKeys } from '@/lib/webpush'

// Reminders older than this are not worth showing, so the push service may drop them.
const TTL_SECONDS = 12 * 60 * 60

export function pushConfigured(): boolean {
  return parsePrivateKey(process.env.VAPID_PRIVATE_KEY ?? '') !== null
}

// The key pair, derived once per isolate (and again if the secret changes).
let cached: { source: string; keys: Promise<VapidKeys> } | null = null

function vapidKeys(): Promise<VapidKeys> | null {
  const source = process.env.VAPID_PRIVATE_KEY ?? ''
  const privateKey = parsePrivateKey(source)
  if (!privateKey) return null
  if (cached?.source !== source) {
    const keys = derivePublicKey(privateKey).then((publicKey) => ({ publicKey, privateKey, subject: process.env.VAPID_SUBJECT || siteUrl() }))
    cached = { source, keys }
    keys.catch(() => (cached = null))
  }
  return cached.keys
}

/** The public key the browser subscribes with (base64url), or null when push is off. */
export async function vapidPublicKey(): Promise<string | null> {
  const keys = vapidKeys()
  return keys ? base64UrlEncode((await keys).publicKey) : null
}

export type Subscription = Pick<typeof pushSubscriptions.$inferSelect, 'id' | 'endpoint' | 'p256dh' | 'auth'>

export type PushResult = { ok: true } | { ok: false; gone: boolean; retryable: boolean; status: number }

/** One encrypted push to one subscription. Never throws. */
export async function sendPush(subscription: Subscription, payload: PushPayload): Promise<PushResult> {
  const keys = vapidKeys()
  if (!keys) return { ok: false, gone: false, retryable: false, status: 0 }
  try {
    const vapid = await keys
    const body = await encryptPush(new TextEncoder().encode(JSON.stringify(payload)), base64UrlDecode(subscription.p256dh), base64UrlDecode(subscription.auth))
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        authorization: await vapidAuthorization(subscription.endpoint, vapid),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(TTL_SECONDS),
        urgency: 'normal',
        // A newer reminder replaces one the phone has not received yet.
        topic: 'tend-reminder',
      },
      body,
    })
    if (response.ok) return { ok: true }
    const gone = response.status === 404 || response.status === 410
    const retryable = response.status === 429 || response.status >= 500
    if (!gone) console.error(JSON.stringify({ event: 'push_failed', status: response.status, host: new URL(subscription.endpoint).hostname }))
    return { ok: false, gone, retryable, status: response.status }
  } catch (error) {
    // A malformed stored key fails here too; a network error may pass.
    console.error(JSON.stringify({ event: 'push_failed', status: 0, error: String(error).slice(0, 200) }))
    return { ok: false, gone: false, retryable: true, status: 0 }
  }
}

/**
 * Sends a push to every one of the user's devices, deleting the ones that
 * are gone. 'sent' when at least one device got it; 'retry' when a later run
 * can do better (over a cap, or the push service was down).
 */
export async function pushToUser(
  userId: string,
  subscriptions: Subscription[],
  payload: PushPayload,
  caps: { key: string; limit: number }[],
  now = Date.now(),
): Promise<'sent' | 'retry' | 'refused'> {
  if (!subscriptions.length) return 'refused'
  if (!(await spend(caps, now).catch(() => false))) return 'retry'
  const results = await Promise.all(subscriptions.map((s) => sendPush(s, payload)))
  const gone = subscriptions.filter((_, i) => !results[i]!.ok && (results[i] as { gone: boolean }).gone).map((s) => s.id)
  if (gone.length) await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), inArray(pushSubscriptions.id, gone)))
  const delivered = subscriptions.filter((_, i) => results[i]!.ok).map((s) => s.id)
  if (delivered.length) {
    await db.update(pushSubscriptions).set({ lastPushedAt: now }).where(inArray(pushSubscriptions.id, delivered))
    return 'sent'
  }
  return results.some((r) => !r.ok && r.retryable) ? 'retry' : 'refused'
}

/** The reminder run's push: one per run for the user's due items and reminders. */
export function pushReminder(userId: string, subscriptions: Subscription[], items: PushItem[], now = Date.now(), nudges: NudgeLine[] = []) {
  return pushToUser(
    userId,
    subscriptions,
    reminderPush(items, nudges),
    [
      { key: `push:user:${userId}`, limit: readLimit('PUSH_PER_USER_DAILY', PUSH_PER_USER_DAILY) },
      { key: 'push:site', limit: readLimit('PUSH_SITE_DAILY', PUSH_SITE_DAILY) },
    ],
    now,
  )
}

/** "Send a test" in Settings: a few a day, and within the site cap. */
export function pushTest(userId: string, subscriptions: Subscription[]) {
  return pushToUser(
    userId,
    subscriptions,
    { title: 'Tend notifications are on', body: 'This is how a reminder will look when a message is ready to send.', url: '/today', tag: 'tend-test' },
    [
      { key: `push:test:${userId}`, limit: 5 },
      { key: 'push:site', limit: readLimit('PUSH_SITE_DAILY', PUSH_SITE_DAILY) },
    ],
  )
}

/* Subscriptions -------------------------------------------------------------- */

export async function userSubscriptions(userId: string): Promise<(Subscription & { device: string; createdAt: number })[]> {
  return db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
      device: pushSubscriptions.device,
      createdAt: pushSubscriptions.createdAt,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(pushSubscriptions.createdAt)
}

/** Every subscription of these users, grouped by user (for the reminder run). */
export async function subscriptionsFor(userIds: string[]): Promise<Map<string, Subscription[]>> {
  const map = new Map<string, Subscription[]>()
  if (!userIds.length || !pushConfigured()) return map
  const rows = await db
    .select({ id: pushSubscriptions.id, userId: pushSubscriptions.userId, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds))
  for (const { userId, ...row } of rows) map.set(userId, [...(map.get(userId) ?? []), row])
  return map
}

/**
 * Saves this device's subscription for the user. The same device signed in
 * to another account moves over; only the newest few per user are kept.
 */
export async function saveSubscription(userId: string, input: { endpoint: string; p256dh: string; auth: string; device: string }, now = Date.now()) {
  await db
    .insert(pushSubscriptions)
    .values({ userId, ...input, createdAt: now })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: input.p256dh, auth: input.auth, device: input.device, createdAt: now } })
  const keep = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(pushSubscriptions.createdAt)
  const excess = keep.slice(0, Math.max(0, keep.length - PUSH_SUBSCRIPTIONS_PER_USER)).map((r) => r.id)
  if (excess.length) await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), inArray(pushSubscriptions.id, excess)))
}

export async function removeSubscription(userId: string, endpoint: string) {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
}

/** Turns notifications off on every device but, optionally, one. */
export async function removeOtherSubscriptions(userId: string, keepEndpoint?: string) {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), ...(keepEndpoint ? [notInArray(pushSubscriptions.endpoint, [keepEndpoint])] : [])))
}
