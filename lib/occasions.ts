/**
 * Birthdays, anniversaries and "keep in touch" cadences (docs/SPEC.md section
 * 8, "Occasions and cadence"). Pure functions: the server loads contacts and
 * their history, these decide what is coming up and what is due.
 *
 * A date on a person is a month and day with an optional year, stored as
 * text the way vCard writes it: "1986-11-14", or "--11-14" without a year.
 * It is a calendar date in the person's own time zone: a birthday is "today"
 * when it is that day where they live.
 */

import type { MessageKind, SuggestMode } from './enums'
import type { ContentItem } from './item'
import { inWindow, nextGoodTime, type ContactRules, type History } from './schedule'
import { excludedIds, isoWeek, kindsFor, stableHash, type PastMessage } from './suggest'
import { DAY, localParts, MINUTE, zonedToUtc } from './time'

export const OCCASION_KINDS = ['birthday', 'anniversary'] as const
export type OccasionKind = (typeof OCCASION_KINDS)[number]

export const OCCASION_LABEL: Record<OccasionKind, string> = { birthday: 'Birthday', anniversary: 'Anniversary' }

/** How many days ahead the first reminder comes; 0 means only on the day. */
export const LEAD_DAY_CHOICES = [0, 1, 2, 3, 7, 14] as const
export const DEFAULT_LEAD_DAYS = 3

/** "Keep in touch" presets, in days; any whole number of days from 1 to 365 is allowed. */
export const CADENCE_CHOICES = [7, 14, 28, 56] as const
export const MAX_CADENCE_DAYS = 365

/** How far ahead Today and the person page look for birthdays and anniversaries. */
export const UPCOMING_DAYS = 14

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

export interface PartialDate {
  month: number // 1 to 12
  day: number // 1 to 31
  year: number | null
}

export interface LocalDate {
  year: number
  month: number
  day: number
}

const MIN_YEAR = 1900

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** True for a real calendar date; without a year, 29 February is allowed. */
export function isValidPartialDate(month: number, day: number, year: number | null, today?: LocalDate): boolean {
  if (!Number.isInteger(month) || month < 1 || month > 12) return false
  if (!Number.isInteger(day) || day < 1) return false
  if (year !== null) {
    if (!Number.isInteger(year) || year < MIN_YEAR || (today && year > today.year)) return false
    return day <= daysInMonth(year, month)
  }
  return day <= (month === 2 ? 29 : daysInMonth(2001, month))
}

/** Reads a stored date: "YYYY-MM-DD" or "--MM-DD". Null for anything else. */
export function parsePartialDate(value: string | null | undefined): PartialDate | null {
  const match = /^(?:(\d{4})|-)-(\d{2})-(\d{2})$/.exec(value?.trim() ?? '')
  if (!match) return null
  const year = match[1] ? Number(match[1]) : null
  const month = Number(match[2])
  const day = Number(match[3])
  return isValidPartialDate(month, day, year) ? { month, day, year } : null
}

export function formatPartialDate(date: PartialDate): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.year === null ? '-' : String(date.year)}-${pad(date.month)}-${pad(date.day)}`
}

/**
 * A date from the form's month, day and optional year fields: the stored
 * text, null when all are empty, or an error to show.
 */
export function dateFromFields(
  label: string,
  fields: { month?: unknown; day?: unknown; year?: unknown },
  today: LocalDate,
): { value: string | null } | { error: string } {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const [month, day, year] = [text(fields.month), text(fields.day), text(fields.year)]
  if (!month && !day && !year) return { value: null }
  if (!month || !day) return { error: `Choose both the month and the day of the ${label}.` }
  if (year && !/^\d{4}$/.test(year)) return { error: `Write the ${label} year with four digits, or leave it empty.` }
  const date = { month: Number(month), day: Number(day), year: year ? Number(year) : null }
  if (!isValidPartialDate(date.month, date.day, date.year, today)) return { error: `That ${label} is not a real date.` }
  return { value: formatPartialDate(date) }
}

/**
 * "Last in touch" from an <input type="date">: null when empty, an error for
 * a date that is not real or is after `today`, else the moment to store
 * (midday that day in their zone, or `now` if that is still to come).
 */
export function lastInTouchFromInput(
  value: unknown,
  timeZone: string,
  today: LocalDate,
  now: number,
): { value: number | null; date: string } | { error: string } {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return { value: null, date: '' }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const date = match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null
  if (!date || !isValidPartialDate(date.month, date.day, date.year, today) || daysBetween(date, today) < 0) {
    return { error: 'Choose a day in the past for when you were last in touch.' }
  }
  return { value: Math.min(now, zonedToUtc(date.year, date.month, date.day, 12 * 60, timeZone)), date: text }
}

/** The <input type="date"> value for a stored "last in touch", in their zone. */
export function lastInTouchInput(contact: { lastInTouchAt: number | null; timezone: string }): string {
  return contact.lastInTouchAt === null ? '' : isoDate(localToday(contact.lastInTouchAt, contact.timezone))
}

/** "14 November", or "14 November 1986" with a year. */
export function describePartialDate(date: PartialDate): string {
  return `${date.day} ${MONTH_NAMES[date.month - 1]}${date.year === null ? '' : ` ${date.year}`}`
}

/** The occasion's date in a given year: 29 February falls on 28 February in common years. */
export function occurrenceIn(date: PartialDate, year: number): LocalDate {
  if (date.month === 2 && date.day === 29 && !isLeap(year)) return { year, month: 2, day: 28 }
  return { year, month: date.month, day: date.day }
}

function toUtcDay(d: LocalDate): number {
  return Date.UTC(d.year, d.month - 1, d.day)
}

/** Whole days from `a` to `b` (negative when b is earlier). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((toUtcDay(b) - toUtcDay(a)) / DAY)
}

/** The next time the occasion comes round, on or after `from`. */
export function nextOccurrence(date: PartialDate, from: LocalDate): LocalDate {
  const thisYear = occurrenceIn(date, from.year)
  return daysBetween(from, thisYear) >= 0 ? thisYear : occurrenceIn(date, from.year + 1)
}

export function isoDate(d: LocalDate): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

/** Today's calendar date in a time zone. */
export function localToday(now: number, timeZone: string): LocalDate {
  const p = localParts(now, timeZone)
  return { year: p.year, month: p.month, day: p.day }
}

export interface Upcoming {
  kind: OccasionKind
  date: LocalDate
  /** 0 on the day itself, in the person's time zone. */
  daysAway: number
  /** The age they turn or the years together, when the year is known. */
  years: number | null
}

/** When the occasion next comes round where the person lives. */
export function upcoming(kind: OccasionKind, date: PartialDate, now: number, timeZone: string): Upcoming {
  const today = localToday(now, timeZone)
  const next = nextOccurrence(date, today)
  return {
    kind,
    date: next,
    daysAway: daysBetween(today, next),
    years: date.year === null ? null : next.year - date.year,
  }
}

/** "today", "tomorrow", "in 3 days". */
export function describeDaysAway(daysAway: number): string {
  if (daysAway === 0) return 'today'
  if (daysAway === 1) return 'tomorrow'
  return `in ${daysAway} days`
}

/** "Birthday today (turns 40)", "Anniversary in 3 days (12 years)". */
export function describeUpcoming(u: Upcoming): string {
  const extra = u.years === null || u.years <= 0 ? '' : u.kind === 'birthday' ? ` (turns ${u.years})` : ` (${u.years} ${u.years === 1 ? 'year' : 'years'})`
  return `${OCCASION_LABEL[u.kind]} ${describeDaysAway(u.daysAway)}${extra}`
}

export type OccasionWhen = 'ahead' | 'day'

export interface OccasionNudge {
  kind: OccasionKind
  when: OccasionWhen
  daysAway: number
  /** Unique per contact: a reminder with the same key is never sent twice. */
  key: string
}

/**
 * The occasion reminder due at `now`, if any: on the day itself, and from
 * `leadDays` before it (a run that missed the first day still sends it the
 * next). Only inside the person's contact window, so it arrives at a moment
 * you could message them; their allowed weekdays do not apply, since a
 * birthday falls when it falls.
 */
export function occasionNudge(
  kind: OccasionKind,
  date: PartialDate,
  rules: Pick<ContactRules, 'timezone' | 'windowStart' | 'windowEnd'>,
  leadDays: number,
  now: number,
): OccasionNudge | null {
  const minutes = localParts(now, rules.timezone).minutes
  if (minutes < rules.windowStart || minutes >= rules.windowEnd) return null
  const u = upcoming(kind, date, now, rules.timezone)
  const on = isoDate(u.date)
  if (u.daysAway === 0) return { kind, when: 'day', daysAway: 0, key: `${kind}:${on}:day` }
  if (leadDays > 0 && u.daysAway <= leadDays) return { kind, when: 'ahead', daysAway: u.daysAway, key: `${kind}:${on}:ahead` }
  return null
}

/* Keep in touch -------------------------------------------------------------- */

/** "Every week", "Every 2 weeks", "Every 10 days". */
export function describeCadence(days: number): string {
  if (days === 7) return 'Every week'
  if (days % 7 === 0) return `Every ${days / 7} weeks`
  return days === 1 ? 'Every day' : `Every ${days} days`
}

/** The last time you were in touch: the later of a message marked sent and a moment you recorded. */
export function lastInTouch(recorded: number | null, sentTimes: number[]): number | null {
  const all = [...sentTimes, ...(recorded === null ? [] : [recorded])]
  return all.length ? Math.max(...all) : null
}

/**
 * When it is next time to reach out: `cadenceDays` after you were last in
 * touch (or after you added them, if never), moved to the first slot that
 * their contact window, allowed days, spacing and 30-day cap allow. With
 * nothing in the next 60 days, the plain date.
 */
export function cadenceDueAt(rules: ContactRules, cadenceDays: number, last: number | null, createdAt: number, history: History): number {
  const base = (last ?? createdAt) + cadenceDays * DAY
  // nextGoodTime starts 10 minutes after "now"; the first slot (random 0) is the earliest.
  return nextGoodTime(rules, history, base - 10 * MINUTE, () => 0) ?? base
}

export interface CadenceNudge {
  dueAt: number
  key: string
}

/**
 * The keep-in-touch reminder due at `now`, if any: once the due time has
 * passed and while their contact window is open on an allowed day. One per
 * due date: being in touch moves the date, and with it the key.
 */
export function cadenceNudge(rules: ContactRules, dueAt: number, now: number): CadenceNudge | null {
  if (now < dueAt || inWindow(rules, now)) return null
  return { dueAt, key: `cadence:${isoDate(localToday(dueAt, rules.timezone))}` }
}

/* Suggestions ----------------------------------------------------------------- */

/**
 * Hand-picked library items for each occasion, best first: blessings for a
 * birthday, passages about love and companionship for an anniversary. Every
 * id here is in content/library.json (a unit test checks).
 */
export const OCCASION_PICKS: Record<OccasionKind, string[]> = {
  birthday: [
    'numbers-6-24-26',
    '3-john-1-2',
    'psalm-118-24',
    'romans-15-13',
    'jeremiah-29-11',
    'philippians-1-3',
    'thoreau-morning-star',
    'aurelius-happy-life',
  ],
  anniversary: ['1-corinthians-13-4-7', 'ecclesiastes-4-9-10', '1-john-4-7', 'romans-12-10', 'numbers-6-24-26', 'philippians-1-3'],
}

/**
 * Quotes that suit an occasion beyond the hand-picked ones: anything tagged
 * for birthdays, or about love and friendship for an anniversary, never a
 * line about loss, in the tone that fits (light first for a birthday,
 * tender first for an anniversary).
 */
function occasionQuote(kind: OccasionKind, item: ContentItem): boolean {
  if (item.kind !== 'quote' || item.occasions?.includes('grief')) return false
  return kind === 'birthday'
    ? Boolean(item.occasions?.includes('birthday'))
    : item.topics.some((t) => t === 'love' || t === 'friendship')
}
const TONE_ORDER: Record<OccasionKind, string[]> = { birthday: ['light', 'steady', 'tender'], anniversary: ['tender', 'steady', 'light'] }

export interface OccasionPickOptions {
  limit?: number
  /** What the sender chose to suggest for this person; "Just my words" gives none. */
  mode?: SuggestMode
  /** Varies the quotes week to week for this person. */
  contactId?: string
  /** Quote ids sent or scheduled to the user's other contacts in the last 90 days: offered last. */
  elsewhere?: ReadonlySet<string>
}

/**
 * The occasion's picks for this person, following "What to suggest": the
 * hand-picked passages, then quotes for the occasion; a mix alternates them.
 * Never one the no-repeat rules exclude (lib/suggest.ts).
 */
export function occasionPicks(
  library: ContentItem[],
  kind: OccasionKind,
  past: PastMessage[],
  now: number,
  { limit = 3, mode = 'mix', contactId = '', elsewhere }: OccasionPickOptions = {},
): ContentItem[] {
  const kinds = kindsFor(mode)
  const excluded = excludedIds(past, now, library)
  const byId = new Map(library.map((item) => [item.id, item]))
  const handPicked = OCCASION_PICKS[kind].map((id) => byId.get(id)).filter((item): item is ContentItem => Boolean(item))
  const week = isoWeek(now)
  const tone = (item: ContentItem) => {
    const at = TONE_ORDER[kind].indexOf(item.kind === 'quote' ? (item.tone ?? '') : '')
    return at < 0 ? TONE_ORDER[kind].length : at
  }
  const tagged = library
    .filter((item) => occasionQuote(kind, item) && !handPicked.includes(item))
    .map((item) => ({ item, tone: tone(item), tie: stableHash(`${contactId}:${item.id}:${week}`) }))
    .sort((a, b) => a.tone - b.tone || a.tie - b.tie)
    .map((s) => s.item)
  const usable = (item: ContentItem) => kinds.includes(item.kind) && !excluded.has(item.id)
  const fresh = (items: ContentItem[]) =>
    elsewhere?.size ? [...items.filter((i) => !elsewhere.has(i.id)), ...items.filter((i) => elsewhere.has(i.id))] : items
  const passages = handPicked.filter((item) => item.kind === 'scripture' && usable(item))
  const quotes = fresh([...handPicked.filter((item) => item.kind === 'quote'), ...tagged].filter(usable))
  // A mix alternates, a passage first: blessing, quote, blessing...
  const picks: ContentItem[] = []
  for (let i = 0; picks.length < limit && (i < passages.length || i < quotes.length); i++) {
    if (passages[i]) picks.push(passages[i]!)
    if (quotes[i] && picks.length < limit) picks.push(quotes[i]!)
  }
  return picks
}

/**
 * The earliest good time on the occasion's own day (the start of their
 * contact window, or the next slot if that has passed), when their rules
 * allow one; otherwise null and compose falls back to the next good time.
 */
export function occasionSlot(rules: ContactRules, history: History, date: LocalDate, now: number, kind: MessageKind = 'content'): number | null {
  const dayStart = zonedToUtc(date.year, date.month, date.day, 0, rules.timezone)
  const at = nextGoodTime(rules, history, Math.max(now, dayStart - 10 * MINUTE), () => 0, kind)
  if (at === null) return null
  return isoDate(localToday(at, rules.timezone)) === isoDate(date) ? at : null
}

/* Reminder wording -------------------------------------------------------------- */

export type NudgeKind = OccasionKind | 'cadence'

/** One occasion or keep-in-touch reminder, as the email, push and Telegram show it. */
export interface NudgeLine {
  kind: NudgeKind
  contactName: string
  /** For birthdays and anniversaries: 0 on the day. */
  daysAway: number
  /** The page the reminder opens. */
  path: string
}

/** "It's Sam's birthday today", "Sam's anniversary is in 3 days", "Time to reach out to Sam". */
export function nudgeTitle(n: Pick<NudgeLine, 'kind' | 'contactName' | 'daysAway'>): string {
  if (n.kind === 'cadence') return `Time to reach out to ${n.contactName}`
  if (n.daysAway === 0) return `It's ${n.contactName}'s ${n.kind} today`
  return `${n.contactName}'s ${n.kind} is ${describeDaysAway(n.daysAway)}`
}

/** The first line of a message for the occasion: "Happy birthday, Sam!" */
export function occasionGreeting(kind: OccasionKind, name: string): string {
  const first = name.trim().split(/\s+/)[0] || name
  return kind === 'birthday' ? `Happy birthday, ${first}!` : `Happy anniversary, ${first}!`
}

/**
 * The opening of an occasion message: the greeting, then the starter when one
 * was chosen, unless the starter already says "Happy birthday" itself.
 */
export function occasionNote(kind: OccasionKind, name: string, starter?: string): string {
  const greeting = occasionGreeting(kind, name)
  if (!starter) return greeting
  return new RegExp(kind, 'i').test(starter) ? starter : `${greeting} ${starter}`
}
