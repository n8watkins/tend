/**
 * Conversation starters: short lines in our own words that the sender can use
 * to begin a personal message. They are content like the library, written once
 * and reviewed; nothing is generated at runtime. Safe for client components.
 *
 * PREVIEW: reads placeholder entries from tests/fixtures/prompts.json until the
 * content lane lands content/prompts.json (same shape); then this import moves.
 */

import prompts from '@/tests/fixtures/prompts.json'

import type { SuggestMode } from './enums'

export const SITUATIONS = ['just-because', 'been-a-while', 'going-through-something', 'congratulations', 'birthday'] as const
export type Situation = (typeof SITUATIONS)[number]

export const TONES = ['light', 'tender', 'steady'] as const
export type Tone = (typeof TONES)[number]

export interface Prompt {
  id: string
  situation: Situation
  tone?: Tone
  text: string
}

export const PROMPTS = prompts as Prompt[]

const byId = new Map(PROMPTS.map((p) => [p.id, p]))

export function getPrompt(id: string | null | undefined): Prompt | undefined {
  return id ? byId.get(id) : undefined
}

export const SITUATION_LABEL: Record<Situation, string> = {
  'just-because': 'Just because',
  'been-a-while': "It's been a while",
  'going-through-something': 'Going through something',
  congratulations: 'Congratulations',
  birthday: 'Birthday',
}

export const SUGGEST_LABEL: Record<SuggestMode, string> = {
  mix: 'A mix',
  scripture: 'Scripture',
  quotes: 'Quotes',
  words: 'Just my words',
}

/** A line for pickers: what each choice suggests. */
export const SUGGEST_HINT: Record<SuggestMode, string> = {
  mix: 'Bible passages, quotes and conversation starters',
  scripture: 'Bible passages and conversation starters',
  quotes: 'Quotes from books and thinkers, and conversation starters',
  words: 'Only conversation starters, for messages in your own words',
}
