import { z } from 'zod'

import { reportResult } from '@/lib/server/helper'
import { json, readJson, withHelper } from '@/lib/server/helper-http'

export const dynamic = 'force-dynamic'

const schema = z.object({
  claimId: z.string().uuid(),
  outcome: z.enum(['sent', 'failed', 'unknown']),
  signalTimestamp: z.number().int().positive().nullable().optional(),
  reason: z.string().max(40).optional(),
})

/** sent, failed or unknown for one claim; accepted once, a repeat returns the first answer. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params
  return withHelper(request, async (auth) => {
    const parsed = schema.safeParse(await readJson(request))
    if (!parsed.success || !/^[\w-]{1,64}$/.test(id)) return json({ error: 'bad_request' }, 400)
    const result = await reportResult(auth, id, parsed.data)
    if (!result.ok) return json({ error: result.reason }, result.status)
    return json({ sendState: result.sendState, repeat: result.repeat })
  })
}
