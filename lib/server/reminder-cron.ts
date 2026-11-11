import 'server-only'

import { runReminders } from '@/lib/server/reminders'
import { ensureTelegramWebhook } from '@/lib/server/telegram'

/**
 * One scheduled reminder run: registers the Telegram webhook once the bot's
 * secrets are set (or change), then sends what is due. Called by the Cron
 * Trigger directly (worker/cron.ts) and by POST /api/cron/reminders, so both
 * behave the same.
 */
export async function runReminderCron() {
  const webhook = await ensureTelegramWebhook().catch(() => 'failed' as const)
  const result = await runReminders()
  console.log(JSON.stringify({ event: 'reminders', webhook, ...result }))
  return result
}
