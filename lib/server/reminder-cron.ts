import 'server-only'

import { sweepHelper } from '@/lib/server/helper'
import { runReminders } from '@/lib/server/reminders'
import { ensureTelegramWebhook } from '@/lib/server/telegram'

/**
 * One scheduled reminder run: registers the Telegram webhook once the bot's
 * secrets are set (or change), settles the Signal helper's lapsed leases and
 * approvals, then sends what is due. Called by the Cron Trigger directly
 * (worker/cron.ts) and by POST /api/cron/reminders, so both behave the same.
 * `now` is only ever moved by the end-to-end suite (test mode).
 */
export async function runReminderCron(now = Date.now()) {
  const webhook = await ensureTelegramWebhook().catch(() => 'failed' as const)
  const helper = await sweepHelper(now)
  const result = await runReminders(now)
  console.log(JSON.stringify({ event: 'reminders', webhook, ...result, helperUnknown: helper.unknown, helperExpired: helper.expired }))
  return { ...result, helper }
}
