/**
 * The exact text of an outgoing message (docs/SPEC.md section 6). What the
 * compose screen previews is what is stored and what the send screen copies.
 */

import type { Translation } from '@/lib/enums'
import { citation, itemReadingUrl, itemText, type ContentItem } from './item'

export const MAX_BODY = 2000

export interface ComposeParts {
  note?: string
  item?: ContentItem
  translation: Translation
  question?: string
  readingLink?: boolean
  stopUrl?: string
}

export function buildBody(parts: ComposeParts): string {
  const blocks: string[] = []
  const note = parts.note?.trim()
  if (note) blocks.push(note)
  if (parts.item) {
    // The text goes out exactly as the source has it (some passages open with
    // a speech mark), so it is not wrapped in quotes; the citation follows.
    blocks.push(`${itemText(parts.item, parts.translation)}\n- ${citation(parts.item, parts.translation)}`)
  }
  const question = parts.question?.trim()
  if (question) blocks.push(question)
  const links: string[] = []
  if (parts.item && parts.readingLink) links.push(`Read more: ${itemReadingUrl(parts.item, parts.translation)}`)
  if (parts.stopUrl) links.push(`Rather not get these? ${parts.stopUrl}`)
  if (links.length) blocks.push(links.join('\n'))
  return blocks.join('\n\n')
}

export const FREQUENCY_WORDS: Record<number, string> = { 7: 'week', 14: 'fortnight', 30: 'month' }

export function frequencyWord(minDaysBetween: number): string {
  if (minDaysBetween <= 7) return 'week'
  if (minDaysBetween <= 14) return 'fortnight'
  return 'month'
}

export function consentRequestBody(name: string, minDaysBetween: number, stopUrl?: string): string {
  const first = name.trim().split(/\s+/)[0] || name
  const lines = [
    `Hi ${first}, I'd like to send you an occasional Bible verse or quote I think you'd like, about once a ${frequencyWord(minDaysBetween)}, here on Signal. Would that be OK? No pressure at all, and you can say stop anytime.`,
  ]
  if (stopUrl) lines.push(`Rather not? ${stopUrl}`)
  return lines.join('\n\n')
}

/** The signal.me link that opens a chat with an E.164 number. Signal links cannot carry text. */
export function signalChatUrl(phoneE164: string): string {
  return `https://signal.me/#p/${phoneE164}`
}

/** Normalises a phone number to E.164, or null. Accepts "+44 7700 900123", "(555) 123-4567" with a default country code. */
export function normalizePhone(input: string, defaultCountryCode = '1'): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  let digits = trimmed.replace(/[^\d+]/g, '')
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`
  if (!digits.startsWith('+')) {
    if (digits.length === 10 && defaultCountryCode === '1') digits = `+1${digits}`
    else if (digits.length === 11 && digits.startsWith('1')) digits = `+${digits}`
    else return null
  }
  return /^\+[1-9]\d{6,14}$/.test(digits) ? digits : null
}
