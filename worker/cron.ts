import { setCronMailroom, type MailroomBinding } from '../lib/server/email'
import { runReminderCron } from '../lib/server/reminder-cron'

/**
 * The Cron Trigger's reminder run (every 15 minutes, wrangler.jsonc). It calls
 * the reminder code directly, so a run loads no Next.js routing or page code.
 * Secrets and vars reach process.env on their own (nodejs_compat); the mailroom
 * binding is handed over here because the cron has no request context.
 * A failed run throws, so Cloudflare records the cron run as failed.
 */
export async function scheduledReminders(
  env: { MAILROOM?: unknown },
  run: () => Promise<unknown> = runReminderCron,
): Promise<void> {
  setCronMailroom(env.MAILROOM as MailroomBinding | undefined)
  await run()
}
