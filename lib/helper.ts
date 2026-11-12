/**
 * The Signal helper's rules that need no database (docs/SIGNAL-HELPER.md):
 * the approval and send state machine, the limits, device tokens, pairing
 * codes, approval tokens for push buttons, and the checks a claim must pass.
 * lib/server/helper.ts applies them to the database; the tests cover them
 * directly.
 */

import type { ApprovalState, ConsentState, MessageKind, MessageStatus, SendState } from './enums'
import { checkTime, inWindow, type ContactRules, type History, type Refusal } from './schedule'
import { HOUR, localParts, MINUTE, zonedToUtc } from './time'

/* Limits (SIGNAL-HELPER.md 2 and 4.2; phase 1 has no auto-send) ------------- */

export const HELPER_LIMITS = {
  /** The helper polls this often. */
  pollSeconds: 30,
  /** A claim's lease: no result by then and the send is "unknown". */
  leaseMs: 10 * MINUTE,
  /** Seen within this, the helper is "online". */
  onlineMs: 2 * MINUTE,
  /** Not seen for this long, approval pushes say the helper is offline. */
  offlineNoticeMs: 10 * MINUTE,
  /** An approval is good for at most this long, and never past the contact's window. */
  lateMs: 2 * HOUR,
  /** Helper sends a day per user (rolling 24 hours), and the most it can ever be set to. */
  dailyCap: 10,
  dailyMax: 20,
  /** The gap between any two helper sends, and the least it can ever be. */
  gapMs: 10 * MINUTE,
  gapMinMs: 2 * MINUTE,
  /** Helper sends a day across all of Tend. */
  siteDaily: 200,
  /** Pairing codes. */
  pairCodeTtlMs: 10 * MINUTE,
  /** Approval tokens in push notifications. */
  approvalTokenTtlMs: 12 * HOUR,
  /** Calls a device token may make in an hour (a poll every 30 seconds is 120). */
  callsPerHour: 300,
  /** Unauthorized calls from one address in an hour before it is refused outright. */
  badTokensPerHour: 30,
  /** Helpers older than this are told to update and stop sending. */
  minHelperVersion: '0.1.0',
} as const

/** A configured cap, clamped so no setting can go past the hard maximum (or below the minimum gap). */
export function clampDaily(value: number): number {
  return Math.max(0, Math.min(HELPER_LIMITS.dailyMax, Math.floor(value)))
}

export function clampGap(value: number): number {
  return Math.max(HELPER_LIMITS.gapMinMs, value)
}

/* The state machine (SIGNAL-HELPER.md 2.4) ----------------------------------- */

export interface HelperState {
  approval: ApprovalState
  send: SendState
}

export type HelperAction =
  /** The cron asks the user (a push with Send and Skip). */
  | 'request'
  /** The user taps Send: the helper may send this exact text. */
  | 'approve'
  /** The user skips it. */
  | 'skip'
  /** Nobody claimed it before sendBy: back to the manual path. */
  | 'expire'
  /** The helper leases it, after every rule passed again. */
  | 'claim'
  /** The helper's reports. "unknown" when it crashed between send and report. */
  | 'sent'
  | 'failed'
  | 'unknown'
  /** The lease ran out with no report. */
  | 'lease_expired'
  /** "Send it again" after failed or unknown: a new, explicit approval. */
  | 'retry'
  /** "It was sent": the user checked their Signal chat. */
  | 'confirm_sent'
  /** The helper was removed or turned off: approvals not yet claimed lapse. */
  | 'withdraw'

interface Rule {
  from: { approval?: readonly ApprovalState[]; send: readonly SendState[] }
  to: Partial<HelperState>
}

export const TRANSITIONS: Record<HelperAction, Rule> = {
  request: { from: { approval: ['none'], send: ['idle'] }, to: { approval: 'pending' } },
  approve: { from: { approval: ['none', 'pending', 'expired'], send: ['idle'] }, to: { approval: 'approved' } },
  skip: { from: { approval: ['none', 'pending', 'approved', 'expired'], send: ['idle', 'failed'] }, to: { approval: 'skipped', send: 'idle' } },
  expire: { from: { approval: ['approved'], send: ['idle'] }, to: { approval: 'expired' } },
  claim: { from: { approval: ['approved'], send: ['idle'] }, to: { send: 'sending' } },
  // A late report after the lease ran out still tells the truth, so unknown can become sent or failed.
  sent: { from: { send: ['sending', 'unknown'] }, to: { send: 'sent' } },
  failed: { from: { send: ['sending', 'unknown'] }, to: { send: 'failed' } },
  unknown: { from: { send: ['sending'] }, to: { send: 'unknown' } },
  lease_expired: { from: { send: ['sending'] }, to: { send: 'unknown' } },
  retry: { from: { send: ['failed', 'unknown'] }, to: { approval: 'approved', send: 'idle' } },
  confirm_sent: { from: { send: ['unknown'] }, to: { send: 'sent' } },
  withdraw: { from: { approval: ['pending', 'approved'], send: ['idle'] }, to: { approval: 'expired' } },
}

/** The next state, or null when the action is not allowed from this one. */
export function transition(state: HelperState, action: HelperAction): HelperState | null {
  const rule = TRANSITIONS[action]
  if (rule.from.approval && !rule.from.approval.includes(state.approval)) return null
  if (!rule.from.send.includes(state.send)) return null
  return { ...state, ...rule.to }
}

/** "I sent it", skip and reschedule by hand are refused only while the helper is sending. */
export function manualChangeAllowed(send: SendState): boolean {
  return send !== 'sending'
}

/* Tokens and codes ------------------------------------------------------------ */

function b64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** SHA-256 as base64url. */
export async function sha256(value: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}

/** The hash an approval binds to: any change to the text needs a new approval. */
export function bodyHash(body: string): Promise<string> {
  return sha256(`tend-body-v1:${body}`)
}

export const DEVICE_TOKEN_PREFIX = 'tdh_'
const DEVICE_TOKEN = /^tdh_[A-Za-z0-9_-]{43}$/

/** 32 random bytes, prefixed so it is recognisable (and scannable) as a Tend helper token. */
export function newDeviceToken(): string {
  return `${DEVICE_TOKEN_PREFIX}${b64url(crypto.getRandomValues(new Uint8Array(32)))}`
}

export function isDeviceToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && DEVICE_TOKEN.test(value)
}

/** The token from an `Authorization: Bearer tdh_...` header, or null. */
export function bearerDeviceToken(header: string | null | undefined): string | null {
  const match = /^Bearer (\S+)$/.exec(header ?? '')
  return match && isDeviceToken(match[1]) ? match[1]! : null
}

// No 0/O, 1/I/L or U: easy to read aloud and to type from a phone screen.
const PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
export const PAIR_CODE_LENGTH = 8

/** A one-time pairing code: 8 characters (about 39 bits), unbiased. */
export function newPairCode(): string {
  const out: string[] = []
  const limit = 256 - (256 % PAIR_ALPHABET.length)
  while (out.length < PAIR_CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit && out.length < PAIR_CODE_LENGTH) out.push(PAIR_ALPHABET[byte % PAIR_ALPHABET.length]!)
    }
  }
  return out.join('')
}

/** What the user typed, as a code: any case, with or without the dash and spaces. Null when it cannot be one. */
export function normalizePairCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '')
  if (code.length !== PAIR_CODE_LENGTH) return null
  for (const c of code) if (!PAIR_ALPHABET.includes(c)) return null
  return code
}

export function formatPairCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/* Who may use the helper (private to the owner for now) ------------------------ */

/**
 * SIGNAL_HELPER_USERS: email addresses, separated by commas or spaces. An
 * entry starting with "@" allows a whole domain. Empty: nobody.
 */
export function helperAllowed(email: string | null | undefined, list: string | undefined): boolean {
  if (!email || !list) return false
  const address = email.trim().toLowerCase()
  return list
    .split(/[\s,]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => (entry.startsWith('@') ? address.endsWith(entry) && address.length > entry.length : address === entry))
}

/* Approval tokens for the push buttons (SIGNAL-HELPER.md 3.1) ------------------- */

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(`tend-approval-v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

async function approvalSignature(secret: string, messageId: string, hash: string, expiresAt: number): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(`${messageId}|${hash}|${expiresAt}`))
  return b64url(new Uint8Array(sig))
}

/** A token that lets a notification's buttons act on this message, with this text, until it expires. */
export async function signApproval(secret: string, messageId: string, hash: string, expiresAt: number): Promise<string> {
  return `${expiresAt}.${await approvalSignature(secret, messageId, hash, expiresAt)}`
}

export async function verifyApproval(secret: string, token: string, messageId: string, hash: string, now: number): Promise<boolean> {
  const match = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(token)
  if (!match) return false
  const expiresAt = Number(match[1])
  if (!(expiresAt > now) || expiresAt - now > HELPER_LIMITS.approvalTokenTtlMs) return false
  const expected = await approvalSignature(secret, messageId, hash, expiresAt)
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ match[2]!.charCodeAt(i)
  return diff === 0
}

/* Timing ---------------------------------------------------------------------- */

/**
 * The latest the helper may claim a message approved at `approvedAt`: the end
 * of the contact's window that day in their time zone, and never more than
 * two hours after the approval (no late backlog). Null when `approvedAt` is
 * outside their window, so it cannot be approved for the helper just now.
 */
export function sendByFor(rules: Pick<ContactRules, 'timezone' | 'windowStart' | 'windowEnd' | 'allowedDays'>, approvedAt: number): number | null {
  if (inWindow(rules as ContactRules, approvedAt)) return null
  const p = localParts(approvedAt, rules.timezone)
  const windowEnd = zonedToUtc(p.year, p.month, p.day, rules.windowEnd, rules.timezone)
  return Math.min(windowEnd, approvedAt + HELPER_LIMITS.lateMs)
}

export function helperOnline(lastSeenAt: number | null | undefined, now: number): boolean {
  return Boolean(lastSeenAt && now - lastSeenAt <= HELPER_LIMITS.onlineMs)
}

/** Compares dotted versions: is `version` at least `min`? Unparseable versions are too old. */
export function versionAtLeast(version: string | null | undefined, min: string): boolean {
  const parse = (v: string) => (/^\d+(\.\d+){0,2}$/.test(v) ? v.split('.').map(Number) : null)
  const a = parse(version ?? '')
  const b = parse(min)!
  if (!a) return false
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return true
}

/* The checks at claim (SIGNAL-HELPER.md 2.4, step 2) ----------------------------- */

export type ClaimRefusal =
  | 'not_scheduled'
  | 'kind'
  | 'not_approved'
  | 'already_claimed'
  | 'body_changed'
  | 'expired'
  | 'consent'
  | 'paused'
  | 'halted'
  | 'no_phone'
  | 'daily_cap'
  | 'site_cap'
  | 'gap'
  | Exclude<Refusal, 'consent' | 'paused' | 'past' | 'open_request' | 'no_time'>

export interface ClaimInput {
  now: number
  message: {
    status: MessageStatus
    kind: MessageKind
    body: string
    approvalState: ApprovalState
    sendState: SendState
    approvedBodyHash: string | null
    sendBy: number | null
  }
  /** bodyHash(message.body), computed by the caller. */
  currentBodyHash: string
  contact: ContactRules & { consent: ConsentState; hasPhone: boolean }
  /** Sent and scheduled times for this contact, other than this message. */
  history: History
  paused: boolean
  halted: boolean
  sentToday: number
  dailyCap: number
  siteToday: number
  siteCap: number
  lastClaimAt: number | null
  gapMs: number
}

/**
 * Every rule, again, at the moment the helper wants to send: the approval is
 * for this exact text and still in time, consent is still yes, nothing is
 * paused or halted, the contact's window, spacing and 30-day cap hold now,
 * and the helper's own daily caps and gap hold. Null means it may be claimed.
 */
export function claimRefusal(input: ClaimInput): ClaimRefusal | null {
  const { message: m, contact, now } = input
  if (m.status !== 'scheduled') return 'not_scheduled'
  if (m.kind === 'consent_request') return 'kind'
  if (m.sendState !== 'idle') return 'already_claimed'
  if (m.approvalState !== 'approved') return 'not_approved'
  if (!m.approvedBodyHash || m.approvedBodyHash !== input.currentBodyHash) return 'body_changed'
  if (!m.sendBy || now > m.sendBy) return 'expired'
  if (contact.consent !== 'yes') return 'consent'
  if (input.paused) return 'paused'
  if (input.halted) return 'halted'
  if (!contact.hasPhone) return 'no_phone'
  const rules = checkTime(contact, m.kind, input.history, now, now)
  if (rules) return rules as ClaimRefusal
  if (input.sentToday >= clampDaily(input.dailyCap)) return 'daily_cap'
  if (input.siteToday >= input.siteCap) return 'site_cap'
  if (input.lastClaimAt !== null && now - input.lastClaimAt < clampGap(input.gapMs)) return 'gap'
  return null
}

/** Refusals that clear by themselves; the helper just tries again later, and they are not logged as events. */
export const WAIT_REFUSALS: ReadonlySet<ClaimRefusal> = new Set(['gap', 'daily_cap', 'site_cap'])

/** Failure reasons a helper may report (anything else is stored as "other"). */
export const FAILURE_REASONS = ['challenge', 'unlinked', 'unregistered', 'identity', 'network', 'rate_limit', 'late', 'local_cap', 'not_in_contacts', 'signal_cli', 'other'] as const
export type FailureReason = (typeof FAILURE_REASONS)[number]

export const FAILURE_TEXT: Record<FailureReason, string> = {
  challenge: 'Signal asked for a captcha, so your helper stopped sending.',
  unlinked: 'Your helper is no longer linked to your Signal account.',
  unregistered: 'This number is not on Signal.',
  identity: 'Their safety number changed. Check it in Signal first.',
  network: 'Your PC could not reach Signal.',
  rate_limit: 'Signal is limiting sends just now.',
  late: 'It was too late to send by the time your helper saw it.',
  local_cap: 'Your helper reached its own daily limit.',
  not_in_contacts: 'This number is not in your Signal contacts.',
  signal_cli: 'signal-cli reported an error.',
  other: 'Something went wrong on your PC.',
}

export function failureReason(value: unknown): FailureReason {
  return (FAILURE_REASONS as readonly unknown[]).includes(value) ? (value as FailureReason) : 'other'
}
