import { describe, expect, it } from 'vitest'

import { addLocalDays, fromLocalInput, localParts, parseMinutes, toLocalInput, zonedToUtc } from '@/lib/time'

describe('zonedToUtc', () => {
  it('converts a wall-clock time in a zone to UTC', () => {
    expect(new Date(zonedToUtc(2026, 11, 10, 9 * 60, 'America/New_York')).toISOString()).toBe('2026-11-10T14:00:00.000Z')
    expect(new Date(zonedToUtc(2026, 7, 1, 9 * 60, 'Europe/London')).toISOString()).toBe('2026-07-01T08:00:00.000Z')
    expect(new Date(zonedToUtc(2026, 7, 1, 9 * 60 + 30, 'Asia/Kolkata')).toISOString()).toBe('2026-07-01T04:00:00.000Z')
    expect(new Date(zonedToUtc(2026, 1, 1, 0, 'UTC')).toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('moves a time in the spring-forward gap forward by the gap', () => {
    // 2026-03-08 02:30 does not exist in New York; it becomes 03:30 EDT.
    const t = zonedToUtc(2026, 3, 8, 2 * 60 + 30, 'America/New_York')
    expect(new Date(t).toISOString()).toBe('2026-03-08T07:30:00.000Z')
    expect(localParts(t, 'America/New_York').minutes).toBe(3 * 60 + 30)
  })

  it('picks the earlier instant in the fall-back overlap', () => {
    // 2026-11-01 01:30 happens twice in New York; the first is EDT (UTC-4).
    expect(new Date(zonedToUtc(2026, 11, 1, 90, 'America/New_York')).toISOString()).toBe('2026-11-01T05:30:00.000Z')
  })

  it('round-trips through localParts on ordinary days', () => {
    for (const zone of ['Pacific/Auckland', 'America/Los_Angeles', 'Australia/Adelaide', 'Europe/Berlin']) {
      const t = zonedToUtc(2026, 5, 20, 17 * 60 + 45, zone)
      const p = localParts(t, zone)
      expect([p.year, p.month, p.day, p.minutes]).toEqual([2026, 5, 20, 17 * 60 + 45])
    }
  })
})

describe('local helpers', () => {
  it('adds calendar days across month ends', () => {
    expect(addLocalDays(2026, 1, 31, 1)).toMatchObject({ year: 2026, month: 2, day: 1 })
    expect(addLocalDays(2026, 12, 31, 1)).toMatchObject({ year: 2027, month: 1, day: 1, weekday: 5 })
  })

  it('parses HH:MM', () => {
    expect(parseMinutes('09:15')).toBe(555)
    expect(parseMinutes('24:00')).toBe(1440)
    expect(parseMinutes('25:00')).toBeNull()
    expect(parseMinutes('9am')).toBeNull()
  })

  it('round-trips datetime-local values in a zone', () => {
    const t = fromLocalInput('2026-11-12T14:30', 'Europe/Paris')!
    expect(new Date(t).toISOString()).toBe('2026-11-12T13:30:00.000Z')
    expect(toLocalInput(t, 'Europe/Paris')).toBe('2026-11-12T14:30')
    expect(fromLocalInput('nonsense', 'UTC')).toBeNull()
  })
})
