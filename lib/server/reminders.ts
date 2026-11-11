import 'server-only'

/**
 * The reminder run (docs/SPEC.md section 8), called by the Cron Trigger every
 * 15 minutes through /api/cron/reminders.
 *
 * 1. Messages whose contact no longer allows them are canceled.
 * 2. Due, unreminded messages of users with email reminders on and not paused
 *    are grouped by user. Each user's rows are claimed with a conditional
 *    UPDATE (remindedAt IS NULL), so overlapping runs never email twice.
 * 3. Each user's channels, as they chose in Settings: one email per run, and
 *    (when Telegram is linked) one Telegram message per due item with its
 *    buttons, each within its own per-user and site-wide daily caps. When no
 *    channel delivers, the claim is handed back so a later run (after the
 *    daily reset) tries again; "Due now" in the app shows them either way.
 */

import { and, eq, inArray, isNull, lte } from 'drizzle-orm'

import { db } from '@/db'
import { contacts, messages, userSettings, users } from '@/db/schema'
import { REMINDERS_PER_USER_DAILY, REMINDERS_SITE_DAILY } from '@/lib/limits'
import { allowedKinds } from '@/lib/schedule'
import { emailKey, layout, sendEmail } from '@/lib/server/email'
import { pruneLimits, readLimit, spend } from '@/lib/server/limits'
import { sendTelegramReminders, telegramConfigured } from '@/lib/server/telegram'
import { publicUrl } from '@/lib/url'

const MAX_USERS_PER_RUN = 100

export interface ReminderRun {
  canceled: number
  users: number
  emailed: number
  telegram: number
  capped: number
}

export async function runReminders(now = Date.now()): Promise<ReminderRun> {
  const result: ReminderRun = { canceled: 0, users: 0, emailed: 0, telegram: 0, capped: 0 }

  const due = await db
    .select({
      id: messages.id,
      userId: messages.userId,
      kind: messages.kind,
      body: messages.body,
      scheduledFor: messages.scheduledFor,
      contactName: contacts.name,
      consent: contacts.consent,
    })
    .from(messages)
    .innerJoin(contacts, eq(contacts.id, messages.contactId))
    .where(and(eq(messages.status, 'scheduled'), lte(messages.scheduledFor, now), isNull(messages.remindedAt)))
    .orderBy(messages.scheduledFor)
    .limit(1000)

  const blocked = due.filter((m) => !allowedKinds(m.consent).includes(m.kind))
  if (blocked.length) {
    await db
      .update(messages)
      .set({ status: 'canceled', updatedAt: now })
      .where(and(inArray(messages.id, blocked.map((m) => m.id)), eq(messages.status, 'scheduled')))
    result.canceled = blocked.length
  }

  const ready = due.filter((m) => !blocked.includes(m))
  const userIds = [...new Set(ready.map((m) => m.userId))].slice(0, MAX_USERS_PER_RUN)
  if (!userIds.length) {
    await pruneLimits(now)
    return result
  }

  const recipients = await db
    .select({
      id: users.id,
      email: users.email,
      emailReminders: userSettings.emailReminders,
      pausedAt: userSettings.pausedAt,
      telegramChatId: userSettings.telegramChatId,
      telegramReminders: userSettings.telegramReminders,
    })
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(inArray(users.id, userIds))

  const telegramOn = telegramConfigured()
  for (const user of recipients) {
    if (user.pausedAt) continue
    const byEmail = Boolean(user.email) && user.emailReminders !== false
    const telegramChat = telegramOn && user.telegramReminders !== false ? user.telegramChatId : null
    if (!byEmail && !telegramChat) continue
    result.users++
    const mine = ready.filter((m) => m.userId === user.id)
    const claimed = await db
      .update(messages)
      .set({ remindedAt: now })
      .where(and(inArray(messages.id, mine.map((m) => m.id)), isNull(messages.remindedAt), eq(messages.status, 'scheduled')))
      .returning({ id: messages.id })
    const claimedIds = claimed.map((c) => c.id)
    const items = mine.filter((m) => claimedIds.includes(m.id))
    if (!items.length) continue

    let delivered = false
    let retry = false
    if (byEmail) {
      const outcome = await emailReminder(user.id, user.email!, items, claimedIds, now)
      if (outcome === 'sent') {
        delivered = true
        result.emailed++
      } else if (outcome === 'retry') retry = true
    }
    if (telegramChat) {
      const sent = await sendTelegramReminders(telegramChat, user.id, items)
      if (sent > 0) {
        delivered = true
        result.telegram += sent
      } else retry = true
    }
    if (!delivered) {
      // Hand the claim back only when a later run can succeed.
      if (retry) await db.update(messages).set({ remindedAt: null }).where(inArray(messages.id, claimedIds))
      result.capped++
    }
  }

  await pruneLimits(now)
  return result
}

/** One email for the user's due items, within the email caps. */
async function emailReminder(
  userId: string,
  to: string,
  items: { id: string; contactName: string; kind: string }[],
  claimedIds: string[],
  now: number,
): Promise<'sent' | 'retry' | 'refused'> {
  const allowed = await spend(
    [
      { key: `reminder:user:${userId}`, limit: readLimit('REMINDERS_PER_USER_DAILY', REMINDERS_PER_USER_DAILY) },
      { key: 'reminder:site', limit: readLimit('REMINDER_EMAILS_DAILY', REMINDERS_SITE_DAILY) },
    ],
    now,
  )
  if (!allowed) return 'retry'
  const sent = await sendEmail('reminder', {
    ...reminderEmail(to, items),
    key: `reminder-${await emailKey(...[...claimedIds].sort())}`,
  })
  // Refused by the mailroom (over a cap, suppressed, ...): not retried in
  // this run, and only handed back when a later run can succeed.
  if (!sent.ok) return sent.retryable ? 'retry' : 'refused'
  return 'sent'
}

export function reminderEmail(to: string, items: { id: string; contactName: string; kind: string }[]) {
  const first = items[0]!
  const subject =
    items.length === 1
      ? `Time to send a message to ${first.contactName}`
      : `${items.length} messages are ready to send`
  const lines = items.map((m) => `${m.kind === 'consent_request' ? 'Ask' : 'Message'} ${m.contactName}: ${publicUrl(`/send/${m.id}`)}`)
  return {
    to,
    subject,
    text: `${subject}.\n\n${lines.join('\n')}\n\nOpen the link, copy the message, send it on Signal, then tap "I sent it".\n\nTurn these emails off in Settings: ${publicUrl('/settings')}`,
    html: layout({
      heading: subject,
      paragraphs: [
        ...items.map((m) => `${m.kind === 'consent_request' ? 'Ask' : 'Message'} ${m.contactName}`),
        'Open Tend, copy the message, send it on Signal, then tap "I sent it".',
      ],
      button: { label: items.length === 1 ? 'Open the message' : 'Open Tend', url: items.length === 1 ? publicUrl(`/send/${first.id}`) : publicUrl('/today') },
      footer: `You get these because email reminders are on in Tend. Turn them off in Settings: ${publicUrl('/settings')}`,
    }),
  }
}
