import { describe, expect, it } from 'vitest'

import { allowedKinds, checkTime, describeDays, nextGoodTime, withinCap, type ContactRules } from '@/lib/schedule'
import { DAY, localParts, zonedToUtc } from '@/lib/time'

const rules: ContactRules = {
  timezone: 'America/New_York',
  consent: 'yes',
  minDaysBetween: 7,
  maxPer30Days: 4,
  windowStart: 9 * 60,
  windowEnd: 20 * 60,
  allowedDays: 127,
}

// Tuesday 10 November 2026, 12:00 in New York.
const NOW = zonedToUtc(2026, 11, 10, 12 * 60, 'America/New_York')
const at = (day: number, minutes: number) => zonedToUtc(2026, 11, day, minutes, 'America/New_York')

describe('allowedKinds', () => {
  it('follows consent', () => {
    expect(allowedKinds('yes')).toEqual(['content', 'personal'])
    expect(allowedKinds('not_asked')).toEqual(['consent_request'])
    expect(allowedKinds('asked')).toEqual(['consent_request'])
    expect(allowedKinds('no')).toEqual([])
    expect(allowedKinds('stopped')).toEqual([])
  })
})

describe('checkTime', () => {
  it('accepts a time inside the window with no history', () => {
    expect(checkTime(rules, 'content', [], at(11, 10 * 60), NOW)).toBeNull()
  })

  it('refuses content without consent, and anything for no or stopped', () => {
    expect(checkTime({ ...rules, consent: 'asked' }, 'content', [], at(11, 600), NOW)).toBe('consent')
    expect(checkTime({ ...rules, consent: 'stopped' }, 'personal', [], at(11, 600), NOW)).toBe('consent')
    expect(checkTime({ ...rules, consent: 'no' }, 'consent_request', [], at(11, 600), NOW)).toBe('consent')
  })

  it('refuses quiet hours and disallowed days in the contact time zone', () => {
    expect(checkTime(rules, 'content', [], at(11, 21 * 60), NOW)).toBe('window')
    expect(checkTime(rules, 'content', [], at(11, 8 * 60 + 59), NOW)).toBe('window')
    // Weekdays only; 14 November 2026 is a Saturday.
    expect(checkTime({ ...rules, allowedDays: 0b0111110 }, 'content', [], at(14, 600), NOW)).toBe('day')
  })

  it('refuses the past, while paused, and too soon after another message', () => {
    expect(checkTime(rules, 'content', [], NOW - DAY, NOW)).toBe('past')
    expect(checkTime(rules, 'content', [], at(11, 600), NOW, { paused: true })).toBe('paused')
    expect(checkTime(rules, 'content', [at(8, 600)], at(11, 600), NOW)).toBe('too_soon')
    expect(checkTime(rules, 'content', [at(16, 600)], at(11, 600), NOW)).toBe('too_soon')
    expect(checkTime(rules, 'content', [at(3, 600)], at(11, 600), NOW)).toBeNull()
  })

  it('exempts consent requests from spacing but allows only one open', () => {
    const asked = { ...rules, consent: 'not_asked' as const }
    expect(checkTime(asked, 'consent_request', [at(11, 600)], at(11, 700), NOW)).toBeNull()
    expect(checkTime(asked, 'consent_request', [], at(11, 700), NOW, { openRequests: 1 })).toBe('open_request')
  })

  it('enforces the 30-day cap', () => {
    const loose = { ...rules, minDaysBetween: 1, maxPer30Days: 2 }
    expect(checkTime(loose, 'content', [at(1, 600), at(5, 600)], at(11, 600), NOW)).toBe('cap')
    expect(checkTime(loose, 'content', [at(1, 600)], at(11, 600), NOW)).toBeNull()
  })
})

describe('withinCap', () => {
  it('checks every 30-day window that contains the new time, including later ones', () => {
    const d = (n: number) => n * DAY
    // Days 0 and 45, adding 20: the windows ending at 20 and at 45 each hold two.
    expect(withinCap(2, [d(0), d(45)], d(20))).toBe(true)
    // Days 10 and 35, adding 30: the window ending at 35 holds 10, 30 and 35.
    expect(withinCap(2, [d(10), d(35)], d(30))).toBe(false)
    // An earlier window that does not contain the new time is not its problem.
    expect(withinCap(1, [d(0), d(1)], d(60))).toBe(true)
  })
})

describe('nextGoodTime', () => {
  it('lands inside the window, on a 15-minute slot, at least 10 minutes from now', () => {
    for (let i = 0; i < 20; i++) {
      const t = nextGoodTime(rules, [], NOW, () => i / 20)!
      const p = localParts(t, rules.timezone)
      expect(p.minutes).toBeGreaterThanOrEqual(rules.windowStart)
      expect(p.minutes).toBeLessThan(rules.windowEnd)
      expect(t % (15 * 60_000)).toBe(0)
      expect(t).toBeGreaterThanOrEqual(NOW + 10 * 60_000)
      expect(checkTime(rules, 'content', [], t, NOW)).toBeNull()
    }
  })

  it('waits out the spacing rule after the last message', () => {
    const t = nextGoodTime(rules, [at(9, 600)], NOW, () => 0)!
    expect(t).toBeGreaterThanOrEqual(at(16, 600))
    expect(checkTime(rules, 'content', [at(9, 600)], t, NOW)).toBeNull()
  })

  it('skips disallowed days', () => {
    const weekends = { ...rules, allowedDays: 0b1000001 }
    const t = nextGoodTime(weekends, [], NOW, () => 0)!
    expect([0, 6]).toContain(localParts(t, rules.timezone).weekday)
  })

  it('returns null when nothing fits', () => {
    expect(nextGoodTime({ ...rules, allowedDays: 0 }, [], NOW)).toBeNull()
  })

  it('places consent requests without spacing', () => {
    const asked = { ...rules, consent: 'not_asked' as const }
    const t = nextGoodTime(asked, [at(10, 11 * 60)], NOW, () => 0, 'consent_request')!
    expect(localParts(t, rules.timezone).day).toBe(10)
  })
})

describe('describeDays', () => {
  it('names common patterns', () => {
    expect(describeDays(127)).toBe('Every day')
    expect(describeDays(0b0111110)).toBe('Weekdays')
    expect(describeDays(0b1000001)).toBe('Weekends')
    expect(describeDays(0b0000110)).toBe('Mon, Tue')
  })
})
