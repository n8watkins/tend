/**
 * Suggestions for a contact (docs/SPEC.md section 7): what the sender chose to
 * suggest for them, topic fit, quotes that suit the occasion and tone, a nudge
 * towards variety, and no repeats. Ties break by a stable weekly hash so the
 * list changes week to week but not on every page load.
 *
 * No repeats:
 * - a quote or a conversation starter is never suggested to the same person
 *   twice; a Bible passage can come back after 180 days;
 * - nothing already scheduled for them;
 * - a quote sent or scheduled to someone else in the last 90 days goes after
 *   everything else, so it is offered only when nothing fresh is left.
 *
 * The library is passed in, never imported, so client components that use
 * these helpers (through lib/occasions.ts) do not ship it.
 */

import type { ContentItem } from './item'
import type { SuggestMode } from './enums'
import type { Prompt, Situation } from './prompts'
import { DAY } from './time'

export interface TopicWeight {
  topic: string
  weight: number
}

export interface PastMessage {
  contentId: string | null
  at: number
  status: 'scheduled' | 'sent' | 'skipped' | 'canceled'
}

/** A Bible passage sent to someone can be suggested to them again after this long. */
export const REPEAT_DAYS = 180

/** A quote sent or scheduled to one person is held back from everyone else for this long. */
export const ELSEWHERE_DAYS = 90

/** A contact with no message sent for this long gets "It's been a while" starters first. */
export const A_WHILE_DAYS = 60

/** Which library kinds a "What to suggest" choice allows; none for "Just my words". */
export function kindsFor(mode: SuggestMode): ContentItem['kind'][] {
  return mode === 'scripture' ? ['scripture'] : mode === 'quotes' ? ['quote'] : mode === 'words' ? [] : ['scripture', 'quote']
}

/** How many conversation starters to show beside the library suggestions. */
export function promptLimit(mode: SuggestMode): number {
  return mode === 'words' ? 5 : 2
}

/** FNV-1a: a small, stable string hash. */
export function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function isoWeek(ms: number): string {
  const date = new Date(ms)
  const day = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY))
  return `${date.getUTCFullYear()}-W${week}`
}

const scriptureIds = new WeakMap<ContentItem[], Set<string>>()
function scriptureIn(library: ContentItem[]): Set<string> {
  let ids = scriptureIds.get(library)
  if (!ids) {
    ids = new Set(library.filter((item) => item.kind === 'scripture').map((item) => item.id))
    scriptureIds.set(library, ids)
  }
  return ids
}

/**
 * Ids that must not be offered to this person: anything scheduled for them, a
 * Bible passage sent in the last 180 days, and any quote or starter ever sent.
 */
export function excludedIds(past: PastMessage[], now: number, library: ContentItem[]): Set<string> {
  const scripture = scriptureIn(library)
  return new Set(
    past
      .filter(
        (m) =>
          m.contentId &&
          (m.status === 'scheduled' || (m.status === 'sent' && (!scripture.has(m.contentId) || now - m.at < REPEAT_DAYS * DAY))),
      )
      .map((m) => m.contentId as string),
  )
}

/** Puts quotes used with someone else lately after everything else, keeping each group's order. */
function freshFirst<T extends { id: string }>(items: T[], elsewhere: ReadonlySet<string> | undefined): T[] {
  if (!elsewhere?.size) return items
  return [...items.filter((i) => !elsewhere.has(i.id)), ...items.filter((i) => elsewhere.has(i.id))]
}

/* Fit: occasions and tone ----------------------------------------------------- */

const GRIEF_TOPICS = new Set(['grief', 'comfort'])

/** The quote occasions a person's topics point to (content/quotes.json `occasions`). */
const TOPIC_OCCASIONS: Record<string, string> = {
  grief: 'grief',
  comfort: 'grief',
  gratitude: 'gratitude',
  'new-beginnings': 'new-chapter',
  purpose: 'new-chapter',
  courage: 'encouragement',
  strength: 'encouragement',
  hope: 'encouragement',
  patience: 'encouragement',
  friendship: 'thinking-of-you',
  love: 'thinking-of-you',
}

/** True when the sender tagged this person with grief or comfort. */
export function goingThroughSomething(topics: TopicWeight[]): boolean {
  return topics.some((t) => GRIEF_TOPICS.has(t.topic))
}

/**
 * Whether a quote may be offered to this person at all. Lines about loss only
 * go to someone the sender tagged with grief or comfort, and light-hearted
 * lines never do, so a joke never lands on someone who is grieving. A quote
 * without occasions or tone fits anyone.
 */
export function quoteFits(item: ContentItem, topics: TopicWeight[]): boolean {
  if (item.kind !== 'quote') return true
  const grieving = goingThroughSomething(topics)
  if (!grieving && item.occasions?.includes('grief')) return false
  if (grieving && item.tone === 'light') return false
  return true
}

/* Surprise me ----------------------------------------------------------------- */

/**
 * "Surprise me": one passage or quote at random from what the sender chose to
 * suggest for this person, whatever their topics, with the same no-repeat
 * rules. `random` is injectable for tests. Returns undefined when everything
 * is excluded.
 */
export function surprise(
  library: ContentItem[],
  past: PastMessage[],
  now: number,
  options: {
    mode?: SuggestMode
    topics?: TopicWeight[]
    elsewhere?: ReadonlySet<string>
    avoid?: string
    random?: () => number
  } = {},
): ContentItem | undefined {
  const excluded = excludedIds(past, now, library)
  const kinds = kindsFor(options.mode ?? 'mix')
  const pool = library.filter((item) => !excluded.has(item.id) && kinds.includes(item.kind) && quoteFits(item, options.topics ?? []))
  // Prefer something not used with someone else lately, and other than the last surprise.
  const fresh = options.elsewhere?.size ? pool.filter((item) => !options.elsewhere!.has(item.id)) : pool
  const base = fresh.length ? fresh : pool
  const choices = base.length > 1 && options.avoid ? base.filter((item) => item.id !== options.avoid) : base
  if (!choices.length) return undefined
  const random = options.random ?? Math.random
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]
}

/* Suggestions ----------------------------------------------------------------- */

export interface SuggestOptions {
  limit?: number
  mode?: SuggestMode
  /** Quote ids sent or scheduled to the user's other contacts in the last 90 days. */
  elsewhere?: ReadonlySet<string>
}

export function suggest(
  library: ContentItem[],
  contactId: string,
  topics: TopicWeight[],
  past: PastMessage[],
  now: number,
  { limit = 5, mode = 'mix', elsewhere }: SuggestOptions = {},
): ContentItem[] {
  const kinds = kindsFor(mode)
  if (!kinds.length) return []
  const excluded = excludedIds(past, now, library)
  const lastSent = past
    .filter((m) => m.status === 'sent' && m.contentId)
    .sort((a, b) => b.at - a.at)[0]
  const lastKind = lastSent ? library.find((i) => i.id === lastSent.contentId)?.kind : undefined
  const weights = new Map(topics.map((t) => [t.topic, t.weight]))
  const wanted = new Set(topics.map((t) => TOPIC_OCCASIONS[t.topic]).filter(Boolean))
  const week = isoWeek(now)

  const scored = library
    .filter((item) => kinds.includes(item.kind) && !excluded.has(item.id) && quoteFits(item, topics))
    .map((item) => {
      const fit = item.topics.reduce((sum, t) => sum + (weights.get(t) ?? 0), 0) * 10
      // With no topics chosen, prefer broadly useful items.
      let score = weights.size === 0 ? item.topics.length : fit
      // A quote written for the occasions their topics point to.
      if (item.kind === 'quote' && item.occasions?.some((o) => wanted.has(o))) score += 5
      if (lastKind && item.kind !== lastKind) score += 3
      return { item, fit, score, tie: stableHash(`${contactId}:${item.id}:${week}`) }
    })
    .filter((s) => weights.size === 0 || s.fit >= 10)
    .sort((a, b) => b.score - a.score || a.tie - b.tie)

  return freshFirst(
    scored.map((s) => s.item),
    elsewhere,
  ).slice(0, limit)
}

/* Conversation starters --------------------------------------------------------- */

/**
 * The situations that fit a contact, best first: their birthday when it is
 * near, a long gap since the last message, topics that point to a hard time,
 * then "just because". Only what the sender told Tend counts; nothing is
 * inferred about the person.
 */
export function situationsFor(topics: TopicWeight[], past: PastMessage[], now: number, occasion?: 'birthday' | 'anniversary'): Situation[] {
  const sent = past.filter((m) => m.status === 'sent').map((m) => m.at)
  const lastSent = sent.length ? Math.max(...sent) : 0
  const situations: Situation[] = []
  if (occasion === 'birthday') situations.push('birthday')
  if (lastSent && now - lastSent >= A_WHILE_DAYS * DAY) situations.push('been-a-while')
  if (goingThroughSomething(topics)) situations.push('going-through-something')
  situations.push('just-because')
  return situations
}

/**
 * Conversation starters for a contact: never one sent to them before (or
 * scheduled), the best-fitting situation first, varied week to week by the
 * same stable hash.
 */
export function suggestPrompts(
  prompts: Prompt[],
  contactId: string,
  situations: Situation[],
  past: PastMessage[],
  now: number,
  limit: number,
): Prompt[] {
  const used = new Set(past.filter((m) => m.contentId && (m.status === 'sent' || m.status === 'scheduled')).map((m) => m.contentId))
  const week = isoWeek(now)
  const rank = (p: Prompt) => situations.indexOf(p.situation)
  return prompts
    .filter((p) => !used.has(p.id) && rank(p) >= 0)
    .map((p) => ({ p, rank: rank(p), tie: stableHash(`${contactId}:${p.id}:${week}`) }))
    .sort((a, b) => a.rank - b.rank || a.tie - b.tie)
    .slice(0, limit)
    .map((s) => s.p)
}
