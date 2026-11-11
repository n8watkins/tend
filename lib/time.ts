/**
 * Time-zone arithmetic with Intl only (it runs the same on Workers and Node).
 * A "local date" is a calendar day in a given IANA zone; minutes count from
 * that day's local midnight.
 */

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export interface LocalParts {
  year: number
  month: number // 1 to 12
  day: number
  weekday: number // 0 = Sunday
  minutes: number // since local midnight
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    })
    formatters.set(timeZone, f)
  }
  return f
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

export function localParts(ms: number, timeZone: string): LocalParts {
  const parts: Record<string, string> = {}
  for (const p of formatter(timeZone).formatToParts(new Date(ms))) parts[p.type] = p.value
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAYS.indexOf(parts.weekday ?? 'Sun'),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

/** The zone's offset from UTC at an instant, in milliseconds (positive east of UTC). */
export function zoneOffset(ms: number, timeZone: string): number {
  const p = localParts(ms, timeZone)
  const seconds = new Date(ms).getUTCSeconds()
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, 0, p.minutes, seconds)
  return asUtc - (ms - (ms % 1000))
}

/**
 * The instant at which the wall clock in `timeZone` reads `minutes` after
 * midnight on year-month-day. Like Temporal's "compatible" rule: in a
 * fall-back overlap the earlier instant, and in a spring-forward gap the time
 * is moved forward by the gap (02:30 becomes 03:30).
 */
export function zonedToUtc(year: number, month: number, day: number, minutes: number, timeZone: string): number {
  const wall = Date.UTC(year, month - 1, day, 0, minutes)
  // A zone changes offset at most once in any 24 hours, so the offsets half a
  // day either side are the only two that can apply.
  const before = wall - zoneOffset(wall - 12 * HOUR, timeZone)
  const after = wall - zoneOffset(wall + 12 * HOUR, timeZone)
  const target = new Date(wall)
  const matches = (t: number) => {
    const p = localParts(t, timeZone)
    return (
      p.year === target.getUTCFullYear() &&
      p.month === target.getUTCMonth() + 1 &&
      p.day === target.getUTCDate() &&
      p.minutes === target.getUTCHours() * 60 + target.getUTCMinutes()
    )
  }
  const valid = [before, after].filter(matches)
  if (valid.length) return Math.min(...valid)
  return Math.max(before, after)
}

/** Adds whole calendar days to a local date. */
export function addLocalDays(year: number, month: number, day: number, days: number) {
  const d = new Date(Date.UTC(year, month - 1, day + days))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() }
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function parseMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 24 || m > 59 || (h === 24 && m > 0)) return null
  return h * 60 + m
}

/** "Tue 12 Nov, 14:30" in the given zone. */
export function formatWhen(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms))
}

export function formatDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(ms),
  )
}

/** The value for an <input type="datetime-local"> showing `ms` in `timeZone`. */
export function toLocalInput(ms: number, timeZone: string): string {
  const p = localParts(ms, timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(Math.floor(p.minutes / 60))}:${pad(p.minutes % 60)}`
}

/** Parses an <input type="datetime-local"> value as wall-clock time in `timeZone`. */
export function fromLocalInput(value: string, timeZone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number]
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null
  return zonedToUtc(y, mo, d, h * 60 + mi, timeZone)
}
