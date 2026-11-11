import { handleUpdate, telegramConfigured, webhookAuthorized } from '@/lib/server/telegram'

export const dynamic = 'force-dynamic'

/**
 * The Telegram bot's webhook (lib/server/telegram.ts). Off (404) until the bot
 * is configured; refused (401) without Telegram's secret token header. A
 * handled update always answers 200, so Telegram never retries it.
 */
export async function POST(request: Request): Promise<Response> {
  if (!telegramConfigured()) return new Response('Not found', { status: 404 })
  if (!webhookAuthorized(request.headers.get('x-telegram-bot-api-secret-token'))) return new Response('Unauthorized', { status: 401 })
  const update = await request.json().catch(() => null)
  if (!update || typeof update !== 'object') return new Response('Bad request', { status: 400 })
  try {
    await handleUpdate(update)
  } catch (error) {
    console.error(JSON.stringify({ event: 'telegram_update_failed', name: error instanceof Error ? error.name : 'Error' }))
  }
  return new Response('ok')
}
