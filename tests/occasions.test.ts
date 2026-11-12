import { describe, expect, it } from 'vitest'

import { LIBRARY } from '@/lib/content'
import {
  cadenceDueAt,
  cadenceNudge,
  dateFromFields,
  describeCadence,
  describeUpcoming,
  lastInTouch,
  lastInTouchFromInput,
  nextOccurrence,
  nudgeTitle,
  OCCASION_PICKS,
  occasionGreeting,
  occasionNudge,
  occasionPicks,
  occasionSlot,
  parsePartialDate,
  formatPartialDate,
  upcoming,
} from '@/lib/occasions'
import { reminderPush } from '@/lib/push'
import type { ContactRules } from '@/lib/schedule'
import { nudgeText } from '@/lib/telegram'
import { DAY, localParts, zonedToUtc } from '@/lib/time'

const NY = 'America/New_York'
const rules: ContactRules = {
  timezone: NY,
  consent: 'yes',
  minDaysBetween: 7,
  maxPer30Days: 4,
  windowStart: 9 * 60,
  windowEnd: 20 * 60,
  allowedDays: 127,
}
const ny = (month: number, day: number, minutes: number, year = 2026) => zonedToUtc(year, month, day, minutes, NY)

describe('partial dates', () => {
  it('reads and writes dates with and without a year', () => {
    expect(parsePartialDate('1986-11-14')).toEqual({ month: 11, day: 14, year: 1986 })
    expect(parsePartialDate('--02-29')).toEqual({ month: 2, day: 29, year: null })
    expect(formatPartialDate({ month: 2, day: 29, year: null })).toBe('--02-29')
    expect(formatPartialDate({ month: 7, day: 4, year: 1990 })).toBe('1990-07-04')
  })

  it('refuses dates that do not exist', () => {
    expect(parsePartialDate('2023-02-29')).toBeNull()
    expect(parsePartialDate('--04-31')).toBeNull()
    expect(parsePartialDate('--13-01')).toBeNull()
    expect(parsePartialDate('14/11/1986')).toBeNull()
    expect(parsePartialDate(null)).toBeNull()
  })

  it('reads the form fields', () => {
    const today = { year: 2026, month: 11, day: 11 }
    expect(dateFromFields('birthday', { month: '', day: '', year: '' }, today)).toEqual({ value: null })
    expect(dateFromFields('birthday', { month: '11', day: '14', year: '' }, today)).toEqual({ value: '--11-14' })
    expect(dateFromFields('birthday', { month: '2', day: '29', year: '2024' }, today)).toEqual({ value: '2024-02-29' })
    expect(dateFromFields('birthday', { month: '2', day: '29', year: '2023' }, today)).toHaveProperty('error')
    expect(dateFromFields('birthday', { month: '11', day: '', year: '' }, today)).toHaveProperty('error')
    expect(dateFromFields('birthday', { month: '11', day: '14', year: '86' }, today)).toHaveProperty('error')
    expect(dateFromFields('birthday', { month: '11', day: '14', year: '2031' }, today)).toHaveProperty('error')
  })
})

describe('when an occasion comes round', () => {
  it('moves 29 February to the 28th in common years', () => {
    const leap = { month: 2, day: 29, year: 2000 }
    expect(nextOccurrence(leap, { year: 2027, month: 1, day: 1 })).toEqual({ year: 2027, month: 2, day: 28 })
    expect(nextOccurrence(leap, { year: 2028, month: 1, day: 1 })).toEqual({ year: 2028, month: 2, day: 29 })
  })

  it('rolls over to next year once the day has passed', () => {
    expect(nextOccurrence({ month: 1, day: 5, year: null }, { year: 2026, month: 11, day: 11 })).toEqual({ year: 2027, month: 1, day: 5 })
    expect(nextOccurrence({ month: 11, day: 11, year: null }, { year: 2026, month: 11, day: 11 })).toEqual({ year: 2026, month: 11, day: 11 })
  })

  it('counts days in the person’s own time zone', () => {
    // 03:00 UTC on 14 November: already the 14th in UTC and Auckland, still the 13th in New York.
    const now = Date.UTC(2026, 10, 14, 3)
    const date = { month: 11, day: 14, year: 1986 }
    expect(upcoming('birthday', date, now, 'UTC').daysAway).toBe(0)
    expect(upcoming('birthday', date, now, 'Pacific/Auckland').daysAway).toBe(0)
    expect(upcoming('birthday', date, now, NY).daysAway).toBe(1)
    expect(upcoming('birthday', date, now, NY).years).toBe(40)
    // 11:00 UTC on 14 November is already the 15th in Kiritimati (UTC+14): next year.
    expect(upcoming('birthday', date, Date.UTC(2026, 10, 14, 11), 'Pacific/Kiritimati').daysAway).toBe(364)
  })

  it('describes it', () => {
    expect(describeUpcoming({ kind: 'birthday', date: { year: 2026, month: 11, day: 14 }, daysAway: 0, years: 40 })).toBe('Birthday today (turns 40)')
    expect(describeUpcoming({ kind: 'anniversary', date: { year: 2026, month: 11, day: 14 }, daysAway: 3, years: 12 })).toBe('Anniversary in 3 days (12 years)')
    expect(describeUpcoming({ kind: 'birthday', date: { year: 2026, month: 11, day: 14 }, daysAway: 1, years: null })).toBe('Birthday tomorrow')
  })
})

describe('occasionNudge', () => {
  const birthday = { month: 11, day: 14, year: null }

  it('reminds on the day, inside their contact window only', () => {
    expect(occasionNudge('birthday', birthday, rules, 3, ny(11, 14, 8 * 60))).toBeNull()
    expect(occasionNudge('birthday', birthday, rules, 3, ny(11, 14, 9 * 60))).toEqual({
      kind: 'birthday',
      when: 'day',
      daysAway: 0,
      key: 'birthday:2026-11-14:day',
    })
    expect(occasionNudge('birthday', birthday, rules, 3, ny(11, 14, 20 * 60))).toBeNull()
  })

  it('reminds from the lead day on, once, with its own key', () => {
    expect(occasionNudge('birthday', birthday, rules, 3, ny(11, 10, 12 * 60))).toBeNull()
    expect(occasionNudge('birthday', birthday, rules, 3, ny(11, 11, 12 * 60))?.key).toBe('birthday:2026-11-14:ahead')
    // A missed first day still sends it the next (the key keeps it to one).
    expect(occasionNudge('birthday', birthday, rules, 3, ny(11, 13, 12 * 60))).toMatchObject({ when: 'ahead', daysAway: 1, key: 'birthday:2026-11-14:ahead' })
  })

  it('with no lead days, only on the day', () => {
    expect(occasionNudge('birthday', birthday, rules, 0, ny(11, 13, 12 * 60))).toBeNull()
  })

  it('follows their zone, not the server’s', () => {
    // 12:00 UTC on 14 November is 07:00 in New York: before the window opens.
    expect(occasionNudge('birthday', birthday, rules, 0, Date.UTC(2026, 10, 14, 12))).toBeNull()
    // 01:00 UTC on 15 November is 20:00 on the 14th in New York: the window has closed.
    expect(occasionNudge('birthday', birthday, rules, 0, Date.UTC(2026, 10, 15, 1))).toBeNull()
    // 23:00 UTC on 14 November is 18:00 in New York: still their birthday.
    expect(occasionNudge('birthday', birthday, rules, 0, Date.UTC(2026, 10, 14, 23))?.when).toBe('day')
  })
})

describe('keeping in touch', () => {
  it('describes cadences', () => {
    expect(describeCadence(7)).toBe('Every week')
    expect(describeCadence(14)).toBe('Every 2 weeks')
    expect(describeCadence(56)).toBe('Every 8 weeks')
    expect(describeCadence(10)).toBe('Every 10 days')
  })

  it('reads a recorded catch-up date', () => {
    const today = { year: 2026, month: 11, day: 11 }
    const now = ny(11, 11, 10 * 60)
    expect(lastInTouchFromInput('', NY, today, now)).toEqual({ value: null, date: '' })
    expect(lastInTouchFromInput('2026-11-01', NY, today, now)).toEqual({ value: ny(11, 1, 12 * 60), date: '2026-11-01' })
    // Today, before midday: not in the future.
    expect(lastInTouchFromInput('2026-11-11', NY, today, now)).toEqual({ value: now, date: '2026-11-11' })
    expect(lastInTouchFromInput('2026-11-12', NY, today, now)).toHaveProperty('error')
    expect(lastInTouchFromInput('2026-02-30', NY, today, now)).toHaveProperty('error')
  })

  it('takes the later of a sent message and a recorded catch-up', () => {
    expect(lastInTouch(null, [])).toBeNull()
    expect(lastInTouch(5, [3, 9])).toBe(9)
    expect(lastInTouch(12, [3, 9])).toBe(12)
  })

  it('is due the cadence after you were last in touch, at the start of their window', () => {
    const last = ny(11, 2, 15 * 60)
    const due = cadenceDueAt(rules, 14, last, 0, [last])
    expect(due).toBe(ny(11, 16, 15 * 60))
    // From a time outside the window, the next window opening.
    const evening = ny(11, 2, 21 * 60)
    expect(cadenceDueAt(rules, 14, evening, 0, [])).toBe(ny(11, 17, 9 * 60))
  })

  it('counts from when you added them, if you were never in touch', () => {
    const added = ny(11, 1, 10 * 60)
    expect(cadenceDueAt(rules, 7, null, added, [])).toBe(ny(11, 8, 10 * 60))
  })

  it('respects their allowed days', () => {
    // Weekdays only; 14 November 2026 is a Saturday, so Monday the 16th.
    const weekdays = { ...rules, allowedDays: 0b0111110 }
    expect(cadenceDueAt(weekdays, 7, ny(11, 7, 10 * 60), 0, [])).toBe(ny(11, 16, 9 * 60))
  })

  it('respects their spacing and 30-day cap', () => {
    // A weekly cadence, but at most one message every 14 days.
    const spaced = { ...rules, minDaysBetween: 14 }
    const last = ny(11, 1, 10 * 60)
    expect(cadenceDueAt(spaced, 7, last, 0, [last])).toBe(ny(11, 15, 10 * 60))
    // Two in 30 days already: the next fits once the oldest leaves the window,
    // 30 days later, which is 09:00 local after the clocks went back on 1 November.
    const capped = { ...rules, maxPer30Days: 2 }
    const history = [ny(10, 20, 10 * 60), ny(11, 1, 10 * 60)]
    expect(cadenceDueAt(capped, 7, history[1]!, 0, history)).toBe(ny(11, 19, 9 * 60))
  })

  it('nudges once due, inside the window, keyed by the due date', () => {
    const due = ny(11, 16, 9 * 60)
    expect(cadenceNudge(rules, due, due - 1)).toBeNull()
    expect(cadenceNudge(rules, due, due + 60_000)).toEqual({ dueAt: due, key: 'cadence:2026-11-16' })
    expect(cadenceNudge(rules, due, ny(11, 16, 21 * 60))).toBeNull()
    expect(cadenceNudge(rules, due, due + 3 * DAY)?.key).toBe('cadence:2026-11-16')
  })
})

describe('occasion suggestions', () => {
  it('only names items that are in the library', () => {
    const ids = new Set(LIBRARY.map((i) => i.id))
    for (const list of Object.values(OCCASION_PICKS)) for (const id of list) expect(ids.has(id), id).toBe(true)
  })

  it('leaves out what they had recently or have scheduled', () => {
    const now = ny(11, 11, 12 * 60)
    const picks = occasionPicks(LIBRARY, 'birthday', [{ contentId: 'numbers-6-24-26', at: now - 30 * DAY, status: 'sent' }], now)
    expect(picks.map((p) => p.id)).toEqual(['3-john-1-2', 'psalm-118-24', 'romans-15-13'])
  })

  it('greets by first name', () => {
    expect(occasionGreeting('birthday', 'Sam Lee')).toBe('Happy birthday, Sam!')
    expect(occasionGreeting('anniversary', 'Ana')).toBe('Happy anniversary, Ana!')
  })

  it('offers the day itself as the time', () => {
    const now = ny(11, 11, 12 * 60)
    expect(occasionSlot(rules, [], { year: 2026, month: 11, day: 14 }, now)).toBe(ny(11, 14, 9 * 60))
    // Today, with the window open: the next slot today.
    const today = occasionSlot(rules, [], { year: 2026, month: 11, day: 11 }, now)
    expect(localParts(today!, NY)).toMatchObject({ day: 11, minutes: 12 * 60 + 15 })
    // Not an allowed day for them: none.
    expect(occasionSlot({ ...rules, allowedDays: 0b0111110 }, [], { year: 2026, month: 11, day: 14 }, now)).toBeNull()
    // Too soon after another message: none.
    expect(occasionSlot(rules, [ny(11, 12, 10 * 60)], { year: 2026, month: 11, day: 14 }, now)).toBeNull()
  })
})

describe('reminder wording', () => {
  it('titles each kind', () => {
    expect(nudgeTitle({ kind: 'birthday', contactName: 'Sam', daysAway: 0 })).toBe("It's Sam's birthday today")
    expect(nudgeTitle({ kind: 'anniversary', contactName: 'Sam', daysAway: 3 })).toBe("Sam's anniversary is in 3 days")
    expect(nudgeTitle({ kind: 'birthday', contactName: 'Sam', daysAway: 1 })).toBe("Sam's birthday is tomorrow")
    expect(nudgeTitle({ kind: 'cadence', contactName: 'Sam', daysAway: 0 })).toBe('Time to reach out to Sam')
  })

  it('pushes one reminder on its own, or a summary with messages', () => {
    const birthday = { kind: 'birthday' as const, contactName: 'Sam', daysAway: 0, path: '/people/c1?occasion=birthday#occasion' }
    expect(reminderPush([], [birthday])).toMatchObject({ title: "It's Sam's birthday today", url: '/people/c1?occasion=birthday#occasion' })
    const mixed = reminderPush([{ id: 'm1', contactName: 'Ana', kind: 'content' }], [birthday])
    expect(mixed).toMatchObject({ title: '2 reminders from Tend', body: 'For Ana and Sam. Open Tend to see them.', url: '/today' })
  })

  it('writes a Telegram reminder', () => {
    expect(nudgeText({ kind: 'cadence', contactName: 'Sam', daysAway: 0, path: '/people/c1' })).toBe(
      'Time to reach out to Sam.\n\nOpen Tend for something to send, or write your own.',
    )
  })
})
