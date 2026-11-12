'use server'

/**
 * Every mutation for signed-in users. Each action re-reads the session,
 * validates its input, and scopes every read and write by the user's id.
 * Form actions return { error } for the form to show, or redirect on success.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { signOut } from '@/auth'
import { db } from '@/db'
import {
  CONSENT_STATES,
  consentEvents,
  contacts,
  contactTopics,
  messages,
  SIGNAL_STATUSES,
  TRANSLATIONS,
  users,
  userSettings,
  type ConsentState,
  type MessageKind,
} from '@/db/schema'
import { getItem, LIBRARY } from '@/lib/content'
import { encrypt, randomToken } from '@/lib/crypto'
import { buildBody, MAX_BODY, normalizePhone } from '@/lib/format'
import { MAX_CONTACTS, MAX_OPEN_MESSAGES } from '@/lib/limits'
import {
  dateFromFields,
  DEFAULT_LEAD_DAYS,
  LEAD_DAY_CHOICES,
  lastInTouchFromInput,
  lastInTouchInput,
  localToday,
  MAX_CADENCE_DAYS,
} from '@/lib/occasions'
import { checkTime, nextGoodTime, REFUSAL_TEXT, type ContactRules } from '@/lib/schedule'
import {
  contactHistory,
  contactMessages,
  countContacts,
  countScheduled,
  getContact,
  getMessage,
  openConsentRequests,
} from '@/lib/server/data'
import { moveScheduled, recordSent, skipScheduled } from '@/lib/server/messages'
import { pushConfigured, pushTest, removeOtherSubscriptions, removeSubscription, saveSubscription, userSubscriptions } from '@/lib/server/push'
import { createLinkUrl, ensureTelegramWebhook, telegramConfigured, unlinkTelegram } from '@/lib/server/telegram'
import { getSettings, requireUser } from '@/lib/server/session'
import { allowedEndpoint, deviceLabel } from '@/lib/push'
import { fromLocalInput, isValidTimeZone, parseMinutes } from '@/lib/time'
import { surprise } from '@/lib/suggest'
import { isTopic, MAX_TOPICS_PER_CONTACT } from '@/lib/topics'
import { publicUrl } from '@/lib/url'

export type FormState = { error?: string } | undefined


/* Contacts ------------------------------------------------------------------ */

const contactSchema = z.object({
  name: z.string().trim().min(1, 'Add a name.').max(80, 'Keep the name under 80 characters.'),
  phone: z.string().trim().max(32).optional().default(''),
  timezone: z.string().refine(isValidTimeZone, 'Choose a time zone.'),
  signalStatus: z.enum(SIGNAL_STATUSES),
  consent: z.enum(['not_asked', 'asked', 'yes']).optional(),
  minDaysBetween: z.coerce.number().int().min(1).max(90),
  maxPer30Days: z.coerce.number().int().min(1).max(10),
  windowStart: z.string(),
  windowEnd: z.string(),
  notes: z.string().max(1000, 'Keep notes under 1,000 characters.').optional().default(''),
  translation: z.union([z.enum(TRANSLATIONS), z.literal('')]).optional().default(''),
})

function parseContactForm(form: FormData) {
  const parsed = contactSchema.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' } as const
  const v = parsed.data
  const phone = v.phone ? normalizePhone(v.phone) : null
  if (v.phone && !phone) return { error: 'Enter the phone number with its country code, like +1 555 123 4567.' } as const
  const windowStart = parseMinutes(v.windowStart)
  const windowEnd = parseMinutes(v.windowEnd)
  if (windowStart === null || windowEnd === null) return { error: 'Choose a start and end time.' } as const
  if (windowEnd - windowStart < 60) return { error: 'The contact window must be at least an hour long.' } as const
  const days = form.getAll('days').map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  const allowedDays = days.reduce((mask, d) => mask | (1 << d), 0)
  if (!allowedDays) return { error: 'Pick at least one day.' } as const
  const topics = [...new Set(form.getAll('topics').map(String).filter(isTopic))]
  if (topics.length > MAX_TOPICS_PER_CONTACT) return { error: `Pick up to ${MAX_TOPICS_PER_CONTACT} topics.` } as const
  const occasions = parseOccasionFields(form, v.timezone)
  if ('error' in occasions) return { error: occasions.error } as const
  return { value: { ...v, phone, windowStart, windowEnd, allowedDays, topics, translation: v.translation || null, ...occasions.value } } as const
}

/** Birthday, anniversary, how far ahead to remind, and the keep-in-touch cadence. */
function parseOccasionFields(form: FormData, timezone: string) {
  const now = Date.now()
  // The date in the zone that reaches it first, so a baby born today anywhere is allowed.
  const today = localToday(now, 'Pacific/Kiritimati')
  const field = (name: string) => form.get(name) ?? undefined
  const birthday = dateFromFields('birthday', { month: field('birthdayMonth'), day: field('birthdayDay'), year: field('birthdayYear') }, today)
  if ('error' in birthday) return birthday
  const anniversary = dateFromFields('anniversary', { month: field('anniversaryMonth'), day: field('anniversaryDay'), year: field('anniversaryYear') }, today)
  if ('error' in anniversary) return anniversary
  const lead = Number(form.get('occasionLeadDays') ?? DEFAULT_LEAD_DAYS)
  if (!(LEAD_DAY_CHOICES as readonly number[]).includes(lead)) return { error: 'Choose when to be reminded.' }
  const choice = String(form.get('cadence') ?? '')
  const cadenceDays = choice === '' ? null : Number(choice === 'custom' ? form.get('cadenceCustom') : choice)
  if (cadenceDays !== null && !(Number.isInteger(cadenceDays) && cadenceDays >= 1 && cadenceDays <= MAX_CADENCE_DAYS)) {
    return { error: `Keep in touch every 1 to ${MAX_CADENCE_DAYS} days.` }
  }
  const lastInTouch = lastInTouchFromInput(form.get('lastInTouch'), timezone, localToday(now, timezone), now)
  if ('error' in lastInTouch) return lastInTouch
  return { value: { birthday: birthday.value, anniversary: anniversary.value, occasionLeadDays: lead, cadenceDays, lastInTouch } }
}

export async function createContact(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const parsed = parseContactForm(form)
  if ('error' in parsed) return { error: parsed.error }
  if ((await countContacts(user.id)) >= MAX_CONTACTS) return { error: `You can keep up to ${MAX_CONTACTS} people.` }
  const v = parsed.value
  const now = Date.now()
  const id = crypto.randomUUID()
  const consent = v.consent ?? 'not_asked'
  await db.insert(contacts).values({
    id,
    userId: user.id,
    name: v.name,
    phoneEnc: await encrypt(v.phone),
    notesEnc: await encrypt(v.notes.trim() || null),
    timezone: v.timezone,
    signalStatus: v.signalStatus,
    consent,
    consentUpdatedAt: now,
    minDaysBetween: v.minDaysBetween,
    maxPer30Days: v.maxPer30Days,
    windowStart: v.windowStart,
    windowEnd: v.windowEnd,
    allowedDays: v.allowedDays,
    translation: v.translation,
    birthday: v.birthday,
    anniversary: v.anniversary,
    occasionLeadDays: v.occasionLeadDays,
    cadenceDays: v.cadenceDays,
    lastInTouchAt: v.lastInTouch.value,
    stopToken: randomToken(),
    createdAt: now,
    updatedAt: now,
  })
  if (v.topics.length) await db.insert(contactTopics).values(v.topics.map((topic) => ({ contactId: id, topic, weight: 2 })))
  if (consent !== 'not_asked') {
    await db.insert(consentEvents).values({ userId: user.id, contactId: id, from: 'not_asked', to: consent, by: 'you', at: now })
  }
  redirect(`/people/${id}`)
}

export async function updateContact(contactId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const existing = await getContact(user.id, contactId)
  if (!existing) return { error: 'That person is no longer in your list.' }
  const parsed = parseContactForm(form)
  if ('error' in parsed) return { error: parsed.error }
  const v = parsed.value
  await db
    .update(contacts)
    .set({
      name: v.name,
      phoneEnc: await encrypt(v.phone),
      notesEnc: await encrypt(v.notes.trim() || null),
      timezone: v.timezone,
      signalStatus: v.signalStatus,
      minDaysBetween: v.minDaysBetween,
      maxPer30Days: v.maxPer30Days,
      windowStart: v.windowStart,
      windowEnd: v.windowEnd,
      allowedDays: v.allowedDays,
      translation: v.translation,
      birthday: v.birthday,
      anniversary: v.anniversary,
      occasionLeadDays: v.occasionLeadDays,
      cadenceDays: v.cadenceDays,
      // The same day as before keeps the exact moment ("We were in touch today" at 15:00).
      lastInTouchAt: v.lastInTouch.date === lastInTouchInput(existing) ? existing.lastInTouchAt : v.lastInTouch.value,
      updatedAt: Date.now(),
    })
    .where(and(eq(contacts.id, contactId), eq(contacts.userId, user.id)))
  await db.delete(contactTopics).where(eq(contactTopics.contactId, contactId))
  if (v.topics.length) {
    await db.insert(contactTopics).values(v.topics.map((topic) => ({ contactId, topic, weight: 2 })))
  }
  redirect(`/people/${contactId}`)
}

/** "We were in touch today": a call, a visit or a message outside Tend counts too, and moves the next keep-in-touch date. */
export async function markInTouch(contactId: string): Promise<void> {
  const user = await requireUser()
  const now = Date.now()
  await db
    .update(contacts)
    .set({ lastInTouchAt: now, updatedAt: now })
    .where(and(eq(contacts.id, contactId), eq(contacts.userId, user.id)))
  revalidatePath('/today')
  redirect(`/people/${contactId}?done=in-touch`)
}

export async function deleteContact(contactId: string): Promise<void> {
  const user = await requireUser()
  await db.delete(contacts).where(and(eq(contacts.id, contactId), eq(contacts.userId, user.id)))
  revalidatePath('/people')
  redirect('/people?done=deleted')
}

/* Consent ------------------------------------------------------------------- */

/** Which changes the sender may make from each state (the recipient can only stop, on /stop). */
const SENDER_TRANSITIONS: Record<ConsentState, ConsentState[]> = {
  not_asked: ['asked', 'yes', 'no', 'stopped'],
  asked: ['yes', 'no', 'stopped', 'not_asked'],
  yes: ['stopped', 'no'],
  no: ['yes', 'asked'],
  stopped: ['yes'],
}

async function cancelScheduled(userId: string, contactId: string, kinds?: MessageKind[]) {
  await db
    .update(messages)
    .set({ status: 'canceled', updatedAt: Date.now() })
    .where(
      and(
        eq(messages.userId, userId),
        eq(messages.contactId, contactId),
        eq(messages.status, 'scheduled'),
        kinds ? inArray(messages.kind, kinds) : undefined,
      ),
    )
}

export async function setConsent(contactId: string, form: FormData): Promise<void> {
  const user = await requireUser()
  const to = z.enum(CONSENT_STATES).parse(form.get('to'))
  const contact = await getContact(user.id, contactId)
  if (!contact) redirect('/people')
  if (!SENDER_TRANSITIONS[contact.consent].includes(to)) redirect(`/people/${contactId}?error=consent`)
  // Undoing a stop needs the sender to confirm the person asked for it.
  if (contact.consent === 'stopped' && form.get('confirm') !== 'yes') redirect(`/people/${contactId}?error=confirm`)
  const now = Date.now()
  await db
    .update(contacts)
    .set({ consent: to, consentUpdatedAt: now, stoppedByRecipient: false, updatedAt: now })
    .where(and(eq(contacts.id, contactId), eq(contacts.userId, user.id)))
  await db.insert(consentEvents).values({ userId: user.id, contactId, from: contact.consent, to, by: 'you', at: now })
  if (to === 'no' || to === 'stopped') await cancelScheduled(user.id, contactId)
  if (to === 'yes') await cancelScheduled(user.id, contactId, ['consent_request'])
  revalidatePath(`/people/${contactId}`)
  redirect(`/people/${contactId}`)
}

/* Messages ------------------------------------------------------------------ */

const composeSchema = z.object({
  contactId: z.string().min(1),
  kind: z.enum(['content', 'consent_request', 'personal']),
  contentId: z.string().optional(),
  translation: z.enum(TRANSLATIONS).optional(),
  note: z.string().max(MAX_BODY).optional().default(''),
  question: z.string().max(300).optional().default(''),
  readingLink: z.string().optional(),
  stopLink: z.string().optional(),
  when: z.enum(['next', 'now', 'custom']),
  at: z.string().optional().default(''),
  nextAt: z.coerce.number().int().positive().optional(),
})

function rulesOf(contact: ContactRules): ContactRules {
  const { timezone, consent, minDaysBetween, maxPer30Days, windowStart, windowEnd, allowedDays } = contact
  return { timezone, consent, minDaysBetween, maxPer30Days, windowStart, windowEnd, allowedDays }
}

export async function scheduleMessage(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const parsed = composeSchema.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Check the message and try again.' }
  const v = parsed.data
  const [contact, settings] = await Promise.all([getContact(user.id, v.contactId), getSettings(user.id)])
  if (!contact) return { error: 'That person is no longer in your list.' }
  if ((await countScheduled(user.id)) >= MAX_OPEN_MESSAGES) {
    return { error: `You can have up to ${MAX_OPEN_MESSAGES} messages waiting. Send or skip some first.` }
  }

  const item = v.kind === 'content' ? getItem(v.contentId) : undefined
  if (v.kind === 'content' && !item) return { error: 'Choose something from the library.' }
  if (v.kind !== 'content' && !v.note.trim()) return { error: 'Write the message first.' }
  const translation = v.translation ?? contact.translation ?? settings.translation
  const stopUrl = v.stopLink === 'on' ? publicUrl(`/stop/${contact.stopToken}`) : undefined
  const body = buildBody({
    note: v.note,
    item,
    translation,
    question: v.kind === 'content' ? v.question : undefined,
    readingLink: v.readingLink === 'on',
    stopUrl,
  })
  if (body.length > MAX_BODY) return { error: `Keep the message under ${MAX_BODY} characters.` }

  const now = Date.now()
  const rules = rulesOf(contact)
  const history = await contactHistory(user.id, contact.id)
  const openRequests = await openConsentRequests(user.id, contact.id)
  let at: number | null
  if (v.when === 'now') at = now
  else if (v.when === 'custom') at = fromLocalInput(v.at, contact.timezone)
  // The compose page shows the next good time it computed; keep that exact
  // time if it still passes the rules, so what was shown is what is booked.
  else at = v.nextAt && v.nextAt > now ? v.nextAt : nextGoodTime(rules, history, now, Math.random, v.kind)
  if (at === null) return { error: v.when === 'custom' ? 'Choose a date and time.' : REFUSAL_TEXT.no_time }

  const refusal = checkTime(rules, v.kind, history, at, now, { paused: Boolean(settings.pausedAt), openRequests })
  if (refusal) return { error: REFUSAL_TEXT[refusal] }

  const id = crypto.randomUUID()
  await db.insert(messages).values({
    id,
    userId: user.id,
    contactId: contact.id,
    kind: v.kind,
    contentId: item?.id ?? null,
    body,
    status: 'scheduled',
    scheduledFor: at,
    createdAt: now,
    updatedAt: now,
  })
  revalidatePath('/today')
  redirect(v.when === 'now' ? `/send/${id}` : `/people/${contact.id}?done=scheduled`)
}

/**
 * "Surprise me": a random passage or quote for this person, from the whole
 * library, never one sent to them in the last 180 days or already scheduled.
 * Opens it in compose, where they can send it or ask for another.
 */
export async function surpriseMe(contactId: string, form: FormData): Promise<void> {
  const user = await requireUser()
  const contact = await getContact(user.id, contactId)
  if (!contact) redirect('/people')
  if (contact.consent !== 'yes') redirect(`/people/${contact.id}`)
  const history = await contactMessages(user.id, contact.id)
  const avoid = form.get('avoid')
  const pick = surprise(
    LIBRARY,
    history.map((m) => ({ contentId: m.contentId, at: m.sentAt ?? m.scheduledFor, status: m.status })),
    Date.now(),
    { avoid: typeof avoid === 'string' ? avoid : undefined },
  )
  if (!pick) redirect(`/people/${contact.id}?error=surprise`)
  redirect(`/compose?contact=${contact.id}&content=${pick.id}&surprise=1`)
}

export async function markSent(messageId: string): Promise<void> {
  const user = await requireUser()
  const result = await recordSent(user.id, messageId)
  if (!result.ok) {
    if (result.reason === 'consent' || result.reason === 'helper_sending') redirect(`/send/${messageId}?error=${result.reason}`)
    redirect(result.reason === 'not_found' ? '/today' : `/send/${messageId}`)
  }
  revalidatePath('/today')
  redirect(`/people/${result.contactId}?done=sent`)
}

export async function skipMessage(messageId: string): Promise<void> {
  const user = await requireUser()
  const message = await getMessage(user.id, messageId)
  if (!message) redirect('/today')
  if (!(await skipScheduled(user.id, messageId)) && message.sendState === 'sending') redirect(`/send/${messageId}?error=helper_sending`)
  revalidatePath('/today')
  redirect(`/people/${message.contactId}?done=skipped`)
}

export async function rescheduleMessage(messageId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const message = await getMessage(user.id, messageId)
  if (!message || message.status !== 'scheduled') return { error: 'That message is no longer waiting.' }
  const [contact, settings] = await Promise.all([getContact(user.id, message.contactId), getSettings(user.id)])
  if (!contact) return { error: 'That person is no longer in your list.' }
  const now = Date.now()
  const rules = rulesOf(contact)
  const history = await contactHistory(user.id, contact.id, messageId)
  const openRequests = await openConsentRequests(user.id, contact.id, messageId)
  const when = form.get('when')
  const at =
    when === 'custom'
      ? fromLocalInput(String(form.get('at') ?? ''), contact.timezone)
      : nextGoodTime(rules, history, now, Math.random, message.kind)
  if (at === null) return { error: when === 'custom' ? 'Choose a date and time.' : REFUSAL_TEXT.no_time }
  const refusal = checkTime(rules, message.kind, history, at, now, { paused: Boolean(settings.pausedAt), openRequests })
  if (refusal) return { error: REFUSAL_TEXT[refusal] }
  if (!(await moveScheduled(user.id, messageId, at, now))) return { error: 'Your Signal helper is sending this message right now.' }
  revalidatePath('/today')
  redirect(`/people/${contact.id}?done=rescheduled`)
}

/* Settings ------------------------------------------------------------------ */

const settingsSchema = z.object({
  timezone: z.string().refine(isValidTimeZone),
  translation: z.enum(TRANSLATIONS),
  emailReminders: z.string().optional(),
})

export async function updateSettings(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  await getSettings(user.id)
  const parsed = settingsSchema.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Check your settings and try again.' }
  await db
    .update(userSettings)
    .set({
      timezone: parsed.data.timezone,
      translation: parsed.data.translation,
      emailReminders: parsed.data.emailReminders === 'on',
    })
    .where(eq(userSettings.userId, user.id))
  revalidatePath('/settings')
  redirect('/settings?done=saved')
}

/* Telegram ------------------------------------------------------------------ */

/** Opens the bot with a fresh one-time code; the bot links the chat when you press Start. */
export async function connectTelegram(): Promise<void> {
  const user = await requireUser()
  await getSettings(user.id)
  // Makes sure the webhook is registered before anyone presses Start.
  const ready = telegramConfigured() && (await ensureTelegramWebhook()) !== 'failed'
  const url = ready ? await createLinkUrl(user.id) : null
  redirect(url ?? '/settings?error=telegram')
}

export async function disconnectTelegram(): Promise<void> {
  const user = await requireUser()
  await unlinkTelegram(user.id)
  revalidatePath('/settings')
  redirect('/settings?done=telegram-off')
}

export async function setTelegramReminders(form: FormData): Promise<void> {
  const user = await requireUser()
  await db
    .update(userSettings)
    .set({ telegramReminders: form.get('telegramReminders') === 'on' })
    .where(eq(userSettings.userId, user.id))
  revalidatePath('/settings')
  redirect('/settings?done=saved')
}

/* Phone notifications ------------------------------------------------------ */

export type PushState = { ok: boolean; error?: string }

const subscriptionSchema = z.object({
  endpoint: z.string().max(1024),
  keys: z.object({
    // The browser's P-256 public key (65 bytes) and auth secret (16 bytes), base64url.
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
})

/** Saves this device's push subscription (PushSubscription.toJSON()) for the signed-in user. */
export async function savePushSubscription(input: unknown): Promise<PushState> {
  const user = await requireUser()
  if (!pushConfigured()) return { ok: false, error: 'Phone notifications are not available just now.' }
  const parsed = subscriptionSchema.safeParse(input)
  if (!parsed.success || !allowedEndpoint(parsed.data.endpoint)) return { ok: false, error: 'This browser’s notifications are not supported.' }
  const device = deviceLabel((await headers()).get('user-agent') ?? '')
  await saveSubscription(user.id, { endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, device })
  revalidatePath('/settings')
  return { ok: true }
}

export async function removePushSubscription(endpoint: unknown): Promise<PushState> {
  const user = await requireUser()
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return { ok: false }
  await removeSubscription(user.id, endpoint)
  revalidatePath('/settings')
  return { ok: true }
}

/** Turns phone notifications off on the user's other devices: all but `keep`, this one, if given. */
export async function removeOtherPushSubscriptions(keep: unknown): Promise<PushState> {
  const user = await requireUser()
  await removeOtherSubscriptions(user.id, typeof keep === 'string' && keep ? keep : undefined)
  revalidatePath('/settings')
  return { ok: true }
}

export async function sendTestPush(): Promise<PushState> {
  const user = await requireUser()
  const outcome = await pushTest(user.id, await userSubscriptions(user.id))
  if (outcome === 'sent') return { ok: true }
  return {
    ok: false,
    error: outcome === 'retry' ? 'That is enough tests for today. Try again tomorrow.' : 'The notification could not be delivered. Turn notifications off, then on again.',
  }
}

export async function setPaused(form: FormData): Promise<void> {
  const user = await requireUser()
  await getSettings(user.id)
  const paused = form.get('paused') === 'yes'
  await db
    .update(userSettings)
    .set({ pausedAt: paused ? Date.now() : null })
    .where(eq(userSettings.userId, user.id))
  revalidatePath('/', 'layout')
  redirect(String(form.get('back') ?? '/settings').startsWith('/') ? String(form.get('back')) : '/settings')
}

export async function deleteAccount(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  if (String(form.get('confirm') ?? '').trim().toUpperCase() !== 'DELETE') return { error: 'Type DELETE to confirm.' }
  // Every table cascades from the user row: settings, contacts, topics,
  // messages, consent events, accounts and sessions.
  await db.delete(users).where(eq(users.id, user.id))
  await signOut({ redirectTo: '/?done=deleted' })
  return undefined
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/' })
}
