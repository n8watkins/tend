import { runReminders } from '@/lib/server/reminders'

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
  const result = await runReminders()
  console.log(JSON.stringify({ event: 'reminders', ...result }))
  return Response.json(result)
}
