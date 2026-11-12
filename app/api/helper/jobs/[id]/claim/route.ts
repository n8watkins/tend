import { claimJob } from '@/lib/server/helper'
import { json, withHelper } from '@/lib/server/helper-http'

export const dynamic = 'force-dynamic'

/**
 * Re-checks every rule and leases the message to this claim (10 minutes).
 * 200 with the recipient and text, or 409 with the reason it may not be sent.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params
  return withHelper(request, async (auth) => {
    if (!/^[\w-]{1,64}$/.test(id)) return json({ error: 'not_found' }, 404)
    const result = await claimJob(auth, id)
    if (result.ok) return json(result.job)
    return json({ error: result.reason, ...(result.retryAt ? { retryAt: result.retryAt } : {}) }, result.reason === 'not_found' ? 404 : 409)
  })
}
