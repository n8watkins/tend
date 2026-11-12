/**
 * The Signal helper's server side against a real libSQL file database with
 * the real migrations: pairing, token scope, claims and leases, results once
 * per claim, crash leading to "unknown", the rules re-checked at claim, a
 * captcha halting all sends, the offline fallback, and no names, numbers or
 * text in logs. Pushes are captured, not sent.
 */

import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createClient } from '@libsql/client'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const DB_FILE = vi.hoisted(() => {
  const file = `${process.env.TMPDIR || '/tmp'}/tend-helper-server-${process.pid}-${Date.now()}.db`
  process.env.TURSO_DATABASE_URL = `file:${file}`
  process.env.DATA_ENCRYPTION_KEY = 'unit-test-field-key-not-used-anywhere-else'
  process.env.AUTH_SECRET = 'unit-test-auth-secret'
  process.env.SIGNAL_HELPER_USERS = '@helper.test'
  return file
})

const pushes = vi.hoisted(() => [] as { userId: string; payload: { title: string; body: string; url: string; actions?: unknown; approval?: { id: string; token: string } } }[])
vi.mock('@/lib/server/push', () => ({
  subscriptionsFor: async (ids: string[]) => new Map(ids.map((id) => [id, [{ id: `sub-${id}`, endpoint: 'https://fcm.googleapis.com/x', p256dh: 'p', auth: 'a' }]])),
  pushToUser: async (userId: string, _subs: unknown, payload: (typeof pushes)[number]['payload']) => {
    pushes.push({ userId, payload })
    return 'sent'
  },
}))

import { db } from '@/db'
import { contacts, helperDevices, helperEvents, messages, userSettings, users } from '@/db/schema'
import { encrypt } from '@/lib/crypto'
import { HELPER_LIMITS } from '@/lib/helper'
import {
  approvalByToken,
  approveMessage,
  authenticateHelper,
  claimJob,
  confirmSent,
  createPairCode,
  disableHelper,
  enableHelper,
  helperJobs,
  pairHelper,
  removeHelper,
  reportEvent,
  reportResult,
  requestApprovals,
  resumeHelper,
  skipApproval,
  sweepHelper,
  type HelperAuth,
} from '@/lib/server/helper'
import { recordSent } from '@/lib/server/messages'
import { HOUR, MINUTE } from '@/lib/time'

const T0 = Date.UTC(2026, 10, 11, 12)
const PHONE = '+15551234567'
const NAME = 'Samantha Quill'
const BODY = 'Thinking of you today, Samantha. Psalm 23:1'
let ipCounter = 0
const ip = () => `ip-${++ipCounter}`

const logs: string[] = []
const spy = vi.spyOn(console, 'log').mockImplementation((...args) => void logs.push(args.join(' ')))
const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => void logs.push(args.join(' ')))

beforeAll(async () => {
  const client = createClient({ url: `file:${DB_FILE}` })
  const dir = join(process.cwd(), 'db', 'migrations')
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const statements = readFileSync(join(dir, name), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
    await client.batch(statements, 'write')
  }
  client.close()
})

afterAll(() => {
  spy.mockRestore()
  errorSpy.mockRestore()
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(DB_FILE + suffix, { force: true })
  void tmpdir
})

beforeEach(() => {
  pushes.length = 0
})

let seq = 0

/** A user on the allowlist with the helper on, one contact who said yes, and one due message. */
async function setup(opts: { email?: string; consent?: 'yes' | 'asked'; phone?: string | null; kind?: 'personal' | 'consent_request'; enable?: boolean } = {}) {
  const n = ++seq
  const userId = crypto.randomUUID()
  await db.insert(users).values({ id: userId, email: opts.email ?? `owner${n}@helper.test` })
  await db.insert(userSettings).values({ userId, timezone: 'UTC', createdAt: T0 })
  if (opts.enable !== false) expect(await enableHelper(userId, T0)).toBe(opts.email ? opts.email.endsWith('@helper.test') : true)
  const contactId = crypto.randomUUID()
  await db.insert(contacts).values({
    id: contactId,
    userId,
    name: NAME,
    phoneEnc: opts.phone === null ? null : await encrypt(opts.phone ?? PHONE),
    timezone: 'UTC',
    consent: opts.consent ?? 'yes',
    consentUpdatedAt: T0,
    windowStart: 0,
    windowEnd: 1439,
    allowedDays: 127,
    stopToken: `stop-${n}-${crypto.randomUUID()}`,
    createdAt: T0,
    updatedAt: T0,
  })
  const messageId = await addMessage(userId, contactId, opts.kind)
  return { userId, contactId, messageId }
}

async function addMessage(userId: string, contactId: string, kind: 'personal' | 'consent_request' = 'personal', scheduledFor = T0 - MINUTE) {
  const id = crypto.randomUUID()
  await db.insert(messages).values({ id, userId, contactId, kind, body: BODY, status: 'scheduled', scheduledFor, createdAt: T0 - HOUR, updatedAt: T0 - HOUR })
  return id
}

async function pairUser(userId: string, now = T0) {
  const created = await createPairCode(userId, now)
  expect(created).not.toBeNull()
  const paired = await pairHelper({ code: created!.code, name: 'test pc', helperVersion: '0.1.0' }, ip(), now)
  if (!paired.ok) throw new Error(`pair failed ${paired.status}`)
  const auth = await authenticateHelper(`Bearer ${paired.token}`, ip(), now)
  if (!auth.ok) throw new Error('auth failed')
  return { token: paired.token, auth }
}

async function message(id: string) {
  return (await db.query.messages.findFirst({ where: eq(messages.id, id) }))!
}

async function refresh(auth: Extract<HelperAuth, { ok: true }>): Promise<Extract<HelperAuth, { ok: true }>> {
  const [device] = await db.select().from(helperDevices).where(eq(helperDevices.id, auth.device.id))
  return { ...auth, device: device! }
}

describe('pairing and the device token', () => {
  it('turns a one-time code into a token, once, and only before it expires', async () => {
    const { userId } = await setup()
    const created = (await createPairCode(userId, T0))!
    expect(created.code).toMatch(/^[A-Z2-9]{8}$/)
    const first = await pairHelper({ code: `${created.code.slice(0, 4)}-${created.code.slice(4)}`.toLowerCase(), name: 'pc' }, ip(), T0)
    expect(first.ok).toBe(true)
    expect(await pairHelper({ code: created.code, name: 'pc' }, ip(), T0)).toEqual({ ok: false, status: 401 })

    const late = (await createPairCode(userId, T0))!
    expect(await pairHelper({ code: late.code, name: 'pc' }, ip(), T0 + HELPER_LIMITS.pairCodeTtlMs + 1)).toEqual({ ok: false, status: 401 })
    expect(await pairHelper({ code: 'not a code', name: 'pc' }, ip(), T0)).toEqual({ ok: false, status: 400 })
  })

  it('throttles pairing attempts from one address', async () => {
    const address = ip()
    for (let i = 0; i < 10; i++) expect((await pairHelper({ code: 'AAAAAAAA', name: 'pc' }, address, T0)).ok).toBe(false)
    expect(await pairHelper({ code: 'AAAAAAAA', name: 'pc' }, address, T0)).toEqual({ ok: false, status: 429 })
  })

  it('keeps one helper per account: pairing again revokes the earlier token', async () => {
    const { userId } = await setup()
    const a = await pairUser(userId)
    const b = await pairUser(userId)
    expect((await authenticateHelper(`Bearer ${a.token}`, ip(), T0)).ok).toBe(false)
    expect((await authenticateHelper(`Bearer ${b.token}`, ip(), T0)).ok).toBe(true)
    // Only the hash is stored.
    const rows = await db.select().from(helperDevices).where(eq(helperDevices.userId, userId))
    expect(rows.map((r) => r.tokenHash)).not.toContain(b.token)
    expect(JSON.stringify(rows)).not.toContain(b.token.slice(4))
  })

  it('is private: no code, and no access, for an account not on the list', async () => {
    const { userId } = await setup({ email: 'someone@example.com' })
    expect(await createPairCode(userId, T0)).toBeNull()
    expect(await enableHelper(userId, T0)).toBe(false)
  })

  it('accepts only a live device token: not a session, not revoked, not after the account leaves the list or turns it off', async () => {
    const { userId } = await setup()
    const { token } = await pairUser(userId)
    expect((await authenticateHelper(`Bearer ${token}`, ip(), T0)).ok).toBe(true)
    expect(await authenticateHelper(null, ip(), T0)).toEqual({ ok: false, status: 401 })
    expect(await authenticateHelper('Bearer authjs.session-token=abc', ip(), T0)).toEqual({ ok: false, status: 401 })
    expect(await authenticateHelper(token, ip(), T0)).toEqual({ ok: false, status: 401 })

    const previous = process.env.SIGNAL_HELPER_USERS
    process.env.SIGNAL_HELPER_USERS = 'nobody@else.test'
    expect(await authenticateHelper(`Bearer ${token}`, ip(), T0)).toEqual({ ok: false, status: 401 })
    process.env.SIGNAL_HELPER_USERS = previous

    await removeHelper(userId, T0)
    expect(await authenticateHelper(`Bearer ${token}`, ip(), T0)).toEqual({ ok: false, status: 401 })
  })

  it('refuses an address outright after too many bad tokens, and limits each token per hour', async () => {
    const address = ip()
    for (let i = 0; i < HELPER_LIMITS.badTokensPerHour; i++) await authenticateHelper('Bearer tdh_' + 'x'.repeat(43), address, T0)
    expect(await authenticateHelper('Bearer tdh_' + 'x'.repeat(43), address, T0)).toEqual({ ok: false, status: 429 })

    const { userId } = await setup()
    const { token } = await pairUser(userId)
    const hour = T0 + 5 * HOUR
    for (let i = 0; i < HELPER_LIMITS.callsPerHour; i++) expect((await authenticateHelper(`Bearer ${token}`, ip(), hour)).ok).toBe(true)
    expect(await authenticateHelper(`Bearer ${token}`, ip(), hour)).toEqual({ ok: false, status: 429 })
    expect((await authenticateHelper(`Bearer ${token}`, ip(), hour + HOUR)).ok).toBe(true)
    // About 330 limit writes to a local database: seconds on a busy machine.
  }, 30_000)
})

describe('approve, claim, send, report', () => {
  it('sends an approved message exactly once and records it as sent by the helper', async () => {
    const { userId, messageId } = await setup()
    const { auth } = await pairUser(userId)

    // Not approved yet: listed nowhere, claim refused.
    expect((await helperJobs(auth, { helperVersion: '0.1.0', signalCliVersion: '0.13.22' }, T0)).jobs).toEqual([])
    expect(await claimJob(auth, messageId, T0)).toMatchObject({ ok: false, reason: 'not_approved' })

    const approved = await approveMessage(userId, messageId, 'app', T0)
    expect(approved).toMatchObject({ ok: true, sendBy: T0 + 2 * HOUR })
    const jobs = await helperJobs(auth, { helperVersion: '0.1.0', signalCliVersion: '0.13.22' }, T0)
    // Ids and times only: no number, name or text before a claim.
    expect(jobs.jobs).toEqual([{ id: messageId, approvedAt: T0, sendBy: T0 + 2 * HOUR }])
    expect(JSON.stringify(jobs)).not.toMatch(/555|Samantha|Thinking/)

    const claim = await claimJob(await refresh(auth), messageId, T0 + MINUTE)
    if (!claim.ok) throw new Error(claim.reason)
    expect(claim.job).toMatchObject({ id: messageId, recipient: PHONE, body: BODY, leaseUntil: T0 + MINUTE + HELPER_LIMITS.leaseMs })
    expect(await message(messageId)).toMatchObject({ sendState: 'sending', claimId: claim.job.claimId })

    // While sending, nothing else may touch it.
    expect(await claimJob(await refresh(auth), messageId, T0 + 20 * MINUTE)).toMatchObject({ ok: false, reason: 'already_claimed' })
    expect(await recordSent(userId, messageId, T0 + 2 * MINUTE)).toMatchObject({ ok: false, reason: 'helper_sending' })
    expect((await skipApproval(userId, messageId, T0 + 2 * MINUTE)).ok).toBe(false)

    const result = await reportResult(auth, messageId, { claimId: claim.job.claimId, outcome: 'sent', signalTimestamp: 1794000000000 }, T0 + 2 * MINUTE)
    expect(result).toEqual({ ok: true, sendState: 'sent', repeat: false })
    expect(await message(messageId)).toMatchObject({ status: 'sent', sentVia: 'helper', sendState: 'sent', signalTimestamp: 1794000000000, sentAt: T0 + 2 * MINUTE })
    expect(pushes.at(-1)!.payload.title).toBe(`Sent to ${NAME}`)

    // A repeat result returns the first answer and changes nothing; another claim id is refused.
    expect(await reportResult(auth, messageId, { claimId: claim.job.claimId, outcome: 'failed', reason: 'network' }, T0 + 3 * MINUTE)).toEqual({ ok: true, sendState: 'sent', repeat: true })
    expect(await reportResult(auth, messageId, { claimId: crypto.randomUUID(), outcome: 'sent' }, T0 + 3 * MINUTE)).toEqual({ ok: false, status: 409, reason: 'stale_claim' })
    expect(await message(messageId)).toMatchObject({ status: 'sent', sendState: 'sent', sentAt: T0 + 2 * MINUTE })
  })

  it('lets only one of two simultaneous claims win', async () => {
    const { userId, messageId } = await setup()
    const { auth } = await pairUser(userId)
    await approveMessage(userId, messageId, 'push', T0)
    const results = await Promise.all([claimJob(auth, messageId, T0), claimJob(auth, messageId, T0), claimJob(auth, messageId, T0)])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })

  it('refuses anything a device token does not own', async () => {
    const a = await setup()
    const b = await setup()
    const { auth } = await pairUser(a.userId)
    await approveMessage(b.userId, b.messageId, 'app', T0)
    expect(await claimJob(auth, b.messageId, T0)).toEqual({ ok: false, reason: 'not_found' })
    expect(await reportResult(auth, b.messageId, { claimId: crypto.randomUUID(), outcome: 'sent' }, T0)).toMatchObject({ ok: false, status: 404 })
  })
})

describe('at most once: crashes and leases', () => {
  it('a lease that runs out becomes "unknown", is never claimed again, and a late report still tells the truth', async () => {
    const { userId, messageId } = await setup()
    const { auth } = await pairUser(userId)
    await approveMessage(userId, messageId, 'app', T0)
    const claim = await claimJob(auth, messageId, T0)
    if (!claim.ok) throw new Error(claim.reason)

    await sweepHelper(T0 + HELPER_LIMITS.leaseMs - 1)
    expect((await message(messageId)).sendState).toBe('sending')
    expect((await sweepHelper(T0 + HELPER_LIMITS.leaseMs + 1)).unknown).toBeGreaterThanOrEqual(1)
    expect(await message(messageId)).toMatchObject({ status: 'scheduled', sendState: 'unknown' })
    expect(pushes.at(-1)!.payload.title).toBe(`Not sure it reached ${NAME}`)
    expect((await helperJobs(await refresh(auth), { helperVersion: null, signalCliVersion: null }, T0 + HOUR)).jobs).toEqual([])
    expect(await claimJob(await refresh(auth), messageId, T0 + HOUR)).toMatchObject({ ok: false, reason: 'already_claimed' })

    // The helper comes back and says it did go out.
    expect(await reportResult(auth, messageId, { claimId: claim.job.claimId, outcome: 'sent' }, T0 + HOUR)).toMatchObject({ ok: true, sendState: 'sent' })
    expect(await message(messageId)).toMatchObject({ status: 'sent', sentVia: 'helper' })
  })

  it('a helper that crashed mid-send reports unknown; only the user can say it was sent, or send it again', async () => {
    const { userId, messageId } = await setup()
    const { auth } = await pairUser(userId)
    await approveMessage(userId, messageId, 'app', T0)
    const claim = await claimJob(auth, messageId, T0)
    if (!claim.ok) throw new Error(claim.reason)
    expect(await reportResult(auth, messageId, { claimId: claim.job.claimId, outcome: 'unknown' }, T0 + MINUTE)).toMatchObject({ ok: true, sendState: 'unknown' })
    expect(await claimJob(await refresh(auth), messageId, T0 + HOUR)).toMatchObject({ ok: false, reason: 'already_claimed' })

    // "Send it again" is a new, explicit approval with a new claim.
    const again = await approveMessage(userId, messageId, 'app', T0 + HOUR, 'retry')
    expect(again.ok).toBe(true)
    const second = await claimJob(await refresh(auth), messageId, T0 + HOUR + MINUTE)
    expect(second.ok && second.job.claimId).not.toBe(claim.job.claimId)
    // The first claim's late report no longer counts.
    expect(await reportResult(auth, messageId, { claimId: claim.job.claimId, outcome: 'sent' }, T0 + HOUR + 2 * MINUTE)).toMatchObject({ ok: false, status: 409 })
  })

  it('"It was sent" settles an unknown send', async () => {
    const { userId, messageId } = await setup()
    const { auth } = await pairUser(userId)
    await approveMessage(userId, messageId, 'app', T0)
    const claim = await claimJob(auth, messageId, T0)
    if (!claim.ok) throw new Error(claim.reason)
    await sweepHelper(T0 + HOUR)
    expect(await confirmSent(userId, messageId, T0 + 2 * HOUR)).toBe(true)
    expect(await message(messageId)).toMatchObject({ status: 'sent', sentVia: 'helper', sendState: 'sent', sentAt: T0 })
  })
})

describe('every rule is checked again at claim', () => {
  async function approvedSetup() {
    const s = await setup()
    const { auth } = await pairUser(s.userId)
    expect((await approveMessage(s.userId, s.messageId, 'app', T0)).ok).toBe(true)
    return { ...s, auth }
  }

  it('consent changed to no, or the stop link, after approval: nothing is sent', async () => {
    const a = await approvedSetup()
    await db.update(contacts).set({ consent: 'no' }).where(eq(contacts.id, a.contactId))
    expect(await claimJob(a.auth, a.messageId, T0 + MINUTE)).toMatchObject({ ok: false, reason: 'consent' })

    const b = await approvedSetup()
    // What the stop page does: stopped, and everything scheduled canceled.
    await db.update(contacts).set({ consent: 'stopped', stoppedByRecipient: true }).where(eq(contacts.id, b.contactId))
    await db.update(messages).set({ status: 'canceled' }).where(and(eq(messages.contactId, b.contactId), eq(messages.status, 'scheduled')))
    expect(await claimJob(b.auth, b.messageId, T0 + MINUTE)).toMatchObject({ ok: false, reason: 'not_scheduled' })
  })

  it('text edited after approval: refused until approved again', async () => {
    const a = await approvedSetup()
    await db.update(messages).set({ body: `${BODY} (edited)` }).where(eq(messages.id, a.messageId))
    expect(await claimJob(a.auth, a.messageId, T0 + MINUTE)).toMatchObject({ ok: false, reason: 'body_changed' })
  })

  it('Tend paused, or skipped: nothing is sent', async () => {
    const a = await approvedSetup()
    await db.update(userSettings).set({ pausedAt: T0 }).where(eq(userSettings.userId, a.userId))
    expect(await claimJob(a.auth, a.messageId, T0 + MINUTE)).toMatchObject({ ok: false, reason: 'paused' })
    expect((await helperJobs(a.auth, { helperVersion: null, signalCliVersion: null }, T0 + MINUTE)).paused).toBe(true)

    const b = await approvedSetup()
    expect((await skipApproval(b.userId, b.messageId, T0 + MINUTE)).ok).toBe(true)
    expect(await claimJob(b.auth, b.messageId, T0 + 2 * MINUTE)).toMatchObject({ ok: false, reason: 'not_scheduled' })
    expect(await message(b.messageId)).toMatchObject({ status: 'skipped', approvalState: 'skipped' })
  })

  it('holds the gap between sends and the daily cap', async () => {
    const { userId, contactId, messageId } = await setup()
    await db.update(contacts).set({ minDaysBetween: 1, maxPer30Days: 10 }).where(eq(contacts.id, contactId))
    const { auth } = await pairUser(userId)
    await approveMessage(userId, messageId, 'app', T0)
    const first = await claimJob(auth, messageId, T0)
    expect(first.ok).toBe(true)

    const other = await setup()
    // A second person of the same user, so the per-person rules do not interfere.
    await db.update(contacts).set({ userId }).where(eq(contacts.id, other.contactId))
    await db.update(messages).set({ userId }).where(eq(messages.id, other.messageId))
    await approveMessage(userId, other.messageId, 'app', T0)
    expect(await claimJob(await refresh(auth), other.messageId, T0 + 5 * MINUTE)).toMatchObject({ ok: false, reason: 'gap', retryAt: T0 + HELPER_LIMITS.gapMs })
    expect((await claimJob(await refresh(auth), other.messageId, T0 + HELPER_LIMITS.gapMs)).ok).toBe(true)

    // Nine more claimed in the last day: the eleventh is over the cap of 10.
    for (let i = 0; i < 8; i++) {
      const id = await addMessage(userId, contactId)
      await db.update(messages).set({ claimedAt: T0 - HOUR - i, sendState: 'sent', status: 'sent' }).where(eq(messages.id, id))
    }
    const third = await setup()
    await db.update(contacts).set({ userId }).where(eq(contacts.id, third.contactId))
    await db.update(messages).set({ userId }).where(eq(messages.id, third.messageId))
    await approveMessage(userId, third.messageId, 'app', T0 + 30 * MINUTE)
    expect(await claimJob(await refresh(auth), third.messageId, T0 + 30 * MINUTE)).toMatchObject({ ok: false, reason: 'daily_cap' })
  })
})

describe('a captcha stops all sending', () => {
  it('halts the helper on a challenge until the user resumes', async () => {
    const { userId, contactId, messageId } = await setup()
    const { auth } = await pairUser(userId)
    await approveMessage(userId, messageId, 'app', T0)
    const claim = await claimJob(auth, messageId, T0)
    if (!claim.ok) throw new Error(claim.reason)
    await reportEvent(auth, 'challenge', T0 + MINUTE)
    expect(await reportResult(auth, messageId, { claimId: claim.job.claimId, outcome: 'failed', reason: 'challenge' }, T0 + MINUTE)).toMatchObject({ ok: true, sendState: 'failed' })
    expect(pushes.filter((p) => p.payload.title === 'Your helper stopped sending')).toHaveLength(1)
    // The user gives up on that one (Skip works after a failure).
    expect((await skipApproval(userId, messageId, T0 + 2 * MINUTE)).ok).toBe(true)

    const next = await addMessage(userId, contactId)
    await db.update(contacts).set({ minDaysBetween: 1, maxPer30Days: 10 }).where(eq(contacts.id, contactId))
    await approveMessage(userId, next, 'app', T0 + HOUR)
    const halted = await refresh(auth)
    expect((await helperJobs(halted, { helperVersion: null, signalCliVersion: null }, T0 + HOUR)).halted).toBe('challenge')
    expect(await claimJob(halted, next, T0 + HOUR)).toMatchObject({ ok: false, reason: 'halted' })
    // Unknown failure reasons are stored as "other", never as free text.
    expect((await message(messageId)).sendFailure).toBe('challenge')

    expect(await resumeHelper(userId, T0 + 2 * HOUR)).toBe(true)
    expect((await claimJob(await refresh(auth), next, T0 + HOUR + 30 * MINUTE)).ok).toBe(true)
  })
})

describe('the reminder run and the offline fallback', () => {
  it('asks with Send and Skip for due messages the helper may send, and nothing else', async () => {
    const { userId, contactId, messageId } = await setup()
    await pairUser(userId)
    const consentRequest = await addMessage(userId, contactId, 'consent_request')
    const noPhone = await setup({ phone: null })
    const asked = await requestApprovals(userId, [messageId, consentRequest], [{ id: 's', endpoint: 'e', p256dh: 'p', auth: 'a' }], T0)
    expect(asked).toEqual([messageId])
    expect(await message(messageId)).toMatchObject({ approvalState: 'pending', remindedAt: T0 })
    expect((await message(consentRequest)).approvalState).toBe('none')
    const push = pushes.at(-1)!.payload
    expect(push).toMatchObject({ title: `Send to ${NAME}?`, url: `/approve/${messageId}`, actions: [{ action: 'send' }, { action: 'skip' }] })
    // Its helper never connected: the push says so.
    expect(push.body).toContain('Your helper is offline')
    // Asked once: the next run does not ask again.
    expect(await requestApprovals(userId, [messageId], [{ id: 's', endpoint: 'e', p256dh: 'p', auth: 'a' }], T0 + 15 * MINUTE)).toEqual([])

    await pairUser(noPhone.userId)
    expect(await requestApprovals(noPhone.userId, [noPhone.messageId], [{ id: 's', endpoint: 'e', p256dh: 'p', auth: 'a' }], T0)).toEqual([])

    // The push's Send button: the token approves exactly this message.
    const token = push.approval!.token
    expect(await approvalByToken(messageId, token, 'send', ip(), T0 + MINUTE)).toMatchObject({ ok: true })
    expect(await message(messageId)).toMatchObject({ approvalState: 'approved', approvedVia: 'push' })
    expect(await approvalByToken(messageId, 'x'.repeat(13) + '.' + 'y'.repeat(43), 'skip', ip(), T0 + MINUTE)).toMatchObject({ ok: false, status: 401 })
    expect(await approvalByToken(noPhone.messageId, token, 'send', ip(), T0 + MINUTE)).toMatchObject({ ok: false, status: 401 })
  })

  it('falls back to manual at sendBy with one notice, and a helper coming back later sends nothing', async () => {
    const { userId, messageId } = await setup()
    const { auth } = await pairUser(userId)
    await approveMessage(userId, messageId, 'app', T0)
    await sweepHelper(T0 + 2 * HOUR - 1)
    expect((await message(messageId)).approvalState).toBe('approved')
    await sweepHelper(T0 + 2 * HOUR + 1)
    expect(await message(messageId)).toMatchObject({ status: 'scheduled', approvalState: 'expired', sendState: 'idle' })
    const notices = () => pushes.filter((p) => p.userId === userId && p.payload.title === `Not sent to ${NAME}`)
    expect(notices()).toHaveLength(1)
    expect(notices()[0]!.payload.body).toBe('Your PC was off. Send it yourself or reschedule.')
    await sweepHelper(T0 + 3 * HOUR)
    expect(notices()).toHaveLength(1)

    expect((await helperJobs(auth, { helperVersion: null, signalCliVersion: null }, T0 + 3 * HOUR)).jobs).toEqual([])
    expect(await claimJob(auth, messageId, T0 + 3 * HOUR)).toMatchObject({ ok: false, reason: 'not_approved' })
    // Still on the manual path.
    expect(await recordSent(userId, messageId, T0 + 3 * HOUR)).toMatchObject({ ok: true })
    expect((await message(messageId)).sentVia).toBe('you')
  })

  it('removing the helper (or turning it off) stops it at once and lapses approvals', async () => {
    const { userId, messageId } = await setup()
    const { token, auth } = await pairUser(userId)
    await approveMessage(userId, messageId, 'app', T0)
    await removeHelper(userId, T0 + MINUTE)
    expect(await authenticateHelper(`Bearer ${token}`, ip(), T0 + MINUTE)).toEqual({ ok: false, status: 401 })
    expect((await message(messageId)).approvalState).toBe('expired')
    expect(await claimJob(auth, messageId, T0 + MINUTE)).toMatchObject({ ok: false })

    const other = await setup()
    await pairUser(other.userId)
    await disableHelper(other.userId, T0)
    expect(await approveMessage(other.userId, other.messageId, 'app', T0)).toMatchObject({ ok: false, reason: 'no_helper' })
  })

  it('cannot approve what the helper may not send', async () => {
    const asked = await setup({ consent: 'asked' })
    await pairUser(asked.userId)
    expect(await approveMessage(asked.userId, asked.messageId, 'app', T0)).toMatchObject({ ok: false, reason: 'consent' })
    const request = await setup({ kind: 'consent_request' })
    await pairUser(request.userId)
    expect(await approveMessage(request.userId, request.messageId, 'app', T0)).toMatchObject({ ok: false, reason: 'kind' })
    const early = await setup()
    await pairUser(early.userId)
    const future = await addMessage(early.userId, early.contactId, 'personal', T0 + HOUR)
    expect(await approveMessage(early.userId, future, 'app', T0)).toMatchObject({ ok: false, reason: 'not_due' })
  })
})

describe('logs', () => {
  it('never carry names, numbers or message text, on the server or in helper events', async () => {
    const all = logs.join('\n')
    expect(all).toContain('"event":"helper"')
    expect(all).not.toContain(PHONE)
    expect(all).not.toContain('5551234567')
    expect(all).not.toContain('Samantha')
    expect(all).not.toContain('Thinking of you')
    const events = await db.select().from(helperEvents)
    expect(events.length).toBeGreaterThan(10)
    const text = JSON.stringify(events)
    expect(text).not.toMatch(/555123|Samantha|Thinking/)
  })
})
