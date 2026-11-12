import 'server-only'

/**
 * The reminder run (docs/SPEC.md section 8), called by the Cron Trigger every
 * 15 minutes (worker/cron.ts, via lib/server/reminder-cron.ts).
 *
 * 1. Messages whose contact no longer allows them are canceled.
 * 2. Due, unreminded messages of users with a reminder channel and not paused
 *    are grouped by user. Each user's rows are claimed with a conditional
 *    UPDATE (remindedAt IS NULL), so overlapping runs never email twice.
 * 3. Each user's channels, as they chose in Settings: one email per run,
 *    one phone notification per run (to every device that turned them on),
 *    and (when Telegram is linked) one Telegram message per due item with its
 *    buttons, each within its own per-user and site-wide daily caps. When no
 *    channel delivers, the claim is handed back so a later run (after the
 *    daily reset) tries again; "Due now" in the app shows them either way.
 * 4. Birthday, anniversary and keep-in-touch reminders (lib/server/nudges.ts)
 *    ride along in the same email, notification and caps; each is claimed
 *    in the nudge table first and handed back the same way.
 */

import { and, eq, inArray, isNull, lte } from 'drizzle-orm'

import { db } from '@/db'
import { contacts, messages, userSettings, users } from '@/db/schema'
import { REMINDERS_PER_USER_DAILY, REMINDERS_SITE_DAILY } from '@/lib/limits'
import { allowedKinds } from '@/lib/schedule'
import { emailKey, layout, sendEmail } from '@/lib/server/email'
import { helperAllowedFor, requestApprovals } from '@/lib/server/helper'
import { pruneLimits, readLimit, spend } from '@/lib/server/limits'
import { claimNudges, dueNudges, pruneNudges, releaseNudges, type Nudge } from '@/lib/server/nudges'
import { nudgeTitle, type NudgeLine } from '@/lib/occasions'
import { pushReminder, subscriptionsFor } from '@/lib/server/push'
import { sendTelegramReminders, telegramConfigured } from '@/lib/server/telegram'
import { publicUrl } from '@/lib/url'

const MAX_USERS_PER_RUN = 100

export interface ReminderRun {
  canceled: number
  users: number
  emailed: number
  telegram: number
  pushed: number
  /** Birthday, anniversary and keep-in-touch reminders delivered. */
  nudged: number
  capped: number
  /** Approval requests pushed for the Signal helper (lib/server/helper.ts). */
  approvals: number
}

export async function runReminders(now = Date.now()): Promise<ReminderRun> {
  const result: ReminderRun = { canceled: 0, users: 0, emailed: 0, telegram: 0, pushed: 0, nudged: 0, capped: 0, approvals: 0 }

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
  const pending = await dueNudges(now)
  const userIds = [...new Set([...ready.map((m) => m.userId), ...pending.map((n) => n.userId)])].slice(0, MAX_USERS_PER_RUN)
  if (!userIds.length) {
    await Promise.all([pruneLimits(now), pruneNudges(now)])
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
      helperEnabled: userSettings.helperEnabled,
    })
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(inArray(users.id, userIds))

  const telegramOn = telegramConfigured()
  const devices = await subscriptionsFor(recipients.filter((u) => !u.pausedAt).map((u) => u.id))
  for (const user of recipients) {
    if (user.pausedAt) continue
    const byEmail = Boolean(user.email) && user.emailReminders !== false
    const telegramChat = telegramOn && user.telegramReminders !== false ? user.telegramChatId : null
    const pushDevices = devices.get(user.id) ?? []
    let mine = ready.filter((m) => m.userId === user.id)
    // With a Signal helper, due messages it may send are asked about with
    // Send and Skip instead; those that were pushed skip the usual reminder.
    if (user.helperEnabled && helperAllowedFor(user.email)) {
      const asked = await requestApprovals(user.id, mine.map((m) => m.id), pushDevices, now)
      result.approvals += asked.length
      mine = mine.filter((m) => !asked.includes(m.id))
    }
    if (!byEmail && !telegramChat && !pushDevices.length) continue
    const claimed = mine.length
      ? await db
          .update(messages)
          .set({ remindedAt: now })
          .where(and(inArray(messages.id, mine.map((m) => m.id)), isNull(messages.remindedAt), eq(messages.status, 'scheduled')))
          .returning({ id: messages.id })
      : []
    const claimedIds = claimed.map((c) => c.id)
    const items = mine.filter((m) => claimedIds.includes(m.id))
    const nudges = await claimNudges(
      pending.filter((n) => n.userId === user.id),
      now,
    )
    if (!items.length && !nudges.length) continue
    result.users++

    let delivered = false
    let retry = false
    if (byEmail) {
      const outcome = await emailReminder(user.id, user.email!, items, nudges, now)
      if (outcome === 'sent') {
        delivered = true
        result.emailed++
      } else if (outcome === 'retry') retry = true
    }
    if (pushDevices.length) {
      const outcome = await pushReminder(user.id, pushDevices, items, now, nudges)
      if (outcome === 'sent') {
        delivered = true
        result.pushed++
      } else if (outcome === 'retry') retry = true
    }
    if (telegramChat) {
      const sent = await sendTelegramReminders(telegramChat, user.id, items, nudges)
      if (sent > 0) {
        delivered = true
        result.telegram += sent
      } else retry = true
    }
    if (delivered) result.nudged += nudges.length
    else {
      // Hand the claims back only when a later run can succeed.
      if (retry) {
        if (claimedIds.length) await db.update(messages).set({ remindedAt: null }).where(inArray(messages.id, claimedIds))
        await releaseNudges(nudges)
      }
      result.capped++
    }
  }

  await Promise.all([pruneLimits(now), pruneNudges(now)])
  return result
}

/** One email for the user's due items and reminders, within the email caps. */
async function emailReminder(
  userId: string,
  to: string,
  items: { id: string; contactName: string; kind: string }[],
  nudges: Nudge[],
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
  const keys = [...items.map((m) => m.id), ...nudges.map((n) => `${n.contactId}:${n.key}`)].sort()
  const sent = await sendEmail('reminder', {
    ...reminderEmail(to, items, nudges),
    key: `reminder-${await emailKey(...keys)}`,
  })
  // Refused by the mailroom (over a cap, suppressed, ...): not retried in
  // this run, and only handed back when a later run can succeed.
  if (!sent.ok) return sent.retryable ? 'retry' : 'refused'
  return 'sent'
}

export function reminderEmail(to: string, items: { id: string; contactName: string; kind: string }[], nudges: NudgeLine[] = []) {
  const total = items.length + nudges.length
  const first = items[0]
  const onlyNudge = !first && nudges.length === 1 ? nudges[0]! : null
  const subject = onlyNudge
    ? nudgeTitle(onlyNudge)
    : nudges.length
      ? `${total} reminders from Tend`
      : items.length === 1
        ? `Time to send a message to ${first!.contactName}`
        : `${items.length} messages are ready to send`
  const messageLine = (m: { contactName: string; kind: string }) => `${m.kind === 'consent_request' ? 'Ask' : 'Message'} ${m.contactName}`
  const lines = [
    ...items.map((m) => `${messageLine(m)}: ${publicUrl(`/send/${m.id}`)}`),
    ...nudges.map((n) => `${nudgeTitle(n)}: ${publicUrl(n.path)}`),
  ]
  const how = [
    ...(items.length ? ['For a message: open it, copy it, send it on Signal, then tap "I sent it".'] : []),
    ...(nudges.length ? ['For a birthday, anniversary or catch-up: open it to pick something to send, or write your own.'] : []),
  ]
  const url = total > 1 ? publicUrl('/today') : first ? publicUrl(`/send/${first.id}`) : publicUrl(onlyNudge!.path)
  return {
    to,
    subject,
    text: `${subject}.\n\n${lines.join('\n')}\n\n${how.join('\n')}\n\nTurn these emails off in Settings: ${publicUrl('/settings')}`,
    html: layout({
      heading: subject,
      paragraphs: [...items.map(messageLine), ...nudges.map(nudgeTitle), ...how],
      button: { label: total > 1 ? 'Open Tend' : first ? 'Open the message' : 'Open in Tend', url },
      footer: `You get these because email reminders are on in Tend. Turn them off in Settings: ${publicUrl('/settings')}`,
    }),
  }
}
