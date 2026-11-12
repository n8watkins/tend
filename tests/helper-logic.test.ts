import { describe, expect, it } from 'vitest'

import { APPROVAL_STATES, SEND_STATES } from '@/lib/enums'
import {
  bearerDeviceToken,
  bodyHash,
  claimRefusal,
  clampDaily,
  clampGap,
  formatPairCode,
  HELPER_LIMITS,
  helperAllowed,
  isDeviceToken,
  manualChangeAllowed,
  newDeviceToken,
  newPairCode,
  normalizePairCode,
  sendByFor,
  signApproval,
  transition,
  TRANSITIONS,
  verifyApproval,
  versionAtLeast,
  type ClaimInput,
  type HelperAction,
} from '@/lib/helper'
import { approvalPush, helperNoticePush, pushTopic } from '@/lib/push'
import { HOUR, MINUTE, zonedToUtc } from '@/lib/time'

import { bodyHash as helperBodyHash, versionAtLeast as helperVersionAtLeast } from '../helper/lib/runner.mjs'

describe('the approval and send state machine', () => {
  const every = APPROVAL_STATES.flatMap((approval) => SEND_STATES.map((send) => ({ approval, send })))

  it('allows exactly the transitions in the table, from every state', () => {
    for (const action of Object.keys(TRANSITIONS) as HelperAction[]) {
      const rule = TRANSITIONS[action]
      for (const state of every) {
        const allowed = (!rule.from.approval || rule.from.approval.includes(state.approval)) && rule.from.send.includes(state.send)
        expect(transition(state, action), `${action} from ${state.approval}/${state.send}`).toEqual(allowed ? { ...state, ...rule.to } : null)
      }
    }
  })

  it('walks the happy path: request, approve, claim, sent', () => {
    let s = transition({ approval: 'none', send: 'idle' }, 'request')!
    s = transition(s, 'approve')!
    s = transition(s, 'claim')!
    expect(s).toEqual({ approval: 'approved', send: 'sending' })
    expect(transition(s, 'sent')).toEqual({ approval: 'approved', send: 'sent' })
  })

  it('never lets a claimed message be claimed, approved or skipped again', () => {
    const sending = { approval: 'approved', send: 'sending' } as const
    expect(transition(sending, 'claim')).toBeNull()
    expect(transition(sending, 'approve')).toBeNull()
    expect(transition(sending, 'skip')).toBeNull()
    expect(transition(sending, 'retry')).toBeNull()
    expect(manualChangeAllowed('sending')).toBe(false)
    for (const send of ['idle', 'sent', 'failed', 'unknown'] as const) expect(manualChangeAllowed(send)).toBe(true)
  })

  it('turns a lapsed lease into unknown, and unknown is never retried on its own', () => {
    const unknown = transition({ approval: 'approved', send: 'sending' }, 'lease_expired')!
    expect(unknown.send).toBe('unknown')
    expect(transition(unknown, 'claim')).toBeNull()
    // Only the user, explicitly: It was sent, or Send it again (a new approval).
    expect(transition(unknown, 'confirm_sent')!.send).toBe('sent')
    expect(transition(unknown, 'retry')).toEqual({ approval: 'approved', send: 'idle' })
    // A late report still records what really happened.
    expect(transition(unknown, 'sent')!.send).toBe('sent')
  })

  it('expires approvals nobody claimed, and a sent message stays sent', () => {
    expect(transition({ approval: 'approved', send: 'idle' }, 'expire')).toEqual({ approval: 'expired', send: 'idle' })
    for (const action of Object.keys(TRANSITIONS) as HelperAction[]) {
      const next = transition({ approval: 'approved', send: 'sent' }, action)
      expect(next === null || next.send === 'sent', action).toBe(true)
    }
  })
})

describe('tokens and codes', () => {
  it('device tokens are 32 random bytes with a tdh_ prefix, and only those pass', () => {
    const token = newDeviceToken()
    expect(token).toMatch(/^tdh_[A-Za-z0-9_-]{43}$/)
    expect(newDeviceToken()).not.toBe(token)
    expect(isDeviceToken(token)).toBe(true)
    expect(isDeviceToken(token.slice(0, -1))).toBe(false)
    expect(bearerDeviceToken(`Bearer ${token}`)).toBe(token)
    expect(bearerDeviceToken(token)).toBeNull()
    expect(bearerDeviceToken('Bearer some-session-cookie')).toBeNull()
    expect(bearerDeviceToken(null)).toBeNull()
  })

  it('pairing codes are 8 unambiguous characters, typed in any case with or without the dash', () => {
    for (let i = 0; i < 200; i++) expect(newPairCode()).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ2-9]{8}$/)
    const code = newPairCode()
    expect(normalizePairCode(formatPairCode(code).toLowerCase())).toBe(code)
    expect(normalizePairCode(` ${code.slice(0, 4)} ${code.slice(4)} `)).toBe(code)
    expect(normalizePairCode('ABCD-EFG0')).toBeNull()
    expect(normalizePairCode('ABCDEFGHJ')).toBeNull()
  })

  it('approval tokens bind the message, its exact text and an expiry, and cannot be forged', async () => {
    const now = Date.UTC(2026, 10, 11, 12)
    const hash = await bodyHash('Thinking of you.')
    const token = await signApproval('secret', 'msg-1', hash, now + HOUR)
    expect(await verifyApproval('secret', token, 'msg-1', hash, now)).toBe(true)
    expect(await verifyApproval('secret', token, 'msg-2', hash, now)).toBe(false)
    expect(await verifyApproval('secret', token, 'msg-1', await bodyHash('Thinking of you!'), now)).toBe(false)
    expect(await verifyApproval('other-secret', token, 'msg-1', hash, now)).toBe(false)
    expect(await verifyApproval('secret', token, 'msg-1', hash, now + HOUR + 1)).toBe(false)
    const [exp, sig] = token.split('.')
    expect(await verifyApproval('secret', `${Number(exp) + 1000}.${sig}`, 'msg-1', hash, now)).toBe(false)
    // Longer than 12 hours is never valid, even when signed.
    const long = await signApproval('secret', 'msg-1', hash, now + HELPER_LIMITS.approvalTokenTtlMs + MINUTE)
    expect(await verifyApproval('secret', long, 'msg-1', hash, now)).toBe(false)
    expect(await verifyApproval('secret', 'garbage', 'msg-1', hash, now)).toBe(false)
  })

  it('the helper hashes a body exactly as Tend does', async () => {
    for (const body of ['Hi', 'Psalm 23:1 (WEB)\n- "The LORD"', 'émoji 🌿 and\ttabs']) expect(helperBodyHash(body)).toBe(await bodyHash(body))
  })

  it('compares versions the same on both sides', () => {
    for (const [v, min, ok] of [
      ['0.1.0', '0.1.0', true],
      ['0.2.0', '0.1.9', true],
      ['0.1.0', '0.1.1', false],
      ['1', '0.9.9', true],
      ['x', '0.1.0', false],
    ] as const) {
      expect(versionAtLeast(v, min)).toBe(ok)
      expect(helperVersionAtLeast(v, min)).toBe(ok)
    }
  })
})

describe('who may use the helper', () => {
  it('is nobody by default, and only listed addresses or domains', () => {
    expect(helperAllowed('owner@example.com', undefined)).toBe(false)
    expect(helperAllowed('owner@example.com', '')).toBe(false)
    expect(helperAllowed('Owner@Example.com', 'owner@example.com')).toBe(true)
    expect(helperAllowed('owner@example.com', 'a@b.c, owner@example.com')).toBe(true)
    expect(helperAllowed('someone@example.com', 'owner@example.com')).toBe(false)
    expect(helperAllowed('x@helper.test', '@helper.test')).toBe(true)
    expect(helperAllowed('x@evilhelper.test', '@helper.test')).toBe(false)
    expect(helperAllowed('@helper.test', '@helper.test')).toBe(false)
    expect(helperAllowed(null, 'owner@example.com')).toBe(false)
  })
})

describe('caps', () => {
  it('can never be set past the hard maximum or below the minimum gap', () => {
    expect(clampDaily(10)).toBe(10)
    expect(clampDaily(500)).toBe(HELPER_LIMITS.dailyMax)
    expect(clampGap(0)).toBe(HELPER_LIMITS.gapMinMs)
    expect(clampGap(10 * MINUTE)).toBe(10 * MINUTE)
  })
})

describe('sendBy', () => {
  const rules = { timezone: 'America/New_York', windowStart: 9 * 60, windowEnd: 20 * 60, allowedDays: 127 }

  it('is the end of their window that day, at most two hours after approval', () => {
    const morning = zonedToUtc(2026, 11, 11, 10 * 60, rules.timezone)
    expect(sendByFor(rules, morning)).toBe(morning + 2 * HOUR)
    const evening = zonedToUtc(2026, 11, 11, 19 * 60, rules.timezone)
    expect(sendByFor(rules, evening)).toBe(zonedToUtc(2026, 11, 11, 20 * 60, rules.timezone))
  })

  it('is null outside their window or on a day they do not allow', () => {
    expect(sendByFor(rules, zonedToUtc(2026, 11, 11, 21 * 60, rules.timezone))).toBeNull()
    // 2026-11-11 is a Wednesday (3); allow only Sundays.
    expect(sendByFor({ ...rules, allowedDays: 1 }, zonedToUtc(2026, 11, 11, 10 * 60, rules.timezone))).toBeNull()
  })

  it('holds across a DST change (the window end is local time)', () => {
    // 2026-11-01: New York falls back at 02:00.
    const at = zonedToUtc(2026, 11, 1, 18 * 60 + 30, rules.timezone)
    expect(sendByFor(rules, at)).toBe(zonedToUtc(2026, 11, 1, 20 * 60, rules.timezone))
    expect(sendByFor(rules, at)! - at).toBe(90 * MINUTE)
  })
})

describe('the checks at claim', () => {
  const now = Date.UTC(2026, 10, 11, 15)

  async function input(overrides: Partial<ClaimInput> = {}, message: Partial<ClaimInput['message']> = {}): Promise<ClaimInput> {
    const body = message.body ?? 'Thinking of you.'
    return {
      now,
      message: { status: 'scheduled', kind: 'personal', body, approvalState: 'approved', sendState: 'idle', approvedBodyHash: await bodyHash(body), sendBy: now + HOUR, ...message },
      currentBodyHash: await bodyHash(body),
      contact: { timezone: 'UTC', consent: 'yes', minDaysBetween: 7, maxPer30Days: 4, windowStart: 0, windowEnd: 1439, allowedDays: 127, hasPhone: true },
      history: [],
      paused: false,
      halted: false,
      sentToday: 0,
      dailyCap: 10,
      siteToday: 0,
      siteCap: 200,
      lastClaimAt: null,
      gapMs: 10 * MINUTE,
      ...overrides,
    }
  }

  it('passes a fresh approval', async () => {
    expect(claimRefusal(await input())).toBeNull()
  })

  it('refuses when consent changed after approval', async () => {
    for (const consent of ['no', 'stopped', 'asked'] as const) {
      const i = await input()
      expect(claimRefusal({ ...i, contact: { ...i.contact, consent } })).toBe('consent')
    }
  })

  it('refuses when the text was edited after approval', async () => {
    const i = await input()
    expect(claimRefusal({ ...i, message: { ...i.message, body: 'Changed' }, currentBodyHash: await bodyHash('Changed') })).toBe('body_changed')
    expect(claimRefusal(await input({}, { approvedBodyHash: null }))).toBe('body_changed')
  })

  it('refuses when paused, halted, skipped, canceled, already claimed, not approved or past sendBy', async () => {
    expect(claimRefusal(await input({ paused: true }))).toBe('paused')
    expect(claimRefusal(await input({ halted: true }))).toBe('halted')
    expect(claimRefusal(await input({}, { status: 'skipped' }))).toBe('not_scheduled')
    expect(claimRefusal(await input({}, { status: 'canceled' }))).toBe('not_scheduled')
    expect(claimRefusal(await input({}, { sendState: 'sending' }))).toBe('already_claimed')
    expect(claimRefusal(await input({}, { sendState: 'unknown' }))).toBe('already_claimed')
    expect(claimRefusal(await input({}, { approvalState: 'pending' }))).toBe('not_approved')
    expect(claimRefusal(await input({}, { sendBy: now - 1 }))).toBe('expired')
    expect(claimRefusal(await input({}, { kind: 'consent_request' }))).toBe('kind')
  })

  it('refuses outside the window, too soon after another message, or over their 30-day cap', async () => {
    const i = await input()
    expect(claimRefusal({ ...i, contact: { ...i.contact, windowStart: 16 * 60, windowEnd: 20 * 60 } })).toBe('window')
    expect(claimRefusal(await input({ history: [now - 2 * 24 * HOUR] }))).toBe('too_soon')
    expect(claimRefusal({ ...i, contact: { ...i.contact, minDaysBetween: 1, maxPer30Days: 1 }, history: [now - 5 * 24 * HOUR] })).toBe('cap')
    expect(claimRefusal(await input({ contact: { ...i.contact, hasPhone: false } }))).toBe('no_phone')
  })

  it('holds the daily caps and the gap, and a bad setting cannot lift them', async () => {
    expect(claimRefusal(await input({ sentToday: 10 }))).toBe('daily_cap')
    expect(claimRefusal(await input({ sentToday: 20, dailyCap: 500 }))).toBe('daily_cap')
    expect(claimRefusal(await input({ siteToday: 200 }))).toBe('site_cap')
    expect(claimRefusal(await input({ lastClaimAt: now - 5 * MINUTE }))).toBe('gap')
    expect(claimRefusal(await input({ lastClaimAt: now - MINUTE, gapMs: 0 }))).toBe('gap')
    expect(claimRefusal(await input({ lastClaimAt: now - 10 * MINUTE }))).toBeNull()
  })
})

describe('approval notifications', () => {
  it('ask "Send to Sam?" with Send and Skip, a short preview and the approve page', () => {
    const push = approvalPush({ id: 'abc-123', contactName: 'Sam', body: `${'word '.repeat(60)}end`, token: 't', helperOffline: false })
    expect(push.title).toBe('Send to Sam?')
    expect(push.body.length).toBeLessThanOrEqual(120)
    expect(push.url).toBe('/approve/abc-123')
    expect(push.actions).toEqual([
      { action: 'send', title: 'Send' },
      { action: 'skip', title: 'Skip' },
    ])
    expect(push.approval).toEqual({ id: 'abc-123', token: 't' })
    expect(approvalPush({ id: 'a', contactName: 'Sam', body: 'Hi', token: 't', helperOffline: true }).body).toContain('Your helper is offline; you can still send it yourself.')
  })

  it('have their own push topic each, within 32 URL-safe characters', () => {
    const a = pushTopic(approvalPush({ id: '0f8c3a52-1b2c-4d5e-8f90-123456789abc', contactName: 'S', body: 'x', token: 't', helperOffline: false }))
    const b = pushTopic(approvalPush({ id: '1f8c3a52-1b2c-4d5e-8f90-123456789abc', contactName: 'S', body: 'x', token: 't', helperOffline: false }))
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]{1,32}$/)
    expect(pushTopic({ title: '', body: '', url: '/', tag: 'tend-reminder' })).toBe('tend-reminder')
  })

  it('say "Not sent: your PC was off" when an approval lapses', () => {
    expect(helperNoticePush('expired', { id: 'm', contactName: 'Sam' })).toMatchObject({ title: 'Not sent to Sam', body: 'Your PC was off. Send it yourself or reschedule.', url: '/send/m' })
  })
})
