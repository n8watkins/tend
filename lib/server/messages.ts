import 'server-only'

/**
 * Changes to a scheduled message that both the web app (app/(app)/actions.ts)
 * and the Telegram buttons make, so the rules live in one place. Every query
 * is scoped by the user's id.
 */

import { and, eq, ne } from 'drizzle-orm'

import { db } from '@/db'
import { consentEvents, contacts, messages } from '@/db/schema'
import { getContact, getMessage } from '@/lib/server/data'
import { DAY } from '@/lib/time'

export type SentResult =
  | { ok: true; contactId: string; contactName: string }
  | { ok: false; reason: 'not_found' | 'not_scheduled' | 'consent' | 'helper_sending'; contactId?: string }

/**
 * The manual changes below are refused while the Signal helper is sending
 * this message (docs/SIGNAL-HELPER.md 2.4), and they withdraw any approval,
 * so the helper never sends something the user already handled.
 */
const notSending = ne(messages.sendState, 'sending')
const withdrawApproval = { approvalState: 'none' as const, approvedBodyHash: null, sendBy: null }

/** "I sent it": records the send, and a sent consent request moves them to "asked". */
export async function recordSent(userId: string, messageId: string, now = Date.now()): Promise<SentResult> {
  const message = await getMessage(userId, messageId)
  if (!message) return { ok: false, reason: 'not_found' }
  if (message.status !== 'scheduled') return { ok: false, reason: 'not_scheduled', contactId: message.contactId }
  if (message.sendState === 'sending') return { ok: false, reason: 'helper_sending', contactId: message.contactId }
  const contact = await getContact(userId, message.contactId)
  if (!contact) return { ok: false, reason: 'not_found' }
  // Already sent by the person, so only consent is checked: never record a
  // message to someone who said no or asked to stop.
  if (contact.consent === 'no' || contact.consent === 'stopped') return { ok: false, reason: 'consent', contactId: contact.id }
  const updated = await db
    .update(messages)
    .set({ status: 'sent', sentAt: now, sentVia: 'you', ...withdrawApproval, updatedAt: now })
    .where(and(eq(messages.id, messageId), eq(messages.userId, userId), eq(messages.status, 'scheduled'), notSending))
    .returning({ id: messages.id })
  if (!updated.length) return { ok: false, reason: 'not_scheduled', contactId: contact.id }
  if (message.kind === 'consent_request' && contact.consent === 'not_asked') {
    await db
      .update(contacts)
      .set({ consent: 'asked', consentUpdatedAt: now, updatedAt: now })
      .where(and(eq(contacts.id, contact.id), eq(contacts.userId, userId)))
    await db.insert(consentEvents).values({ userId, contactId: contact.id, from: 'not_asked', to: 'asked', by: 'you', at: now })
  }
  return { ok: true, contactId: contact.id, contactName: contact.name }
}

/** "Snooze a day": due again (and reminded again) 24 hours from now. */
export async function snoozeDay(userId: string, messageId: string, now = Date.now()): Promise<{ ok: boolean; until: number }> {
  const until = now + DAY
  const updated = await db
    .update(messages)
    .set({ scheduledFor: until, remindedAt: null, ...withdrawApproval, sendState: 'idle', updatedAt: now })
    .where(and(eq(messages.id, messageId), eq(messages.userId, userId), eq(messages.status, 'scheduled'), notSending))
    .returning({ id: messages.id })
  return { ok: updated.length > 0, until }
}

/** Skip by hand: kept in their history as not sent. */
export async function skipScheduled(userId: string, messageId: string, now = Date.now()): Promise<boolean> {
  const updated = await db
    .update(messages)
    .set({ status: 'skipped', ...withdrawApproval, updatedAt: now })
    .where(and(eq(messages.id, messageId), eq(messages.userId, userId), eq(messages.status, 'scheduled'), notSending))
    .returning({ id: messages.id })
  return updated.length > 0
}

/** Moves a scheduled message to a new time: due (and reminded) again then, with any approval withdrawn. */
export async function moveScheduled(userId: string, messageId: string, at: number, now = Date.now()): Promise<boolean> {
  const updated = await db
    .update(messages)
    .set({ scheduledFor: at, remindedAt: null, ...withdrawApproval, sendState: 'idle', updatedAt: now })
    .where(and(eq(messages.id, messageId), eq(messages.userId, userId), eq(messages.status, 'scheduled'), notSending))
    .returning({ id: messages.id })
  return updated.length > 0
}
