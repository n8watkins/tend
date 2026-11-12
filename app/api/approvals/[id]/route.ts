import { z } from 'zod'

import { approvalByToken } from '@/lib/server/helper'
import { helperFeatureOn, ipKey, json, notFound, readJson } from '@/lib/server/helper-http'

export const dynamic = 'force-dynamic'

const schema = z.object({ action: z.enum(['send', 'skip']), token: z.string().max(80) })

/**
 * Send and Skip from a notification's buttons (public/sw.js). The approval
 * token in the push (an HMAC of the message id, its text and an expiry)
 * stands in for the session, so the buttons work with no open tab and no
 * other site can forge them. In the app, /approve/<id> uses server actions.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!helperFeatureOn()) return notFound()
  const { id } = await params
  const parsed = schema.safeParse(await readJson(request))
  if (!parsed.success || !/^[\w-]{1,64}$/.test(id)) return json({ ok: false, text: 'Open Tend to send it.' }, 400)
  const result = await approvalByToken(id, parsed.data.token, parsed.data.action, await ipKey(request))
  return json({ ok: result.ok, text: result.text }, result.ok ? 200 : result.status)
}
