import { runReminderCron } from '@/lib/server/reminder-cron'
import { isTestMode } from '@/lib/testMode'

export const dynamic = 'force-dynamic'

/**
 * A manual (and end-to-end) trigger for the reminder run, with
 * `Authorization: Bearer $CRON_SECRET`. The Cron Trigger itself does not come
 * through here: worker/cron.ts calls the same code directly every 15 minutes.
 * In test mode only, `?now=<ms>` runs it as if at that time.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  const at = Number(new URL(request.url).searchParams.get('now'))
  const now = Number.isSafeInteger(at) && at > 0 && isTestMode() ? at : Date.now()
  return Response.json(await runReminderCron(now))
}
