/** Content item types and formatting helpers, without the library data (safe for client components). */

import type { Translation } from '@/lib/enums'

import type { TopicSlug } from './topics'

export interface ItemCommon {
  id: string
  reference: string
  license: 'public-domain'
  context: string
  topics: TopicSlug[]
}

export interface ScriptureItem extends ItemCommon {
  kind: 'scripture'
  text: Record<Translation, string>
  sourceUrl: Record<Translation, string>
  readingUrl: Record<Translation, string>
}

export interface QuoteItem extends ItemCommon {
  kind: 'quote'
  text: string
  author: string
  work: string
  translator?: string
  sourceUrl: string
  readingUrl: string
}

export type ContentItem = ScriptureItem | QuoteItem

export const TRANSLATION_LABEL: Record<Translation, string> = {
  web: 'World English Bible',
  kjv: 'King James Version',
}

export function itemText(item: ContentItem, translation: Translation): string {
  return item.kind === 'scripture' ? item.text[translation] : item.text
}

export function itemReadingUrl(item: ContentItem, translation: Translation): string {
  return item.kind === 'scripture' ? item.readingUrl[translation] : item.readingUrl
}

/** "Psalm 23:1-4 (WEB)" or "Marcus Aurelius, Meditations 7.67 (tr. George Long)". */
export function citation(item: ContentItem, translation: Translation): string {
  if (item.kind === 'scripture') return `${item.reference} (${translation.toUpperCase()})`
  const translator = item.translator ? ` (tr. ${item.translator.replace(/\s*\(\d{4}\)$/, '')})` : ''
  return `${item.author}, ${shortReference(item.reference)}${translator}`
}

/** The reference without collection names or years: "Friendship", not Essays: First Series, "Friendship" (1841). */
function shortReference(reference: string): string {
  return reference.replace(/^Essays: [^,]+, /, '').replace(/\s*\(\d{4}\)$/, '')
}

/** A heading for a card that also shows the text: "Psalm 23:1-4" or "Ralph Waldo Emerson, "Friendship"". */
export function itemHeading(item: ContentItem): string {
  return item.kind === 'scripture' ? item.reference : `${item.author}, ${shortReference(item.reference)}`
}

/** A short title for lists: the reference, or the author and the quote's opening words. */
export function itemTitle(item: ContentItem): string {
  if (item.kind === 'scripture') return item.reference
  const words = item.text.split(/\s+/)
  const opening = words.slice(0, 6).join(' ').replace(/[,.;:]$/, '')
  return `${item.author}: "${opening.charAt(0).toUpperCase()}${opening.slice(1)}${words.length > 6 ? '...' : ''}"`
}
