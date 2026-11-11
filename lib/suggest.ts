/**
 * Suggestions for a contact (docs/SPEC.md section 7): topic fit, a nudge
 * towards variety, nothing sent to them in the last 180 days, nothing already
 * scheduled for them. Ties break by a stable weekly hash so the list changes
 * week to week but not on every page load.
 */

import type { ContentItem } from './content'
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

export function suggest(
  library: ContentItem[],
  contactId: string,
  topics: TopicWeight[],
  past: PastMessage[],
  now: number,
  limit = 5,
): ContentItem[] {
  const excluded = new Set(
    past
      .filter((m) => m.contentId && (m.status === 'scheduled' || (m.status === 'sent' && now - m.at < REPEAT_DAYS * DAY)))
      .map((m) => m.contentId as string),
  )
  const lastSent = past
    .filter((m) => m.status === 'sent' && m.contentId)
    .sort((a, b) => b.at - a.at)[0]
  const lastKind = lastSent ? library.find((i) => i.id === lastSent.contentId)?.kind : undefined
  const weights = new Map(topics.map((t) => [t.topic, t.weight]))
  const week = isoWeek(now)

  const scored = library
    .filter((item) => !excluded.has(item.id))
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
