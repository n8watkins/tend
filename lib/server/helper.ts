import 'server-only'

/**
 * The Signal helper on Tend's side (docs/SIGNAL-HELPER.md, phase 1: approve
 * first, by phone notification). Tend never talks to Signal: a small program
 * on the user's own PC (helper/) polls these functions through
 * /api/helper/*, and sends only what the user approved.
 *
 * - Pairing: a one-time code from Settings becomes a device token, kept here
 *   only as its SHA-256. One helper per account; removing it revokes the token.
 * - Approvals: the reminder run asks the user with a push (Send, Skip); an
 *   approval binds to the exact text by its hash.
 * - Claims: every rule is checked again, then one conditional UPDATE leases
 *   the message to one claim. Results are accepted once per claim.
 * - At most once: a lease that runs out is "unknown", never retried; an
 *   approval nobody claims by sendBy goes back to the manual path.
 * - Private for now: only accounts listed in SIGNAL_HELPER_USERS see or use it.
 * - Logs and helper_event rows carry ids and reason codes only.
 */

import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm'

import { db } from '@/db'
import { contacts, helperDevices, helperEvents, helperPairCodes, messages, userSettings, users, type HelperDevice, type Message } from '@/db/schema'
import { decrypt } from '@/lib/crypto'
import type { HelperEventKind } from '@/lib/enums'
import {
  bearerDeviceToken,
  bodyHash,
  claimRefusal,
  clampDaily,
  clampGap,
  failureReason,
  HELPER_LIMITS,
  helperAllowed,
  helperOnline,
  newDeviceToken,
  newPairCode,
  normalizePairCode,
  sendByFor,
  sha256,
  signApproval,
  TRANSITIONS,
  verifyApproval,
  WAIT_REFUSALS,
  type ClaimRefusal,
  type FailureReason,
  type HelperAction,
} from '@/lib/helper'
import { APPROVAL_ACTIONS_PER_IP_HOURLY, HELPER_PAIR_PER_IP_HOURLY, HELPER_PUSH_PER_USER_DAILY, HELPER_PUSH_SITE_DAILY } from '@/lib/limits'
import { approvalPush, helperNoticePush, type PushPayload } from '@/lib/push'
import { contactHistory } from '@/lib/server/data'
import { readLimit, spend, spent } from '@/lib/server/limits'
import { pushToUser, subscriptionsFor, type Subscription } from '@/lib/server/push'
import { DAY } from '@/lib/time'

/* Configuration -------------------------------------------------------------- */

export function helperAllowedFor(email: string | null | undefined): boolean {
  return helperAllowed(email, process.env.SIGNAL_HELPER_USERS)
}

function dailyCap(): number {
  return clampDaily(readLimit('HELPER_DAILY_CAP', HELPER_LIMITS.dailyCap))
}

function gapMs(): number {
  return clampGap(readLimit('HELPER_GAP_MINUTES', HELPER_LIMITS.gapMs / 60_000) * 60_000)
}

function siteCap(): number {
  return readLimit('HELPER_SITE_DAILY', HELPER_LIMITS.siteDaily)
}

function approvalSecret(): string | null {
  return process.env.AUTH_SECRET || null
}

/** Allowed state pairs for an action, as SQL conditions (lib/helper.ts TRANSITIONS is the one source). */
function from(action: HelperAction) {
  const rule = TRANSITIONS[action]
  return and(rule.from.approval ? inArray(messages.approvalState, [...rule.from.approval]) : undefined, inArray(messages.sendState, [...rule.from.send]))
}

/** Logs a helper step: ids and reason codes only (never names, numbers or text). */
async function logEvent(userId: string, kind: HelperEventKind, messageId: string | null, reason: string | null, now: number) {
  await db.insert(helperEvents).values({ userId, kind, messageId, reason, at: now })
  console.log(JSON.stringify({ event: 'helper', kind, messageId, reason }))
}

/* Pushes ----------------------------------------------------------------------- */

async function helperPush(userId: string, payload: PushPayload, now: number, subscriptions?: Subscription[]): Promise<boolean> {
  const subs = subscriptions ?? (await subscriptionsFor([userId])).get(userId) ?? []
  if (!subs.length) return false
  const outcome = await pushToUser(
    userId,
    subs,
    payload,
    [
      { key: `push:helper:user:${userId}`, limit: readLimit('HELPER_PUSH_PER_USER_DAILY', HELPER_PUSH_PER_USER_DAILY) },
      { key: 'push:helper:site', limit: readLimit('HELPER_PUSH_SITE_DAILY', HELPER_PUSH_SITE_DAILY) },
    ],
    now,
  ).catch(() => 'refused' as const)
  return outcome === 'sent'
}

async function contactNameFor(userId: string, contactId: string): Promise<string> {
  const [row] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.userId, userId)))
  return row?.name ?? 'them'
}

async function notice(userId: string, kind: Parameters<typeof helperNoticePush>[0], message: Pick<Message, 'id' | 'contactId'> | null, now: number) {
  const item = message ? { id: message.id, contactName: await contactNameFor(userId, message.contactId) } : null
  await helperPush(userId, helperNoticePush(kind, item), now)
}

/* The user's helper -------------------------------------------------------------- */

export interface HelperAccess {
  allowed: boolean
  enabled: boolean
  device: HelperDevice | null
}

/** Whether this user may use the helper, has turned it on, and their current (unrevoked) device. */
export async function helperAccess(userId: string): Promise<HelperAccess> {
  const [row] = await db
    .select({ email: users.email, enabled: userSettings.helperEnabled })
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(eq(users.id, userId))
  const allowed = helperAllowedFor(row?.email)
  if (!allowed) return { allowed: false, enabled: false, device: null }
  const enabled = Boolean(row?.enabled)
  const [device] = enabled
    ? await db
        .select()
        .from(helperDevices)
        .where(and(eq(helperDevices.userId, userId), isNull(helperDevices.revokedAt)))
        .orderBy(desc(helperDevices.createdAt))
        .limit(1)
    : []
  return { allowed, enabled, device: device ?? null }
}

/** A helper that can send for this user right now: allowed, on, and paired. */
export async function activeHelper(userId: string): Promise<HelperDevice | null> {
  const access = await helperAccess(userId)
  return access.allowed && access.enabled ? access.device : null
}

export async function enableHelper(userId: string, now = Date.now()): Promise<boolean> {
  const access = await helperAccess(userId)
  if (!access.allowed) return false
  await db.update(userSettings).set({ helperEnabled: true, helperAckAt: now }).where(eq(userSettings.userId, userId))
  return true
}

/** Revokes the device token at once; approvals not yet claimed lapse to the manual path. */
export async function removeHelper(userId: string, now = Date.now()): Promise<void> {
  const revoked = await db
    .update(helperDevices)
    .set({ revokedAt: now })
    .where(and(eq(helperDevices.userId, userId), isNull(helperDevices.revokedAt)))
    .returning({ id: helperDevices.id })
  await db.delete(helperPairCodes).where(eq(helperPairCodes.userId, userId))
  await db
    .update(messages)
    .set({ approvalState: 'expired', sendBy: null, updatedAt: now })
    .where(and(eq(messages.userId, userId), from('withdraw')))
  if (revoked.length) await logEvent(userId, 'removed', null, null, now)
}

export async function disableHelper(userId: string, now = Date.now()): Promise<void> {
  await removeHelper(userId, now)
  await db.update(userSettings).set({ helperEnabled: false }).where(eq(userSettings.userId, userId))
}

/** After a captcha (or a relink): the user says sending may start again. */
export async function resumeHelper(userId: string, now = Date.now()): Promise<boolean> {
  const resumed = await db
    .update(helperDevices)
    .set({ haltedAt: null, haltReason: null })
    .where(and(eq(helperDevices.userId, userId), isNull(helperDevices.revokedAt), isNotNull(helperDevices.haltedAt)))
    .returning({ id: helperDevices.id })
  if (resumed.length) await logEvent(userId, 'resumed', null, null, now)
  return resumed.length > 0
}

/** Helper sends claimed in the last 24 hours, for this user or (null) everyone. */
async function sendsSince(userId: string | null, since: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(messages)
    .where(and(userId ? eq(messages.userId, userId) : undefined, gt(messages.claimedAt, since)))
  return Number(row?.n ?? 0)
}

export interface HelperStatus {
  allowed: boolean
  enabled: boolean
  ackAt: number | null
  device: {
    name: string
    createdAt: number
    lastSeenAt: number | null
    online: boolean
    helperVersion: string | null
    signalCliVersion: string | null
    haltedAt: number | null
    haltReason: string | null
  } | null
  sentToday: number
  dailyCap: number
}

export async function helperStatus(userId: string, now = Date.now()): Promise<HelperStatus> {
  const access = await helperAccess(userId)
  const [settings] = await db.select({ ackAt: userSettings.helperAckAt }).from(userSettings).where(eq(userSettings.userId, userId))
  const d = access.device
  return {
    allowed: access.allowed,
    enabled: access.enabled,
    ackAt: settings?.ackAt ?? null,
    device: d
      ? {
          name: d.name,
          createdAt: d.createdAt,
          lastSeenAt: d.lastSeenAt,
          online: helperOnline(d.lastSeenAt, now),
          helperVersion: d.helperVersion,
          signalCliVersion: d.signalCliVersion,
          haltedAt: d.haltedAt,
          haltReason: d.haltReason,
        }
      : null,
    sentToday: access.allowed ? await sendsSince(userId, now - DAY) : 0,
    dailyCap: dailyCap(),
  }
}

/* Pairing ------------------------------------------------------------------------- */

const pairHash = (code: string) => sha256(`tend-pair-v1:${code}`)

/** A fresh one-time code (earlier unused codes stop working). Null when the user may not pair. */
export async function createPairCode(userId: string, now = Date.now()): Promise<{ code: string; expiresAt: number } | null> {
  const access = await helperAccess(userId)
  if (!access.allowed || !access.enabled) return null
  const code = newPairCode()
  const expiresAt = now + HELPER_LIMITS.pairCodeTtlMs
  await db.delete(helperPairCodes).where(eq(helperPairCodes.userId, userId))
  await db.insert(helperPairCodes).values({ codeHash: await pairHash(code), userId, expiresAt })
  return { code, expiresAt }
}

export type PairResult = { ok: true; token: string } | { ok: false; status: 400 | 401 | 429 }

/**
 * `tend-helper pair <code>`: spends the code (once, before it expires) and
 * returns a new device token, shown once. Any earlier helper is revoked.
 */
export async function pairHelper(
  input: { code: string; name: string; helperVersion?: string | null },
  ipKey: string,
  now = Date.now(),
): Promise<PairResult> {
  if (!(await spend([{ key: `helper:pair:ip:${ipKey}`, limit: HELPER_PAIR_PER_IP_HOURLY, hourly: true }], now).catch(() => false))) {
    return { ok: false, status: 429 }
  }
  const code = normalizePairCode(input.code)
  if (!code) return { ok: false, status: 400 }
  const [row] = await db
    .delete(helperPairCodes)
    .where(and(eq(helperPairCodes.codeHash, await pairHash(code)), gt(helperPairCodes.expiresAt, now)))
    .returning({ userId: helperPairCodes.userId })
  await db.delete(helperPairCodes).where(lt(helperPairCodes.expiresAt, now))
  if (!row) return { ok: false, status: 401 }
  const access = await helperAccess(row.userId)
  if (!access.allowed || !access.enabled) return { ok: false, status: 401 }

  await db
    .update(helperDevices)
    .set({ revokedAt: now })
    .where(and(eq(helperDevices.userId, row.userId), isNull(helperDevices.revokedAt)))
  const token = newDeviceToken()
  await db.insert(helperDevices).values({
    userId: row.userId,
    tokenHash: await sha256(token),
    name: input.name.slice(0, 60) || 'Tend helper',
    createdAt: now,
    helperVersion: input.helperVersion?.slice(0, 20) ?? null,
  })
  await logEvent(row.userId, 'paired', null, null, now)
  return { ok: true, token }
}

/* Device token authentication ------------------------------------------------------- */

export type HelperAuth = { ok: true; userId: string; device: HelperDevice } | { ok: false; status: 401 | 429 }

/**
 * Authenticates a helper route. Only `Authorization: Bearer tdh_...` is
 * accepted (never a session cookie), the device must not be revoked, and its
 * user must still be allowed and have the helper on. Each token has an
 * hourly budget, and addresses that keep failing are refused outright.
 */
export async function authenticateHelper(authorization: string | null, ipKey: string, now = Date.now()): Promise<HelperAuth> {
  const badRule = { key: `helper:401:ip:${ipKey}`, limit: HELPER_LIMITS.badTokensPerHour, hourly: true }
  if ((await spent(badRule, now).catch(() => Infinity)) >= badRule.limit) return { ok: false, status: 429 }
  const token = bearerDeviceToken(authorization)
  const [device] = token
    ? await db
        .select()
        .from(helperDevices)
        .where(and(eq(helperDevices.tokenHash, await sha256(token)), isNull(helperDevices.revokedAt)))
    : []
  const access = device ? await helperAccess(device.userId) : null
  if (!device || !access?.allowed || !access.enabled || access.device?.id !== device.id) {
    await spend([badRule], now).catch(() => false)
    return { ok: false, status: 401 }
  }
  if (!(await spend([{ key: `helper:calls:${device.id}`, limit: HELPER_LIMITS.callsPerHour, hourly: true }], now).catch(() => false))) {
    return { ok: false, status: 429 }
  }
  return { ok: true, userId: device.userId, device }
}

/* Jobs (the poll and heartbeat) ------------------------------------------------------- */

export interface JobsResponse {
  serverTime: number
  minHelperVersion: string
  pollSeconds: number
  /** Tend is paused, or sending is halted (a captcha): claim nothing. */
  paused: boolean
  halted: string | null
  caps: { dailyCap: number; dailyMax: number; usedToday: number; gapMs: number; nextClaimAt: number }
  /** Approved messages in their send window. Ids and times only: the number and text come with a claim. */
  jobs: { id: string; approvedAt: number; sendBy: number }[]
}

export async function helperJobs(
  auth: Extract<HelperAuth, { ok: true }>,
  meta: { helperVersion: string | null; signalCliVersion: string | null },
  now = Date.now(),
): Promise<JobsResponse> {
  await db
    .update(helperDevices)
    .set({
      lastSeenAt: now,
      ...(meta.helperVersion ? { helperVersion: meta.helperVersion.slice(0, 20) } : {}),
      ...(meta.signalCliVersion ? { signalCliVersion: meta.signalCliVersion.slice(0, 20) } : {}),
    })
    .where(eq(helperDevices.id, auth.device.id))
  const [settings] = await db.select({ pausedAt: userSettings.pausedAt }).from(userSettings).where(eq(userSettings.userId, auth.userId))
  const jobs = await db
    .select({ id: messages.id, approvedAt: messages.approvedAt, sendBy: messages.sendBy })
    .from(messages)
    .where(
      and(
        eq(messages.userId, auth.userId),
        eq(messages.status, 'scheduled'),
        eq(messages.approvalState, 'approved'),
        eq(messages.sendState, 'idle'),
        gte(messages.sendBy, now),
      ),
    )
    .orderBy(asc(messages.approvedAt))
    .limit(10)
  const gap = gapMs()
  return {
    serverTime: now,
    minHelperVersion: HELPER_LIMITS.minHelperVersion,
    pollSeconds: HELPER_LIMITS.pollSeconds,
    paused: Boolean(settings?.pausedAt),
    halted: auth.device.haltedAt ? (auth.device.haltReason ?? 'halted') : null,
    caps: {
      dailyCap: dailyCap(),
      dailyMax: HELPER_LIMITS.dailyMax,
      usedToday: await sendsSince(auth.userId, now - DAY),
      gapMs: gap,
      nextClaimAt: (auth.device.lastClaimAt ?? 0) + gap,
    },
    jobs: jobs.map((j) => ({ id: j.id, approvedAt: j.approvedAt ?? 0, sendBy: j.sendBy ?? 0 })),
  }
}

/* Claim ------------------------------------------------------------------------------- */

export type ClaimResult =
  | { ok: true; job: { id: string; claimId: string; recipient: string; body: string; bodyHash: string; leaseUntil: number; approvedAt: number; sendBy: number } }
  | { ok: false; reason: ClaimRefusal | 'not_found'; retryAt?: number }

/**
 * Re-checks every rule, then leases the message to one claim with a
 * conditional UPDATE (approved, idle, the same text, still in time, consent
 * still yes, not paused). Two claims can never both win. Only now does the
 * helper get the recipient's number and the text.
 */
export async function claimJob(auth: Extract<HelperAuth, { ok: true }>, messageId: string, now = Date.now()): Promise<ClaimResult> {
  const userId = auth.userId
  const message = await db.query.messages.findFirst({ where: and(eq(messages.id, messageId), eq(messages.userId, userId)) })
  if (!message) return { ok: false, reason: 'not_found' }
  const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.id, message.contactId), eq(contacts.userId, userId)) })
  if (!contact) return { ok: false, reason: 'not_found' }
  const [settings] = await db.select({ pausedAt: userSettings.pausedAt }).from(userSettings).where(eq(userSettings.userId, userId))
  const [device] = await db.select().from(helperDevices).where(eq(helperDevices.id, auth.device.id))
  const hash = await bodyHash(message.body)
  const gap = gapMs()
  const refusal = claimRefusal({
    now,
    message,
    currentBodyHash: hash,
    contact: { ...contact, hasPhone: Boolean(contact.phoneEnc) },
    history: await contactHistory(userId, contact.id, message.id),
    paused: Boolean(settings?.pausedAt),
    halted: Boolean(device?.haltedAt),
    sentToday: await sendsSince(userId, now - DAY),
    dailyCap: dailyCap(),
    siteToday: await sendsSince(null, now - DAY),
    siteCap: siteCap(),
    lastClaimAt: device?.lastClaimAt ?? null,
    gapMs: gap,
  })
  if (refusal) {
    if (!WAIT_REFUSALS.has(refusal) && refusal !== 'already_claimed') await logEvent(userId, 'refused', message.id, refusal, now)
    return { ok: false, reason: refusal, ...(refusal === 'gap' ? { retryAt: (device?.lastClaimAt ?? now) + gap } : {}) }
  }

  // The flood-control lock: only one claim per gap, even when two arrive at once.
  const previous = device?.lastClaimAt ?? null
  const locked = await db
    .update(helperDevices)
    .set({ lastClaimAt: now })
    .where(
      and(
        eq(helperDevices.id, auth.device.id),
        isNull(helperDevices.revokedAt),
        isNull(helperDevices.haltedAt),
        or(isNull(helperDevices.lastClaimAt), lt(helperDevices.lastClaimAt, now - gap + 1)),
      ),
    )
    .returning({ id: helperDevices.id })
  if (!locked.length) return { ok: false, reason: 'gap', retryAt: now + gap }

  const claimId = crypto.randomUUID()
  const leaseUntil = now + HELPER_LIMITS.leaseMs
  const claimed = await db
    .update(messages)
    .set({ sendState: 'sending', claimId, claimedAt: now, leaseUntil, resultAt: null, sendFailure: null, updatedAt: now })
    .where(
      and(
        eq(messages.id, message.id),
        eq(messages.userId, userId),
        eq(messages.status, 'scheduled'),
        from('claim'),
        eq(messages.body, message.body),
        eq(messages.approvedBodyHash, hash),
        gte(messages.sendBy, now),
        sql`exists (select 1 from contact c where c.id = ${contact.id} and c.consent = 'yes')`,
        sql`not exists (select 1 from user_settings s where s.userId = ${userId} and s.pausedAt is not null)`,
      ),
    )
    .returning({ id: messages.id })
  if (!claimed.length) {
    // Lost a race (another claim, a skip, a stop): hand the lock back.
    await db
      .update(helperDevices)
      .set({ lastClaimAt: previous })
      .where(and(eq(helperDevices.id, auth.device.id), eq(helperDevices.lastClaimAt, now)))
    return { ok: false, reason: 'already_claimed' }
  }
  await logEvent(userId, 'claimed', message.id, null, now)
  const recipient = (await decrypt(contact.phoneEnc))!
  return {
    ok: true,
    job: { id: message.id, claimId, recipient, body: message.body, bodyHash: hash, leaseUntil, approvedAt: message.approvedAt!, sendBy: message.sendBy! },
  }
}

/* Result -------------------------------------------------------------------------------- */

export type ResultOutcome = 'sent' | 'failed' | 'unknown'

export type ReportResult =
  | { ok: true; sendState: string; repeat: boolean }
  | { ok: false; status: 404 | 409; reason: 'not_found' | 'stale_claim' | 'not_sending' }

/**
 * The helper's report for one claim, accepted once: a repeat returns the
 * first answer and changes nothing. A late report after the lease ran out
 * still records what really happened.
 */
export async function reportResult(
  auth: Extract<HelperAuth, { ok: true }>,
  messageId: string,
  input: { claimId: string; outcome: ResultOutcome; signalTimestamp?: number | null; reason?: unknown },
  now = Date.now(),
): Promise<ReportResult> {
  const userId = auth.userId
  const message = await db.query.messages.findFirst({ where: and(eq(messages.id, messageId), eq(messages.userId, userId)) })
  if (!message) return { ok: false, status: 404, reason: 'not_found' }
  if (!message.claimId || message.claimId !== input.claimId) return { ok: false, status: 409, reason: 'stale_claim' }
  if (message.resultAt !== null) return { ok: true, sendState: message.sendState, repeat: true }

  const where = and(eq(messages.id, messageId), eq(messages.userId, userId), eq(messages.claimId, input.claimId), isNull(messages.resultAt), from(input.outcome))
  let updated: { id: string }[]
  let reason: FailureReason | null = null
  if (input.outcome === 'sent') {
    // What went out is the truth, even if the message was canceled meanwhile.
    updated = await db
      .update(messages)
      .set({
        status: 'sent',
        sentAt: now,
        sentVia: 'helper',
        sendState: 'sent',
        signalTimestamp: Number.isSafeInteger(input.signalTimestamp) ? input.signalTimestamp! : null,
        resultAt: now,
        leaseUntil: null,
        updatedAt: now,
      })
      .where(where)
      .returning({ id: messages.id })
  } else {
    reason = input.outcome === 'failed' ? failureReason(input.reason) : null
    updated = await db
      .update(messages)
      .set({ sendState: input.outcome, sendFailure: reason, resultAt: now, leaseUntil: null, updatedAt: now })
      .where(where)
      .returning({ id: messages.id })
  }
  if (!updated.length) {
    const [current] = await db.select({ sendState: messages.sendState, resultAt: messages.resultAt }).from(messages).where(eq(messages.id, messageId))
    if (current?.resultAt) return { ok: true, sendState: current.sendState, repeat: true }
    return { ok: false, status: 409, reason: 'not_sending' }
  }
  await logEvent(userId, input.outcome, messageId, reason, now)
  if (reason === 'challenge') await haltDevice(auth.device.id, userId, 'challenge', now)
  else await notice(userId, input.outcome, message, now)
  return { ok: true, sendState: input.outcome, repeat: false }
}

/* Events from the helper ------------------------------------------------------------------ */

export const HELPER_REPORTED_EVENTS = ['challenge', 'outdated', 'unlinked'] as const
export type HelperReportedEvent = (typeof HELPER_REPORTED_EVENTS)[number]

async function haltDevice(deviceId: string, userId: string, reason: string, now: number) {
  const halted = await db
    .update(helperDevices)
    .set({ haltedAt: now, haltReason: reason })
    .where(and(eq(helperDevices.id, deviceId), isNull(helperDevices.haltedAt)))
    .returning({ id: helperDevices.id })
  if (halted.length) {
    await logEvent(userId, 'challenge', null, reason, now)
    await notice(userId, 'challenge', null, now)
  }
}

/** A captcha or an unlinked account stops all sending until the user resumes in Settings. */
export async function reportEvent(auth: Extract<HelperAuth, { ok: true }>, kind: HelperReportedEvent, now = Date.now()): Promise<void> {
  if (kind === 'challenge' || kind === 'unlinked') await haltDevice(auth.device.id, auth.userId, kind, now)
  else await logEvent(auth.userId, kind, null, null, now)
}

/* Approvals: the user's side ---------------------------------------------------------------- */

export type ApprovalRefusal = 'not_found' | 'no_helper' | 'not_scheduled' | 'kind' | 'not_due' | 'consent' | 'no_phone' | 'paused' | 'window' | 'state'

export const APPROVAL_REFUSAL_TEXT: Record<ApprovalRefusal, string> = {
  not_found: 'That message is no longer here.',
  no_helper: 'Your Signal helper is not set up. Send it yourself instead.',
  not_scheduled: 'That message was already sent, skipped or canceled.',
  kind: 'Consent requests are sent by you, not the helper.',
  not_due: 'It is not due yet. You can approve it when it is time.',
  consent: 'They have not said yes to messages, so the helper will not send it.',
  no_phone: 'Add their phone number so your helper knows where to send it.',
  paused: 'Tend is paused. Resume it in Settings first.',
  window: 'It is outside their contact window just now. Send it yourself or reschedule.',
  state: 'This message is already with your helper.',
}

/**
 * Send: the helper may send this exact text, until sendBy. Only for a due
 * content or personal message to someone who said yes, inside their window.
 */
export async function approveMessage(userId: string, messageId: string, via: 'app' | 'push', now = Date.now(), action: 'approve' | 'retry' = 'approve') {
  const message = await db.query.messages.findFirst({ where: and(eq(messages.id, messageId), eq(messages.userId, userId)) })
  if (!message) return { ok: false as const, reason: 'not_found' as ApprovalRefusal }
  if (!(await activeHelper(userId))) return { ok: false as const, reason: 'no_helper' as ApprovalRefusal }
  if (message.status !== 'scheduled') return { ok: false as const, reason: 'not_scheduled' as ApprovalRefusal }
  if (message.kind === 'consent_request') return { ok: false as const, reason: 'kind' as ApprovalRefusal }
  if (message.scheduledFor > now) return { ok: false as const, reason: 'not_due' as ApprovalRefusal }
  const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.id, message.contactId), eq(contacts.userId, userId)) })
  if (!contact || contact.consent !== 'yes') return { ok: false as const, reason: 'consent' as ApprovalRefusal }
  if (!contact.phoneEnc) return { ok: false as const, reason: 'no_phone' as ApprovalRefusal }
  const [settings] = await db.select({ pausedAt: userSettings.pausedAt }).from(userSettings).where(eq(userSettings.userId, userId))
  if (settings?.pausedAt) return { ok: false as const, reason: 'paused' as ApprovalRefusal }
  const sendBy = sendByFor(contact, now)
  if (!sendBy) return { ok: false as const, reason: 'window' as ApprovalRefusal }
  const updated = await db
    .update(messages)
    .set({
      approvalState: 'approved',
      approvedBodyHash: await bodyHash(message.body),
      approvedAt: now,
      approvedVia: via,
      sendBy,
      sendState: 'idle',
      claimId: null,
      claimedAt: null,
      leaseUntil: null,
      resultAt: null,
      sendFailure: null,
      updatedAt: now,
    })
    .where(and(eq(messages.id, messageId), eq(messages.userId, userId), eq(messages.status, 'scheduled'), eq(messages.body, message.body), from(action)))
    .returning({ id: messages.id })
  if (!updated.length) return { ok: false as const, reason: 'state' as ApprovalRefusal }
  await logEvent(userId, 'approved', messageId, action === 'retry' ? 'retry' : via, now)
  return { ok: true as const, sendBy, contactName: contact.name }
}

/** Skip: nothing is sent, and it stays in their history as skipped. Refused while the helper is sending. */
export async function skipApproval(userId: string, messageId: string, now = Date.now()): Promise<{ ok: boolean; contactId?: string }> {
  const updated = await db
    .update(messages)
    .set({ status: 'skipped', approvalState: 'skipped', sendState: 'idle', sendBy: null, updatedAt: now })
    .where(and(eq(messages.id, messageId), eq(messages.userId, userId), eq(messages.status, 'scheduled'), from('skip')))
    .returning({ id: messages.id, contactId: messages.contactId })
  if (!updated.length) return { ok: false }
  await logEvent(userId, 'skipped', messageId, null, now)
  return { ok: true, contactId: updated[0]!.contactId }
}

/** "It was sent", after checking the Signal chat when the helper could not say. */
export async function confirmSent(userId: string, messageId: string, now = Date.now()): Promise<boolean> {
  const updated = await db
    .update(messages)
    .set({ status: 'sent', sentAt: sql`coalesce(${messages.claimedAt}, ${now})`, sentVia: 'helper', sendState: 'sent', updatedAt: now })
    .where(and(eq(messages.id, messageId), eq(messages.userId, userId), from('confirm_sent')))
    .returning({ id: messages.id })
  if (updated.length) await logEvent(userId, 'sent', messageId, 'confirmed', now)
  return updated.length > 0
}

/** Approve and Skip from a notification's buttons: the approval token stands in for the session. */
export async function approvalByToken(
  messageId: string,
  token: string,
  action: 'send' | 'skip',
  ipKey: string,
  now = Date.now(),
): Promise<{ ok: true; text: string } | { ok: false; status: 401 | 409 | 429; text: string }> {
  if (!(await spend([{ key: `approval:ip:${ipKey}`, limit: APPROVAL_ACTIONS_PER_IP_HOURLY, hourly: true }], now).catch(() => false))) {
    return { ok: false, status: 429, text: 'Too many tries. Open Tend instead.' }
  }
  const secret = approvalSecret()
  const message = await db.query.messages.findFirst({ where: eq(messages.id, messageId) })
  if (!secret || !message || !(await verifyApproval(secret, token, message.id, await bodyHash(message.body), now))) {
    return { ok: false, status: 401, text: 'This notification has expired. Open Tend to send it.' }
  }
  if (action === 'skip') {
    const skipped = await skipApproval(message.userId, message.id, now)
    return skipped.ok ? { ok: true, text: 'Skipped. Nothing was sent.' } : { ok: false, status: 409, text: 'This message was already sent, skipped or changed.' }
  }
  const approved = await approveMessage(message.userId, message.id, 'push', now)
  if (approved.ok) return { ok: true, text: `Approved. Your helper will send it to ${approved.contactName} shortly.` }
  return { ok: false, status: 409, text: APPROVAL_REFUSAL_TEXT[approved.reason] }
}

/* The reminder run ---------------------------------------------------------------------------- */

/**
 * For a user with a helper: their due content and personal messages to people
 * who said yes (with a number) become approval requests, each pushed with
 * Send and Skip. Returns the ids whose push went out; those skip the usual
 * reminder. A request whose push could not go out is handed back, so the
 * usual reminder covers it.
 */
export async function requestApprovals(userId: string, messageIds: string[], subscriptions: Subscription[], now = Date.now()): Promise<string[]> {
  if (!messageIds.length) return []
  const device = await activeHelper(userId)
  const secret = approvalSecret()
  if (!device || !secret) return []
  const eligible = await db
    .select({ id: messages.id, body: messages.body, contactName: contacts.name })
    .from(messages)
    .innerJoin(contacts, eq(contacts.id, messages.contactId))
    .where(
      and(
        eq(messages.userId, userId),
        inArray(messages.id, messageIds),
        ne(messages.kind, 'consent_request'),
        eq(contacts.consent, 'yes'),
        isNotNull(contacts.phoneEnc),
      ),
    )
  if (!eligible.length) return []
  const requested = await db
    .update(messages)
    .set({ approvalState: 'pending', remindedAt: now, updatedAt: now })
    .where(and(inArray(messages.id, eligible.map((m) => m.id)), eq(messages.status, 'scheduled'), isNull(messages.remindedAt), from('request')))
    .returning({ id: messages.id })
  const ids = new Set(requested.map((r) => r.id))
  const offline = !device.lastSeenAt || now - device.lastSeenAt > HELPER_LIMITS.offlineNoticeMs
  const delivered: string[] = []
  for (const m of eligible.filter((e) => ids.has(e.id))) {
    const token = await signApproval(secret, m.id, await bodyHash(m.body), now + HELPER_LIMITS.approvalTokenTtlMs)
    const pushed = subscriptions.length && (await helperPush(userId, approvalPush({ id: m.id, contactName: m.contactName, body: m.body, token, helperOffline: offline }), now, subscriptions))
    if (pushed) delivered.push(m.id)
  }
  const handBack = [...ids].filter((id) => !delivered.includes(id))
  if (handBack.length) await db.update(messages).set({ remindedAt: null }).where(inArray(messages.id, handBack))
  return delivered
}

export interface HelperSweep {
  unknown: number
  expired: number
}

/**
 * Every reminder run: a lease that ran out with no report becomes "unknown"
 * (never retried), and an approval nobody claimed by sendBy goes back to the
 * manual path with one notice. Old events and codes are pruned.
 */
export async function sweepHelper(now = Date.now()): Promise<HelperSweep> {
  const lapsed = await db
    .update(messages)
    .set({ sendState: 'unknown', leaseUntil: null, updatedAt: now })
    .where(and(from('lease_expired'), lt(messages.leaseUntil, now)))
    .returning({ id: messages.id, userId: messages.userId, contactId: messages.contactId })
  for (const m of lapsed) {
    await logEvent(m.userId, 'unknown', m.id, 'lease_expired', now)
    await notice(m.userId, 'unknown', m, now)
  }
  const expired = await db
    .update(messages)
    .set({ approvalState: 'expired', updatedAt: now })
    .where(and(eq(messages.status, 'scheduled'), from('expire'), lt(messages.sendBy, now)))
    .returning({ id: messages.id, userId: messages.userId, contactId: messages.contactId })
  for (const m of expired) {
    await logEvent(m.userId, 'expired', m.id, null, now)
    await notice(m.userId, 'expired', m, now)
  }
  await db.delete(helperEvents).where(lt(helperEvents.at, now - 180 * DAY))
  await db.delete(helperPairCodes).where(lt(helperPairCodes.expiresAt, now))
  return { unknown: lapsed.length, expired: expired.length }
}

/* The approval queue ------------------------------------------------------------------------------ */

export type QueueItem = Message & { contactName: string }

/** Everything waiting on the user or the helper: requests, approved, sending, not sure, not sent. */
export async function approvalQueue(userId: string): Promise<QueueItem[]> {
  const rows = await db
    .select({ message: messages, contactName: contacts.name })
    .from(messages)
    .innerJoin(contacts, eq(contacts.id, messages.contactId))
    .where(
      and(
        eq(messages.userId, userId),
        eq(messages.status, 'scheduled'),
        or(inArray(messages.approvalState, ['pending', 'approved']), inArray(messages.sendState, ['sending', 'failed', 'unknown'])),
      ),
    )
    .orderBy(asc(messages.scheduledFor))
  return rows.map((r) => ({ ...r.message, contactName: r.contactName }))
}

export async function approvalCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.status, 'scheduled'), or(eq(messages.approvalState, 'pending'), inArray(messages.sendState, ['failed', 'unknown']))))
  return Number(row?.n ?? 0)
}
