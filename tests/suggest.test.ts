import { describe, expect, it } from 'vitest'

import { LIBRARY } from '@/lib/content'
import type { ContentItem } from '@/lib/item'
import { occasionNote, occasionPicks } from '@/lib/occasions'
import { PROMPTS, SITUATIONS, TONES } from '@/lib/prompts'
import {
  ELSEWHERE_DAYS,
  excludedIds,
  quoteFits,
  situationsFor,
  suggest,
  suggestPrompts,
  surprise,
  type PastMessage,
} from '@/lib/suggest'
import { DAY } from '@/lib/time'

const now = Date.UTC(2026, 10, 12)
const sent = (contentId: string, daysAgo: number): PastMessage => ({ contentId, at: now - daysAgo * DAY, status: 'sent' })
const quotes = LIBRARY.filter((i) => i.kind === 'quote')
const quoteBy = (test: (q: ContentItem) => boolean) => quotes.find(test)!

describe('content: starters and quote tags', () => {
  it('uses only the situations and tones the app knows', () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(100)
    for (const p of PROMPTS) {
      expect(SITUATIONS, p.id).toContain(p.situation)
      expect(TONES, p.id).toContain(p.tone)
    }
    for (const q of quotes) if (q.tone) expect(TONES, q.id).toContain(q.tone)
  })

  it('has starters for every situation and ids that never clash with the library', () => {
    for (const s of SITUATIONS) expect(PROMPTS.filter((p) => p.situation === s).length, s).toBeGreaterThanOrEqual(5)
    const library = new Set(LIBRARY.map((i) => i.id))
    for (const p of PROMPTS) expect(library.has(p.id), p.id).toBe(false)
  })
})

describe('what to suggest', () => {
  const topics = [{ topic: 'hope', weight: 2 }]
  it('follows the chosen mode', () => {
    expect(suggest(LIBRARY, 'c1', topics, [], now, { mode: 'scripture' }).every((i) => i.kind === 'scripture')).toBe(true)
    expect(suggest(LIBRARY, 'c1', topics, [], now, { mode: 'quotes' }).every((i) => i.kind === 'quote')).toBe(true)
    expect(suggest(LIBRARY, 'c1', topics, [], now, { mode: 'words' })).toEqual([])
    const mix = suggest(LIBRARY, 'c1', topics, [], now, { mode: 'mix', limit: 30 })
    expect(new Set(mix.map((i) => i.kind))).toEqual(new Set(['scripture', 'quote']))
  })

  it('surprise me follows the mode too', () => {
    for (const r of [0, 0.5, 0.99]) {
      expect(surprise(LIBRARY, [], now, { mode: 'quotes', random: () => r })!.kind).toBe('quote')
      expect(surprise(LIBRARY, [], now, { mode: 'scripture', random: () => r })!.kind).toBe('scripture')
    }
    expect(surprise(LIBRARY, [], now, { mode: 'words' })).toBeUndefined()
  })
})

describe('no repeats', () => {
  const topics = [{ topic: 'friendship', weight: 2 }]

  it('never suggests a quote to the same person twice, while a passage comes back after 180 days', () => {
    const quote = suggest(LIBRARY, 'c1', topics, [], now, { mode: 'quotes' })[0]!
    const passage = suggest(LIBRARY, 'c1', topics, [], now, { mode: 'scripture' })[0]!
    const excluded = excludedIds([sent(quote.id, 400), sent(passage.id, 200)], now, LIBRARY)
    expect(excluded.has(quote.id)).toBe(true)
    expect(excluded.has(passage.id)).toBe(false)
    expect(suggest(LIBRARY, 'c1', topics, [sent(quote.id, 400)], now, { mode: 'quotes', limit: 100 }).map((i) => i.id)).not.toContain(quote.id)
  })

  it('never suggests the same starter to the same person twice, but a skipped one can come back', () => {
    const [first] = suggestPrompts(PROMPTS, 'c1', ['just-because'], [], now, 1)
    const after = suggestPrompts(PROMPTS, 'c1', ['just-because'], [sent(first!.id, 300)], now, 100)
    expect(after.map((p) => p.id)).not.toContain(first!.id)
    const skipped = suggestPrompts(PROMPTS, 'c1', ['just-because'], [{ contentId: first!.id, at: now, status: 'skipped' }], now, 100)
    expect(skipped.map((p) => p.id)).toContain(first!.id)
  })

  it('offers a quote used with someone else in the last 90 days only after everything fresh', () => {
    const fresh = suggest(LIBRARY, 'c1', topics, [], now, { mode: 'quotes', limit: 100 })
    const elsewhere = new Set([fresh[0]!.id])
    const ranked = suggest(LIBRARY, 'c1', topics, [], now, { mode: 'quotes', limit: 100, elsewhere })
    expect(ranked[0]!.id).not.toBe(fresh[0]!.id)
    expect(ranked.at(-1)!.id).toBe(fresh[0]!.id)
    expect(ELSEWHERE_DAYS).toBe(90)
  })

  it('surprise me prefers quotes nobody else had lately, but still offers one when that is all that is left', () => {
    const [a, b] = quotes
    const pool = [a!, b!]
    for (const r of [0, 0.99]) expect(surprise(pool, [], now, { elsewhere: new Set([a!.id]), random: () => r })!.id).toBe(b!.id)
    expect(surprise(pool, [sent(b!.id, 1)], now, { elsewhere: new Set([a!.id]) })!.id).toBe(a!.id)
  })
})

describe('occasions and tone', () => {
  const grief = quoteBy((q) => q.kind === 'quote' && Boolean(q.occasions?.includes('grief')))
  const light = quoteBy((q) => q.kind === 'quote' && q.tone === 'light' && !q.occasions?.includes('grief'))

  it('keeps lines about loss for people tagged with grief or comfort, and light lines away from them', () => {
    expect(quoteFits(grief, [{ topic: 'joy', weight: 2 }])).toBe(false)
    expect(quoteFits(grief, [{ topic: 'grief', weight: 2 }])).toBe(true)
    expect(quoteFits(light, [{ topic: 'comfort', weight: 2 }])).toBe(false)
    expect(quoteFits(light, [{ topic: 'joy', weight: 2 }])).toBe(true)
    const forJoy = suggest(LIBRARY, 'c1', [{ topic: 'joy', weight: 2 }], [], now, { mode: 'quotes', limit: 200 })
    expect(forJoy.some((q) => q.kind === 'quote' && q.occasions?.includes('grief'))).toBe(false)
    const forGrief = suggest(LIBRARY, 'c1', [{ topic: 'grief', weight: 2 }], [], now, { mode: 'quotes', limit: 200 })
    expect(forGrief.length).toBeGreaterThan(0)
    expect(forGrief.some((q) => q.kind === 'quote' && q.tone === 'light')).toBe(false)
  })

  it('treats a quote without tags as fitting anyone', () => {
    const plain = { ...light, occasions: undefined, tone: undefined } as ContentItem
    expect(quoteFits(plain, [{ topic: 'grief', weight: 2 }])).toBe(true)
    expect(quoteFits(plain, [])).toBe(true)
  })
})

describe('birthday and anniversary picks follow what to suggest', () => {
  it('gives passages, birthday quotes, both alternating, or nothing', () => {
    const scripture = occasionPicks(LIBRARY, 'birthday', [], now, { mode: 'scripture' })
    expect(scripture.map((i) => i.kind)).toEqual(['scripture', 'scripture', 'scripture'])
    const qs = occasionPicks(LIBRARY, 'birthday', [], now, { mode: 'quotes', limit: 10, contactId: 'c1' })
    expect(qs).toHaveLength(10)
    for (const q of qs) {
      expect(q.kind).toBe('quote')
      expect(q.kind === 'quote' && q.occasions?.includes('grief')).toBe(false)
    }
    expect(occasionPicks(LIBRARY, 'birthday', [], now, { mode: 'mix', limit: 4 }).map((i) => i.kind)).toEqual(['scripture', 'quote', 'scripture', 'quote'])
    expect(occasionPicks(LIBRARY, 'birthday', [], now, { mode: 'words' })).toEqual([])
  })

  it('puts light birthday quotes before tender ones, after the hand-picked ones', () => {
    const qs = occasionPicks(LIBRARY, 'birthday', [], now, { mode: 'quotes', limit: 40, contactId: 'c1' })
    const tagged = qs.slice(2).map((q) => (q.kind === 'quote' ? q.tone : undefined))
    const firstTender = tagged.indexOf('tender')
    expect(tagged.slice(firstTender).includes('light')).toBe(false)
    expect(qs.slice(0, 2).map((q) => q.id)).toEqual(['thoreau-morning-star', 'aurelius-happy-life'])
  })

  it('offers anniversary quotes about love or friendship', () => {
    for (const q of occasionPicks(LIBRARY, 'anniversary', [], now, { mode: 'quotes', limit: 10 })) {
      expect(q.topics.some((t) => t === 'love' || t === 'friendship')).toBe(true)
    }
  })

  it('applies the same no-repeat rules', () => {
    const [first] = occasionPicks(LIBRARY, 'birthday', [], now, { mode: 'quotes', contactId: 'c1' })
    const again = occasionPicks(LIBRARY, 'birthday', [sent(first!.id, 365)], now, { mode: 'quotes', contactId: 'c1', limit: 50 })
    expect(again.map((i) => i.id)).not.toContain(first!.id)
    const shared = occasionPicks(LIBRARY, 'birthday', [], now, { mode: 'quotes', contactId: 'c1', limit: 50, elsewhere: new Set([first!.id]) })
    expect(shared[0]!.id).not.toBe(first!.id)
    expect(shared.at(-1)!.id).toBe(first!.id)
  })

  it('starts the note with the greeting unless the starter already has it', () => {
    expect(occasionNote('birthday', 'Sam Lee')).toBe('Happy birthday, Sam!')
    expect(occasionNote('birthday', 'Sam Lee', 'Hope your day is low stress and high cake.')).toBe(
      'Happy birthday, Sam! Hope your day is low stress and high cake.',
    )
    expect(occasionNote('birthday', 'Sam', 'Today should officially be a holiday. Happy birthday.')).toBe(
      'Today should officially be a holiday. Happy birthday.',
    )
  })
})

describe('situations for starters', () => {
  it('puts a near birthday first, then a long gap, then a hard time, then just because', () => {
    const grief = [{ topic: 'grief', weight: 2 }]
    expect(situationsFor([], [], now)).toEqual(['just-because'])
    expect(situationsFor(grief, [sent('x', 90)], now, 'birthday')).toEqual(['birthday', 'been-a-while', 'going-through-something', 'just-because'])
    expect(situationsFor([], [sent('x', 10)], now)).toEqual(['just-because'])
    expect(situationsFor([], [], now, 'anniversary')).toEqual(['just-because'])
  })
})
