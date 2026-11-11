/**
 * Telegram reminder messages and buttons, without network or database
 * (lib/server/telegram.ts sends them). Plain text only: no parse_mode, so
 * nothing in a message ever needs escaping.
 */

import { telegramShareUrl } from './share'

export type InlineButton = { text: string; url: string } | { text: string; callback_data: string }
export type InlineKeyboard = InlineButton[][]

export interface ReminderItem {
  id: string
  contactName: string
  kind: string
  body: string
}

/** Telegram's limit for a message's text. */
export const TELEGRAM_TEXT_MAX = 4096
/** Kept well under what Telegram accepts for a button URL. */
const BUTTON_URL_MAX = 2000

export function reminderText(item: ReminderItem): string {
  const head = item.kind === 'consent_request' ? `Time to ask ${item.contactName}.` : `Time to message ${item.contactName}.`
  const tail = 'Send it on Signal (or share it below), then tap "I sent it".'
  const room = TELEGRAM_TEXT_MAX - head.length - tail.length - 8
  const body = item.body.length > room ? `${item.body.slice(0, room - 3)}...` : item.body
  return `${head}\n\n${body}\n\n${tail}`
}

export function reminderKeyboard(item: ReminderItem, sendPageUrl: string): InlineKeyboard {
  const share = telegramShareUrl(item.body)
  const links: InlineButton[] = [...(share.length <= BUTTON_URL_MAX ? [{ text: 'Share', url: share }] : []), { text: 'Open in Tend', url: sendPageUrl }]
  return [links, [{ text: 'I sent it', callback_data: `sent:${item.id}` }, { text: 'Snooze a day', callback_data: `snooze:${item.id}` }]]
}

/** "/start <code>" (also "/start@bot <code>"): the code, or '' for a bare /start, or null for other text. */
export function parseStart(text: string | undefined): string | null {
  const match = text?.trim().match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,64}))?$/)
  return match ? (match[1] ?? '') : null
}

export function isCommand(text: string | undefined, command: string): boolean {
  return new RegExp(`^/${command}(?:@\\w+)?$`).test(text?.trim() ?? '')
}

export type CallbackAction = { action: 'sent' | 'snooze'; messageId: string }

export function parseCallback(data: string | undefined): CallbackAction | null {
  const match = data?.match(/^(sent|snooze):([A-Za-z0-9-]{1,60})$/)
  return match ? { action: match[1] as CallbackAction['action'], messageId: match[2]! } : null
}
