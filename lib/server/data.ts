import 'server-only'

/**
 * Reads for the signed-in user. Every function takes the user's id and scopes
 * its query by it; ids from the URL are never trusted on their own.
 */

import { and, asc, desc, eq, inArray, isNull, like, lte, gt, ne, or, sql } from 'drizzle-orm'

import { db } from '@/db'
import { consentEvents, contacts, contactTopics, messages, type Contact, type Message } from '@/db/schema'
import { decrypt } from '@/lib/crypto'
import { DAY } from '@/lib/time'

export interface ContactDetail extends Contact {
  phone: string | null
  notes: string | null
  topics: { topic: string; weight: number }[]
}

export async function listContacts(userId: string, query?: string) {
  const q = query?.trim()
  const rows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.userId, userId), isNull(contacts.archivedAt), q ? like(contacts.name, `%${q.replace(/[%_]/g, '')}%`) : undefined))
    .orderBy(asc(sql`lower(${contacts.name})`))
  const next = await db
    .select({ contactId: messages.contactId, at: sql<number>`min(${messages.scheduledFor})` })
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.status, 'scheduled')))
    .groupBy(messages.contactId)
  const nextBy = new Map(next.map((n) => [n.contactId, n.at]))
  return rows.map((c) => ({ ...c, nextAt: nextBy.get(c.id) ?? null }))
}

export async function countContacts(userId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(contacts).where(eq(contacts.userId, userId))
  return Number(row?.n ?? 0)
}

export async function getContact(userId: string, id: string): Promise<ContactDetail | null> {
  const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.id, id), eq(contacts.userId, userId)) })
  if (!contact) return null
  const topics = await db
    .select({ topic: contactTopics.topic, weight: contactTopics.weight })
    .from(contactTopics)
    .where(eq(contactTopics.contactId, id))
  return { ...contact, phone: await decrypt(contact.phoneEnc), notes: await decrypt(contact.notesEnc), topics }
}

export async function contactMessages(userId: string, contactId: string): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.contactId, contactId)))
    .orderBy(desc(sql`coalesce(${messages.sentAt}, ${messages.scheduledFor})`))
}

/**
 * Library and starter ids the user sent to anyone other than this contact
 * since `since`, or has scheduled for them now. Suggestions offer these last
 * (lib/suggest.ts, ELSEWHERE_DAYS), so one quote doesn't go to everyone.
 */
export async function usedElsewhere(userId: string, contactId: string, since: number): Promise<Set<string>> {
  const rows = await db
    .select({ contentId: messages.contentId })
    .from(messages)
    .where(
      and(
        eq(messages.userId, userId),
        ne(messages.contactId, contactId),
        sql`${messages.contentId} is not null`,
        or(eq(messages.status, 'scheduled'), and(eq(messages.status, 'sent'), gt(messages.sentAt, since))),
      ),
    )
  return new Set(rows.map((r) => r.contentId as string))
}

export async function contactConsentEvents(userId: string, contactId: string) {
  return db
    .select()
    .from(consentEvents)
    .where(and(eq(consentEvents.userId, userId), eq(consentEvents.contactId, contactId)))
    .orderBy(desc(consentEvents.at))
}

/**
 * The times that count for spacing and caps: sent messages (at sentAt) and
 * scheduled ones (at scheduledFor), except consent requests and `exceptId`.
 */
export async function contactHistory(userId: string, contactId: string, exceptId?: string): Promise<number[]> {
  const rows = await db
    .select({ status: messages.status, scheduledFor: messages.scheduledFor, sentAt: messages.sentAt })
    .from(messages)
    .where(
      and(
        eq(messages.userId, userId),
        eq(messages.contactId, contactId),
        ne(messages.kind, 'consent_request'),
        inArray(messages.status, ['scheduled', 'sent']),
        exceptId ? ne(messages.id, exceptId) : undefined,
      ),
    )
  return rows.map((r) => (r.status === 'sent' ? (r.sentAt ?? r.scheduledFor) : r.scheduledFor))
}

export async function openConsentRequests(userId: string, contactId: string, exceptId?: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(messages)
    .where(
      and(
        eq(messages.userId, userId),
        eq(messages.contactId, contactId),
        eq(messages.kind, 'consent_request'),
        eq(messages.status, 'scheduled'),
        exceptId ? ne(messages.id, exceptId) : undefined,
      ),
    )
  return Number(row?.n ?? 0)
}

export async function countScheduled(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.status, 'scheduled')))
  return Number(row?.n ?? 0)
}

export type MessageWithContact = Message & { contactName: string }

async function withNames(rows: Message[], userId: string): Promise<MessageWithContact[]> {
  if (!rows.length) return []
  const ids = [...new Set(rows.map((r) => r.contactId))]
  const names = await db
    .select({ id: contacts.id, name: contacts.name })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), inArray(contacts.id, ids)))
  const byId = new Map(names.map((n) => [n.id, n.name]))
  return rows.map((r) => ({ ...r, contactName: byId.get(r.contactId) ?? 'Someone' }))
}

export async function getMessage(userId: string, id: string): Promise<MessageWithContact | null> {
  const row = await db.query.messages.findFirst({ where: and(eq(messages.id, id), eq(messages.userId, userId)) })
  if (!row) return null
  const [named] = await withNames([row], userId)
  return named ?? null
}

/** Today's lists: due now, missed (over 7 days late) and the next 14 days. */
export async function todayLists(userId: string, now: number) {
  const scheduled = await db
    .select()
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.status, 'scheduled'), lte(messages.scheduledFor, now + 14 * DAY)))
    .orderBy(asc(messages.scheduledFor))
  const named = await withNames(scheduled, userId)
  return {
    due: named.filter((m) => m.scheduledFor <= now && now - m.scheduledFor <= 7 * DAY),
    missed: named.filter((m) => now - m.scheduledFor > 7 * DAY),
    upcoming: named.filter((m) => m.scheduledFor > now),
  }
}

/** People at consent "yes" with nothing scheduled and nothing sent within their spacing. */
export async function couldUseAMessage(userId: string, now: number) {
  const yes = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.userId, userId), eq(contacts.consent, 'yes'), isNull(contacts.archivedAt)))
  if (!yes.length) return []
  const recent = await db
    .select({ contactId: messages.contactId, status: messages.status, sentAt: messages.sentAt })
    .from(messages)
    .where(
      and(
        eq(messages.userId, userId),
        or(eq(messages.status, 'scheduled'), and(eq(messages.status, 'sent'), gt(messages.sentAt, now - 90 * DAY))),
      ),
    )
  return yes.filter((c) => {
    const mine = recent.filter((m) => m.contactId === c.id)
    if (mine.some((m) => m.status === 'scheduled')) return false
    return !mine.some((m) => m.sentAt && now - m.sentAt < c.minDaysBetween * DAY)
  })
}

export async function historyList(userId: string, limit = 200): Promise<MessageWithContact[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.userId, userId), inArray(messages.status, ['sent', 'skipped', 'canceled'])))
    .orderBy(desc(messages.updatedAt))
    .limit(limit)
  return withNames(rows, userId)
}

export async function sentCount(userId: string, contactId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.contactId, contactId), eq(messages.status, 'sent')))
  return Number(row?.n ?? 0)
}
