import 'server-only'

/**
 * Telegram reminders through the official Bot API (free).
 *
 * - On only when TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are set.
 * - Linking: Settings makes a one-time code (15 minutes, only its hash kept)
 *   and opens t.me/<bot>?start=<code>; the bot's webhook links that chat.
 * - Webhook: POST /api/telegram, accepted only with the secret token header.
 * - Every message the bot sends spends from a per-user and a site-wide daily
 *   cap first; if the cap or the counter is unavailable, nothing is sent.
 * - The cron registers the webhook and the bot's commands whenever the
 *   token, secret or URL change (ensureTelegramWebhook).
 */

import { and, eq, gt, lt } from 'drizzle-orm'

import { db } from '@/db'
import { appState, telegramLinkCodes, userSettings } from '@/db/schema'
import { hashKey, randomToken } from '@/lib/crypto'
import { TELEGRAM_PER_USER_DAILY, TELEGRAM_PUBLIC_DAILY, TELEGRAM_SITE_DAILY } from '@/lib/limits'
import { recordSent, snoozeDay } from '@/lib/server/messages'
import { readLimit, spend } from '@/lib/server/limits'
import type { NudgeLine } from '@/lib/occasions'
import {
  isCommand,
  nudgeKeyboard,
  nudgeText,
  parseCallback,
  parseStart,
  reminderKeyboard,
  reminderText,
  type InlineKeyboard,
  type ReminderItem,
} from '@/lib/telegram'
import { formatWhen } from '@/lib/time'
import { publicUrl } from '@/lib/url'

const LINK_CODE_TTL = 15 * 60 * 1000

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET)
}

/** The Bot API base. Only the test environment may point it at a mock. */
function apiBase(): string {
  return process.env.APP_ENV === 'test' && process.env.TELEGRAM_API_BASE ? process.env.TELEGRAM_API_BASE : 'https://api.telegram.org'
}

type ApiResult<T> = { ok: true; result: T } | { ok: false; status: number; description?: string }

async function api<T>(method: string, body: Record<string, unknown>): Promise<ApiResult<T>> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, status: 0, description: 'not configured' }
  try {
    const response = await fetch(`${apiBase()}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await response.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null
    if (response.ok && data?.ok) return { ok: true, result: data.result as T }
    return { ok: false, status: response.status, description: data?.description }
  } catch {
    return { ok: false, status: 0, description: 'network error' }
  }
}

/**
 * Spends from the caps, failing closed: no counter, no message. A linked
 * user's messages count against them and the site; replies to a chat linked
 * to nobody have their own small per-chat and public caps, so strangers
 * writing to the bot can never use up the reminders' budget.
 */
async function allowed(chatId: string, userId: string | null): Promise<boolean> {
  try {
    if (!userId) {
      return await spend([
        { key: `telegram:chat:${await hashKey(chatId)}`, limit: 3 },
        { key: 'telegram:public', limit: readLimit('TELEGRAM_PUBLIC_DAILY', TELEGRAM_PUBLIC_DAILY) },
      ])
    }
    return await spend([
      { key: `telegram:user:${userId}`, limit: readLimit('TELEGRAM_PER_USER_DAILY', TELEGRAM_PER_USER_DAILY) },
      { key: 'telegram:site', limit: readLimit('TELEGRAM_SITE_DAILY', TELEGRAM_SITE_DAILY) },
    ])
  } catch {
    return false
  }
}

/** Sends a plain-text message within the caps. `userId` null for a chat not linked to anyone. */
export async function sendTelegram(chatId: string, userId: string | null, text: string, keyboard?: InlineKeyboard): Promise<boolean> {
  if (!telegramConfigured() || !(await allowed(chatId, userId))) return false
  const sent = await api('sendMessage', {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  })
  if (!sent.ok) console.error(JSON.stringify({ event: 'telegram_send_failed', status: sent.status }))
  return sent.ok
}

/* App state ---------------------------------------------------------------- */

async function readState(key: string): Promise<string | null> {
  const [row] = await db.select({ value: appState.value }).from(appState).where(eq(appState.key, key))
  return row?.value ?? null
}

async function writeState(key: string, value: string): Promise<void> {
  const now = Date.now()
  await db.insert(appState).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: appState.key, set: { value, updatedAt: now } })
}

/** The bot's @username, from getMe, remembered once found. */
export async function botUsername(): Promise<string | null> {
  if (!telegramConfigured()) return null
  const known = await readState('telegram_bot_username')
  if (known) return known
  const me = await api<{ username?: string }>('getMe', {})
  if (!me.ok || !me.result.username) return null
  await writeState('telegram_bot_username', me.result.username)
  return me.result.username
}

/**
 * Registers the webhook (with its secret token) and the bot's commands when
 * the token, secret or URL changed since the last time. Called by the cron.
 */
export async function ensureTelegramWebhook(): Promise<'off' | 'ok' | 'set' | 'failed'> {
  if (!telegramConfigured()) return 'off'
  const url = publicUrl('/api/telegram')
  const fingerprint = await hashKey(`${process.env.TELEGRAM_BOT_TOKEN}|${process.env.TELEGRAM_WEBHOOK_SECRET}|${url}`)
  if ((await readState('telegram_webhook')) === fingerprint) return 'ok'
  const set = await api('setWebhook', {
    url,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
    max_connections: 5,
  })
  if (!set.ok) return 'failed'
  await api('setMyCommands', {
    commands: [
      { command: 'start', description: 'Connect this chat to Tend' },
      { command: 'stop', description: 'Disconnect: Tend stops messaging you here' },
    ],
  })
  await api('setMyDescription', {
    description: 'Tend reminds you when it is time to send someone a thoughtful message. Connect it from Settings in Tend.',
  })
  await writeState('telegram_webhook', fingerprint)
  const me = await api<{ username?: string }>('getMe', {})
  if (me.ok && me.result.username) await writeState('telegram_bot_username', me.result.username)
  return 'set'
}

/* Linking ------------------------------------------------------------------ */

/** A fresh one-time link for this user; earlier unused codes stop working. */
export async function createLinkUrl(userId: string, now = Date.now()): Promise<string | null> {
  const username = await botUsername()
  if (!username) return null
  const code = randomToken()
  await db.delete(telegramLinkCodes).where(eq(telegramLinkCodes.userId, userId))
  await db.insert(telegramLinkCodes).values({ codeHash: await hashKey(`telegram:${code}`), userId, expiresAt: now + LINK_CODE_TTL })
  return `https://t.me/${username}?start=${code}`
}

/** Spends a code: the user it was made for, once, before it expires. */
async function consumeCode(code: string, now: number): Promise<string | null> {
  const [row] = await db
    .delete(telegramLinkCodes)
    .where(and(eq(telegramLinkCodes.codeHash, await hashKey(`telegram:${code}`)), gt(telegramLinkCodes.expiresAt, now)))
    .returning({ userId: telegramLinkCodes.userId })
  await db.delete(telegramLinkCodes).where(lt(telegramLinkCodes.expiresAt, now))
  return row?.userId ?? null
}

async function userForChat(chatId: string): Promise<string | null> {
  const [row] = await db.select({ userId: userSettings.userId }).from(userSettings).where(eq(userSettings.telegramChatId, chatId))
  return row?.userId ?? null
}

export async function unlinkTelegram(userId: string): Promise<void> {
  await db.update(userSettings).set({ telegramChatId: null, telegramLinkedAt: null }).where(eq(userSettings.userId, userId))
}

/* Webhook ------------------------------------------------------------------ */

type Update = {
  message?: { chat?: { id?: number; type?: string }; text?: string }
  callback_query?: { id?: string; data?: string; message?: { message_id?: number; chat?: { id?: number }; text?: string } }
}

/** Constant-time comparison of the webhook's secret token header. */
export function webhookAuthorized(header: string | null): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!telegramConfigured() || !secret || !header || header.length !== secret.length) return false
  let diff = 0
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ header.charCodeAt(i)
  return diff === 0
}

export async function handleUpdate(update: Update, now = Date.now()): Promise<void> {
  if (update.callback_query) return handleCallback(update.callback_query, now)
  const message = update.message
  const chatId = message?.chat?.id
  if (!message || chatId === undefined || message.chat?.type !== 'private') return
  const chat = String(chatId)
  const linkedUser = await userForChat(chat)

  const code = parseStart(message.text)
  if (code !== null) {
    if (!code) {
      await sendTelegram(chat, linkedUser, linkedUser ? 'This chat is connected to Tend. Send /stop to disconnect.' : 'To connect, open Settings in Tend and choose "Connect Telegram".')
      return
    }
    const userId = await consumeCode(code, now)
    if (!userId) {
      await sendTelegram(chat, linkedUser, 'That link has expired or was already used. Open Settings in Tend for a new one.')
      return
    }
    // One chat per account and one account per chat.
    await db.update(userSettings).set({ telegramChatId: null, telegramLinkedAt: null }).where(eq(userSettings.telegramChatId, chat))
    await db.update(userSettings).set({ telegramChatId: chat, telegramLinkedAt: now, telegramReminders: true }).where(eq(userSettings.userId, userId))
    await sendTelegram(chat, userId, 'Connected to Tend. When a message is ready to send, the reminder comes here too. Send /stop at any time to disconnect.')
    return
  }

  if (isCommand(message.text, 'stop')) {
    if (linkedUser) await unlinkTelegram(linkedUser)
    // Not linked to anyone any more, so only the site-wide cap applies.
    await sendTelegram(chat, null, linkedUser ? 'Disconnected. Tend will not message you here again unless you connect it from Settings.' : 'This chat is not connected to Tend.')
    return
  }

  if (linkedUser) await sendTelegram(chat, linkedUser, 'Tend sends reminders here; it cannot read replies. Open Tend to change anything, or send /stop to disconnect.')
}

async function handleCallback(query: NonNullable<Update['callback_query']>, now: number): Promise<void> {
  const answer = (text: string) => api('answerCallbackQuery', { callback_query_id: query.id, text })
  const chatId = query.message?.chat?.id
  const action = parseCallback(query.data)
  const userId = chatId === undefined ? null : await userForChat(String(chatId))
  if (!action || !userId) {
    await answer('This chat is no longer connected to Tend.')
    return
  }
  let note: string
  if (action.action === 'sent') {
    const result = await recordSent(userId, action.messageId, now)
    note = result.ok
      ? `Marked as sent to ${result.contactName}.`
      : result.reason === 'consent'
        ? 'Not recorded: they asked not to get messages.'
        : 'This message was already sent, skipped or removed.'
  } else {
    const result = await snoozeDay(userId, action.messageId, now)
    const [settings] = await db.select({ timezone: userSettings.timezone }).from(userSettings).where(eq(userSettings.userId, userId))
    note = result.ok ? `Snoozed. Tend will remind you again ${formatWhen(result.until, settings?.timezone ?? 'UTC')}.` : 'This message was already sent, skipped or removed.'
  }
  await answer(note)
  // Replace the buttons with the outcome, so the reminder cannot be pressed twice.
  if (query.message?.message_id !== undefined && query.message.text) {
    await api('editMessageText', {
      chat_id: chatId,
      message_id: query.message.message_id,
      text: `${query.message.text}\n\n${note}`,
      link_preview_options: { is_disabled: true },
    })
  }
}

/* Reminders ---------------------------------------------------------------- */

/** One Telegram message per due item, each within the caps. Returns how many went. */
export async function sendTelegramReminders(chatId: string, userId: string, items: ReminderItem[], nudges: NudgeLine[] = []): Promise<number> {
  let sent = 0
  for (const item of items) {
    if (await sendTelegram(chatId, userId, reminderText(item), reminderKeyboard(item, publicUrl(`/send/${item.id}`)))) sent++
    else return sent
  }
  for (const nudge of nudges) {
    if (await sendTelegram(chatId, userId, nudgeText(nudge), nudgeKeyboard(publicUrl(nudge.path)))) sent++
    else break
  }
  return sent
}
