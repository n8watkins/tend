import { runReminders } from '@/lib/server/reminders'
import { ensureTelegramWebhook } from '@/lib/server/telegram'

export const dynamic = 'force-dynamic'

/**
 * The Cron Trigger's run (worker/index.ts calls this in-process every 15
 * minutes with `Authorization: Bearer $CRON_SECRET`). The end-to-end suite
 * calls it the same way.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  // Registers the Telegram webhook once the bot's secrets are set (or change).
  const webhook = await ensureTelegramWebhook().catch(() => 'failed' as const)
  const result = await runReminders()
  console.log(JSON.stringify({ event: 'reminders', webhook, ...result }))
  return Response.json(result)
}
