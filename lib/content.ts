/**
 * The verified content library (content/library.json, built and checked by
 * scripts/build-library.mjs). Read-only at runtime; server code only, so the
 * library is not shipped to the browser.
 */

import library from '@/content/library.json'

import type { ContentItem } from './item'

export * from './item'

export const LIBRARY = library as ContentItem[]

const byId = new Map(LIBRARY.map((item) => [item.id, item]))

export function getItem(id: string | null | undefined): ContentItem | undefined {
  return id ? byId.get(id) : undefined
}

