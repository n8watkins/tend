import 'server-only'

/**
 * Birthdays, anniversaries and "keep in touch" on the server: what Today and
 * the person page show, and the reminders the cron sends (docs/SPEC.md
 * section 8, "Occasions and keeping in touch"). The rules themselves are
 * pure, in lib/occasions.ts.
 *
 * A reminder (a "nudge") goes only for a person at consent "yes", not
 * archived, with nothing already scheduled for them, while the user is not
 * paused. It travels with the due messages in the same run, through the same
 * channels and within the same caps. Each one is claimed in the nudge table
 * first (contact and key), so it is never sent twice.
 */

import { and, eq, gt, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm'

import { db } from '@/db'
import { contacts, messages, nudges, userSettings, type Contact } from '@/db/schema'
import {
  cadenceDueAt,
  cadenceNudge,
  lastInTouch,
  occasionNudge,
  parsePartialDate,
  upcoming,
  UPCOMING_DAYS,
  type NudgeLine,
  type Upcoming,
} from '@/lib/occasions'
import type { ContactRules } from '@/lib/schedule'
import { DAY } from '@/lib/time'

/** How long a sent nudge is remembered: longer than any cadence or year. */
const NUDGE_MEMORY = 400 * DAY

export interface Nudge extends NudgeLine {
  userId: string
  contactId: string
  key: string
}

type MessageRow = { contactId: string; kind: string; status: string; scheduledFor: number; sentAt: number | null }

/** Times for spacing and caps, as contactHistory in lib/server/data.ts. */
function historyOf(rows: MessageRow[]): number[] {
  return rows.filter((m) => m.kind !== 'consent_request').map((m) => (m.status === 'sent' ? (m.sentAt ?? m.scheduledFor) : m.scheduledFor))
}

function sentTimes(rows: MessageRow[]): number[] {
  return rows.filter((m) => m.status === 'sent' && m.sentAt).map((m) => m.sentAt!)
}

/** Sent and scheduled messages of these contacts that matter here: sent in the last 400 days, or still scheduled. */
async function messagesFor(contactIds: string[], now: number): Promise<Map<string, MessageRow[]>> {
  const map = new Map<string, MessageRow[]>()
  if (!contactIds.length) return map
  const rows = await db
    .select({ contactId: messages.contactId, kind: messages.kind, status: messages.status, scheduledFor: messages.scheduledFor, sentAt: messages.sentAt })
    .from(messages)
    .where(
      and(
        inArray(messages.contactId, contactIds),
        or(eq(messages.status, 'scheduled'), and(eq(messages.status, 'sent'), gt(messages.sentAt, now - NUDGE_MEMORY))),
      ),
    )
  for (const row of rows) map.set(row.contactId, [...(map.get(row.contactId) ?? []), row])
  return map
}

type CadenceContact = Pick<Contact, 'cadenceDays' | 'lastInTouchAt' | 'createdAt'> & ContactRules

/** Last in touch and next due for a person with a cadence; null without one. */
export function cadenceFor(contact: CadenceContact, rows: MessageRow[]): { last: number | null; dueAt: number; scheduled: boolean } | null {
  if (!contact.cadenceDays) return null
  const last = lastInTouch(contact.lastInTouchAt, sentTimes(rows))
  return {
    last,
    dueAt: cadenceDueAt(contact, contact.cadenceDays, last, contact.createdAt, historyOf(rows)),
    scheduled: rows.some((m) => m.status === 'scheduled'),
  }
}

/** The person page: when you were last in touch, and their cadence if they have one. */
export async function keepInTouchState(contact: Contact, now = Date.now()) {
  const rows = (await messagesFor([contact.id], now)).get(contact.id) ?? []
  return { last: lastInTouch(contact.lastInTouchAt, sentTimes(rows)), cadence: cadenceFor(contact, rows) }
}

/** Their birthday and anniversary, as they next come round, soonest first. */
export function contactOccasions(contact: Pick<Contact, 'birthday' | 'anniversary' | 'timezone'>, now: number): Upcoming[] {
  const list: Upcoming[] = []
  const birthday = parsePartialDate(contact.birthday)
  const anniversary = parsePartialDate(contact.anniversary)
  if (birthday) list.push(upcoming('birthday', birthday, now, contact.timezone))
  if (anniversary) list.push(upcoming('anniversary', anniversary, now, contact.timezone))
  return list.sort((a, b) => a.daysAway - b.daysAway)
}

/** Today: people at "yes" whose keep-in-touch time has come, with nothing scheduled for them. */
export async function dueToReachOut(userId: string, now: number) {
  const rows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.userId, userId), eq(contacts.consent, 'yes'), isNull(contacts.archivedAt), isNotNull(contacts.cadenceDays)))
  const byContact = await messagesFor(
    rows.map((c) => c.id),
    now,
  )
  return rows
    .map((c) => ({ contact: c, cadence: cadenceFor(c, byContact.get(c.id) ?? []) }))
    .filter((r) => r.cadence && !r.cadence.scheduled && r.cadence.dueAt <= now)
    .map((r) => ({ id: r.contact.id, name: r.contact.name, cadenceDays: r.contact.cadenceDays!, dueAt: r.cadence!.dueAt, last: r.cadence!.last }))
    .sort((a, b) => a.dueAt - b.dueAt)
}

/** Today: birthdays and anniversaries in the next two weeks, soonest first. */
export async function upcomingOccasions(userId: string, now: number) {
  const rows = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      consent: contacts.consent,
      birthday: contacts.birthday,
      anniversary: contacts.anniversary,
      timezone: contacts.timezone,
    })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), isNull(contacts.archivedAt), or(isNotNull(contacts.birthday), isNotNull(contacts.anniversary))))
  return rows
    .flatMap((c) => contactOccasions(c, now).map((occasion) => ({ id: c.id, name: c.name, consent: c.consent, occasion })))
    .filter((r) => r.occasion.daysAway <= UPCOMING_DAYS)
    .sort((a, b) => a.occasion.daysAway - b.occasion.daysAway || a.name.localeCompare(b.name))
}

/* The cron ------------------------------------------------------------------- */

/**
 * Every reminder due now, site-wide, before claiming: occasions on their day
 * or within their lead days, and cadences past due, each only inside the
 * person's contact window. Some may have gone out already; claimNudges keeps
 * only the new ones.
 */
export async function dueNudges(now: number): Promise<Nudge[]> {
  const rows = await db
    .select({ contact: contacts })
    .from(contacts)
    .leftJoin(userSettings, eq(userSettings.userId, contacts.userId))
    .where(
      and(
        eq(contacts.consent, 'yes'),
        isNull(contacts.archivedAt),
        isNull(userSettings.pausedAt),
        or(isNotNull(contacts.birthday), isNotNull(contacts.anniversary), isNotNull(contacts.cadenceDays)),
      ),
    )
    .limit(5000)
  const people = rows.map((r) => r.contact)
  const byContact = await messagesFor(
    people.map((c) => c.id),
    now,
  )
  const out: Nudge[] = []
  for (const c of people) {
    const mine = byContact.get(c.id) ?? []
    if (mine.some((m) => m.status === 'scheduled')) continue
    const base = { userId: c.userId, contactId: c.id, contactName: c.name }
    for (const kind of ['birthday', 'anniversary'] as const) {
      const date = parsePartialDate(c[kind])
      const nudge = date ? occasionNudge(kind, date, c, c.occasionLeadDays, now) : null
      if (nudge) out.push({ ...base, kind, daysAway: nudge.daysAway, key: nudge.key, path: `/people/${c.id}?occasion=${kind}#occasion` })
    }
    const cadence = cadenceFor(c, mine)
    const nudge = cadence ? cadenceNudge(c, cadence.dueAt, now) : null
    if (nudge) out.push({ ...base, kind: 'cadence', daysAway: 0, key: nudge.key, path: `/people/${c.id}#suggestions` })
  }
  return out
}

/** Records these reminders as sent; returns only the ones no earlier run had claimed. */
export async function claimNudges(items: Nudge[], now: number): Promise<Nudge[]> {
  if (!items.length) return []
  const claimed = await db
    .insert(nudges)
    .values(items.map((n) => ({ contactId: n.contactId, userId: n.userId, key: n.key, at: now })))
    .onConflictDoNothing()
    .returning({ contactId: nudges.contactId, key: nudges.key })
  const ids = new Set(claimed.map((c) => `${c.contactId} ${c.key}`))
  return items.filter((n) => ids.has(`${n.contactId} ${n.key}`))
}

/** Hands claimed reminders back, so a later run can send them. */
export async function releaseNudges(items: Nudge[]): Promise<void> {
  for (const n of items) await db.delete(nudges).where(and(eq(nudges.contactId, n.contactId), eq(nudges.key, n.key)))
}

export async function pruneNudges(now: number): Promise<void> {
  await db.delete(nudges).where(lt(nudges.at, now - NUDGE_MEMORY))
}
