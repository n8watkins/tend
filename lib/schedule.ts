/**
 * The frequency, window and consent rules (docs/SPEC.md section 8). Pure
 * functions: the server actions load a contact's history and call these at
 * schedule time.
 */

import type { ConsentState, MessageKind } from '@/lib/enums'
import { addLocalDays, DAY, localParts, MINUTE, zonedToUtc } from './time'

export interface ContactRules {
  timezone: string
  consent: ConsentState
  minDaysBetween: number
  maxPer30Days: number
  windowStart: number
  windowEnd: number
  allowedDays: number
}

/** Times (ms) of this contact's sent and still-scheduled messages, other than the one being placed. */
export type History = number[]

export const THIRTY_DAYS = 30 * DAY
const SLOT = 15 * MINUTE
const LEAD = 10 * MINUTE

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export type Refusal =
  | 'consent'
  | 'paused'
  | 'past'
  | 'day'
  | 'window'
  | 'too_soon'
  | 'cap'
  | 'open_request'
  | 'no_time'

export const REFUSAL_TEXT: Record<Refusal, string> = {
  consent: 'Their consent does not allow this kind of message.',
  paused: 'Tend is paused. Resume it in Settings to schedule messages.',
  past: 'That time has already passed.',
  day: 'That day is not one of their allowed days.',
  window: 'That time is outside their contact window.',
  too_soon: 'That is too soon after another message to them.',
  cap: 'That would go over their limit of messages in 30 days.',
  open_request: 'There is already a consent request waiting for them.',
  no_time: 'No good time in the next 60 days fits their rules.',
}

/** Which kinds of message a consent state allows. */
export function allowedKinds(consent: ConsentState): MessageKind[] {
  switch (consent) {
    case 'yes':
      return ['content', 'personal']
    case 'not_asked':
    case 'asked':
      return ['consent_request']
    default:
      return []
  }
}

export function inWindow(rules: ContactRules, at: number): Refusal | null {
  const p = localParts(at, rules.timezone)
  if (!(rules.allowedDays & (1 << p.weekday))) return 'day'
  if (p.minutes < rules.windowStart || p.minutes >= rules.windowEnd) return 'window'
  return null
}

/** True when adding `at` keeps every 30-day window that contains it within the cap. */
export function withinCap(max: number, history: History, at: number): boolean {
  const times = [...history, at].sort((a, b) => a - b)
  for (const end of times) {
    if (end < at || end - at >= THIRTY_DAYS) continue
    const count = times.filter((t) => t > end - THIRTY_DAYS && t <= end).length
    if (count > max) return false
  }
  // Windows that end later than every message but still contain `at` hold a
  // subset of the windows checked above, so they need no separate check.
  return true
}

export function tooSoon(minDays: number, history: History, at: number): boolean {
  return history.some((t) => Math.abs(t - at) < minDays * DAY)
}

/**
 * Checks a chosen time for a message of `kind`. Consent requests are exempt
 * from spacing and the cap (they are not content), but only one can be open.
 */
export function checkTime(
  rules: ContactRules,
  kind: MessageKind,
  history: History,
  at: number,
  now: number,
  opts: { paused?: boolean; openRequests?: number } = {},
): Refusal | null {
  if (opts.paused) return 'paused'
  if (!allowedKinds(rules.consent).includes(kind)) return 'consent'
  if (at < now - MINUTE) return 'past'
  const window = inWindow(rules, at)
  if (window) return window
  if (kind === 'consent_request') return (opts.openRequests ?? 0) > 0 ? 'open_request' : null
  if (tooSoon(rules.minDaysBetween, history, at)) return 'too_soon'
  if (!withinCap(rules.maxPer30Days, history, at)) return 'cap'
  return null
}

/**
 * The next good time for a content message: after the spacing rule, on an
 * allowed day, at a random 15-minute slot inside the window, within the cap.
 * Null when nothing fits in the next 60 days.
 */
export function nextGoodTime(
  rules: ContactRules,
  history: History,
  now: number,
  random: () => number = Math.random,
  kind: MessageKind = 'content',
): number | null {
  // Days that fail the spacing rule or the cap are skipped slot by slot below.
  const earliest = now + LEAD
  const start = localParts(earliest, rules.timezone)
  for (let offset = 0; offset < 60; offset++) {
    const date = addLocalDays(start.year, start.month, start.day, offset)
    if (!(rules.allowedDays & (1 << date.weekday))) continue
    const open = zonedToUtc(date.year, date.month, date.day, rules.windowStart, rules.timezone)
    const close = zonedToUtc(date.year, date.month, date.day, rules.windowEnd, rules.timezone)
    const from = Math.ceil(Math.max(open, earliest) / SLOT) * SLOT
    const slots = Math.floor((close - from) / SLOT)
    if (slots < 1) continue
    const order = shuffledSlots(slots, random)
    for (const slot of order) {
      const at = from + slot * SLOT
      if (kind === 'consent_request') return at
      if (!tooSoon(rules.minDaysBetween, history, at) && withinCap(rules.maxPer30Days, history, at)) return at
    }
  }
  return null
}

function shuffledSlots(count: number, random: () => number): number[] {
  const first = Math.min(count - 1, Math.floor(random() * count))
  const rest = Array.from({ length: count }, (_, i) => i).filter((i) => i !== first)
  return [first, ...rest]
}

/** "Mon to Fri" style summary of an allowedDays bitmask. */
export function describeDays(mask: number): string {
  if (mask === 127) return 'Every day'
  if (mask === 0b0111110) return 'Weekdays'
  if (mask === 0b1000001) return 'Weekends'
  return DAY_NAMES.filter((_, i) => mask & (1 << i)).join(', ') || 'No days'
}
