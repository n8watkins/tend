import { describe, expect, it } from 'vitest'

import { citation, getItem, itemText, itemTitle, LIBRARY } from '@/lib/content'
import { TRANSLATIONS } from '@/lib/enums'
import { buildBody, consentRequestBody, normalizePhone, signalChatUrl } from '@/lib/format'
import { suggest, surprise } from '@/lib/suggest'
import { DAY } from '@/lib/time'
import { TOPIC_SLUGS } from '@/lib/topics'

describe('the library', () => {
  it('has unique ids, valid topics, text and https links', () => {
    const ids = new Set<string>()
    for (const item of LIBRARY) {
      expect(ids.has(item.id), item.id).toBe(false)
      ids.add(item.id)
      expect(item.license).toBe('public-domain')
      expect(item.topics.length).toBeGreaterThan(0)
      expect(item.topics.length).toBeLessThanOrEqual(4)
      for (const t of item.topics) expect(TOPIC_SLUGS).toContain(t)
      expect(item.context.length).toBeGreaterThan(10)
      if (item.kind === 'scripture') {
        for (const t of TRANSLATIONS) {
          expect(item.text[t]?.length ?? 0, `${item.id} ${t}`).toBeGreaterThan(10)
          expect(item.sourceUrl[t]).toMatch(new RegExp(`^https://bible-api\\.com/[^?]+\\?translation=${t}$`))
          expect(item.readingUrl[t]).toMatch(/^https:\/\/(www\.biblegateway\.com\/passage\/\?search=|ebible\.org\/[\w-]+\/[1-3A-Z]{3}\d{2,3}\.htm$)/)
        }
      } else {
        expect(item.text.length).toBeGreaterThan(10)
        expect(item.sourceUrl).toMatch(/^https:\/\/www\.gutenberg\.org\//)
        expect(item.author).toBeTruthy()
      }
    }
  })

  it('covers every topic at least twice', () => {
    for (const topic of TOPIC_SLUGS) {
      expect(LIBRARY.filter((i) => i.topics.includes(topic)).length, topic).toBeGreaterThanOrEqual(2)
    }
  })

  it('formats citations', () => {
    expect(citation(getItem('psalm-23-1-4')!, 'web')).toBe('Psalm 23:1-4 (WEB)')
    expect(citation(getItem('psalm-23-1-4')!, 'bsb')).toBe('Psalm 23:1-4 (BSB)')
    expect(citation(getItem('psalm-23-1-4')!, 'darby')).toBe('Psalm 23:1-4 (Darby)')
    expect(citation(getItem('psalm-23-1-4')!, 'dra')).toBe('Psalm 22:1-4 (DRA)')
    const psalm = getItem('psalm-23-1-4')
    expect(psalm?.kind === 'scripture' ? psalm.readingUrl.bsb : '').toBe('https://ebible.org/engbsb/PSA023.htm')
    expect(citation(getItem('aurelius-happy-life')!, 'kjv')).toBe('Marcus Aurelius, Meditations 7.67 (tr. George Long)')
    expect(citation(getItem('emerson-sincere')!, 'web')).toBe('Ralph Waldo Emerson, "Friendship"')
    expect(citation(getItem('thoreau-morning-star')!, 'web')).toBe('Henry David Thoreau, Walden, "Conclusion"')
  })

  it('gives similar quotes distinct titles', () => {
    expect(itemTitle(getItem('emerson-sincere')!)).toBe('Ralph Waldo Emerson: "A friend is a person with..."')
    expect(itemTitle(getItem('emerson-be-one')!)).toBe('Ralph Waldo Emerson: "The only way to have a..."')
    expect(itemTitle(getItem('psalm-23-1-4')!)).toBe('Psalm 23:1-4')
  })
})

describe('buildBody', () => {
  const item = getItem('isaiah-41-10')!
  it('puts note, passage, citation, question and links in order', () => {
    const body = buildBody({
      note: 'Thinking of you.',
      item,
      translation: 'web',
      question: 'How are you?',
      readingLink: true,
      stopUrl: 'https://tend.n8builds.dev/stop/abc',
    })
    expect(body).toBe(
      [
        'Thinking of you.',
        `${itemText(item, 'web')}\n- Isaiah 41:10 (WEB)`,
        'How are you?',
        `Read more: ${item.kind === 'scripture' ? item.readingUrl.web : ''}\nRather not get these? https://tend.n8builds.dev/stop/abc`,
      ].join('\n\n'),
    )
  })

  it('leaves out empty parts', () => {
    expect(buildBody({ note: '  ', item, translation: 'kjv' })).toBe(`${itemText(item, 'kjv')}\n- Isaiah 41:10 (KJV)`)
    expect(buildBody({ note: 'Just me.', translation: 'web' })).toBe('Just me.')
  })

  it('drafts a consent request with the first name and frequency', () => {
    const text = consentRequestBody('Sam Lee', 14)
    expect(text).toMatch(/^Hi Sam,/)
    expect(text).toContain('once a fortnight')
    expect(text).toContain('stop anytime')
  })
})

describe('phone numbers', () => {
  it('normalises to E.164', () => {
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123')
    expect(normalizePhone('(555) 123-4567')).toBe('+15551234567')
    expect(normalizePhone('0044 7700 900123')).toBe('+447700900123')
    expect(normalizePhone('12345')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })

  it('builds signal.me chat links', () => {
    expect(signalChatUrl('+15551234567')).toBe('https://signal.me/#p/+15551234567')
  })
})

describe('suggest', () => {
  const now = Date.UTC(2026, 10, 10)
  it('ranks by topic weight and returns at most five', () => {
    const picks = suggest(LIBRARY, 'c1', [{ topic: 'grief', weight: 3 }], [], now)
    expect(picks.length).toBeGreaterThan(0)
    expect(picks.length).toBeLessThanOrEqual(5)
    for (const p of picks) expect(p.topics).toContain('grief')
  })

  it('never repeats something sent in the last 180 days or already scheduled', () => {
    const first = suggest(LIBRARY, 'c1', [{ topic: 'friendship', weight: 2 }], [], now)[0]!
    const second = suggest(LIBRARY, 'c1', [{ topic: 'friendship', weight: 2 }], [{ contentId: first.id, at: now - 10 * DAY, status: 'sent' }], now)
    expect(second.map((i) => i.id)).not.toContain(first.id)
    const scheduled = suggest(LIBRARY, 'c1', [{ topic: 'friendship', weight: 2 }], [{ contentId: first.id, at: now + DAY, status: 'scheduled' }], now)
    expect(scheduled.map((i) => i.id)).not.toContain(first.id)
    const old = suggest(LIBRARY, 'c1', [{ topic: 'friendship', weight: 2 }], [{ contentId: first.id, at: now - 200 * DAY, status: 'sent' }], now, 100)
    expect(old.map((i) => i.id)).toContain(first.id)
  })

  it('is stable within a week and suggests something with no topics', () => {
    const a = suggest(LIBRARY, 'c1', [{ topic: 'hope', weight: 2 }], [], now)
    const b = suggest(LIBRARY, 'c1', [{ topic: 'hope', weight: 2 }], [], now + 60_000)
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id))
    expect(suggest(LIBRARY, 'c2', [], [], now).length).toBe(5)
  })
})

describe('surprise', () => {
  const now = Date.UTC(2026, 10, 10)
  it('picks from the whole library, whatever the random number', () => {
    const ids = new Set(LIBRARY.map((i) => i.id))
    expect(ids.has(surprise(LIBRARY, [], now, { random: () => 0 })!.id)).toBe(true)
    expect(ids.has(surprise(LIBRARY, [], now, { random: () => 0.999999 })!.id)).toBe(true)
  })

  it('still never repeats within 180 days or something already scheduled', () => {
    const [keep, ...rest] = LIBRARY
    const past = [
      ...rest.slice(1).map((i) => ({ contentId: i.id, at: now - 179 * DAY, status: 'sent' as const })),
      { contentId: rest[0]!.id, at: now + DAY, status: 'scheduled' as const },
    ]
    for (const r of [0, 0.5, 0.99]) expect(surprise(LIBRARY, past, now, { random: () => r })!.id).toBe(keep!.id)
    const all = [...past, { contentId: keep!.id, at: now - DAY, status: 'sent' as const }]
    expect(surprise(LIBRARY, all, now)).toBeUndefined()
    const later = all.map((m) => (m.status === 'sent' ? { ...m, at: now - 181 * DAY } : m))
    expect(surprise(LIBRARY, later, now)).toBeDefined()
  })

  it('can stick to one kind and avoids the last surprise when it can', () => {
    for (const r of [0, 0.5, 0.99]) expect(surprise(LIBRARY, [], now, { mode: 'scripture', random: () => r })!.kind).toBe('scripture')
    const first = surprise(LIBRARY, [], now, { random: () => 0 })!
    expect(surprise(LIBRARY, [], now, { avoid: first.id, random: () => 0 })!.id).not.toBe(first.id)
  })
})
