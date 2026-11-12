/**
 * Suggestions for a contact (docs/SPEC.md section 7): topic fit, a nudge
 * towards variety, nothing sent to them in the last 180 days, nothing already
 * scheduled for them. Ties break by a stable weekly hash so the list changes
 * week to week but not on every page load.
 */

import type { ContentItem } from './content'
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

export const REPEAT_DAYS = 180

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

/** Content ids that must not be offered: sent in the last 180 days, or already scheduled. */
export function excludedIds(past: PastMessage[], now: number): Set<string> {
  return new Set(
    past
      .filter((m) => m.contentId && (m.status === 'scheduled' || (m.status === 'sent' && now - m.at < REPEAT_DAYS * DAY)))
      .map((m) => m.contentId as string),
  )
}

/**
 * "Surprise me": one passage or quote at random from the whole library,
 * whatever their topics, still never one sent to them in the last 180 days
 * or already scheduled. `random` is injectable for tests. Returns undefined
 * when every item is excluded.
 */
export function surprise(
  library: ContentItem[],
  past: PastMessage[],
  now: number,
  options: { mode?: SuggestMode; avoid?: string; random?: () => number } = {},
): ContentItem | undefined {
  const excluded = excludedIds(past, now)
  const kinds = kindsFor(options.mode ?? 'mix')
  const pool = library.filter((item) => !excluded.has(item.id) && kinds.includes(item.kind))
  // Prefer something other than the last surprise, when there is a choice.
  const fresh = pool.length > 1 && options.avoid ? pool.filter((item) => item.id !== options.avoid) : pool
  if (!fresh.length) return undefined
  const random = options.random ?? Math.random
  return fresh[Math.min(fresh.length - 1, Math.floor(random() * fresh.length))]
}

export function suggest(
  library: ContentItem[],
  contactId: string,
  topics: TopicWeight[],
  past: PastMessage[],
  now: number,
  limit = 5,
  mode: SuggestMode = 'mix',
): ContentItem[] {
  const kinds = kindsFor(mode)
  if (!kinds.length) return []
  const excluded = excludedIds(past, now)
  const lastSent = past
    .filter((m) => m.status === 'sent' && m.contentId)
    .sort((a, b) => b.at - a.at)[0]
  const lastKind = lastSent ? library.find((i) => i.id === lastSent.contentId)?.kind : undefined
  const weights = new Map(topics.map((t) => [t.topic, t.weight]))
  const week = isoWeek(now)

  const scored = library
    .filter((item) => kinds.includes(item.kind) && !excluded.has(item.id))
    .map((item) => {
      let score = item.topics.reduce((sum, t) => sum + (weights.get(t) ?? 0), 0) * 10
      // With no topics chosen, prefer broadly useful items.
      if (weights.size === 0) score = item.topics.length
      if (lastKind && item.kind !== lastKind) score += 3
      return { item, score, tie: stableHash(`${contactId}:${item.id}:${week}`) }
    })
    .filter((s) => weights.size === 0 || s.score >= 10)
    .sort((a, b) => b.score - a.score || a.tie - b.tie)

  return scored.slice(0, limit).map((s) => s.item)
}

/**
 * The situations that fit a contact, best first: a long gap since the last
 * message, then topics that suggest a hard time, then "just because".
 * Only what the sender told Tend counts; nothing is inferred about the person.
 */
export function situationsFor(topics: TopicWeight[], past: PastMessage[], now: number): Situation[] {
  const lastSent = Math.max(0, ...past.filter((m) => m.status === 'sent').map((m) => m.at))
  const situations: Situation[] = []
  if (lastSent && now - lastSent >= A_WHILE_DAYS * DAY) situations.push('been-a-while')
  if (topics.some((t) => t.topic === 'grief' || t.topic === 'comfort')) situations.push('going-through-something')
  situations.push('just-because')
  return situations
}

/**
 * Conversation starters for a contact: never one used with them before, the
 * best-fitting situation first, varied week to week by the same stable hash.
 */
export function suggestPrompts(
  prompts: Prompt[],
  contactId: string,
  situations: Situation[],
  past: PastMessage[],
  now: number,
  limit: number,
): Prompt[] {
  const used = new Set(past.filter((m) => m.contentId && m.status !== 'canceled').map((m) => m.contentId))
  const week = isoWeek(now)
  const rank = (p: Prompt) => situations.indexOf(p.situation)
  return prompts
    .filter((p) => !used.has(p.id) && rank(p) >= 0)
    .map((p) => ({ p, rank: rank(p), tie: stableHash(`${contactId}:${p.id}:${week}`) }))
    .sort((a, b) => a.rank - b.rank || a.tie - b.tie)
    .slice(0, limit)
    .map((s) => s.p)
}
