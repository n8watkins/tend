import { z } from 'zod'

import { pairHelper } from '@/lib/server/helper'
import { helperFeatureOn, ipKey, json, notFound, readJson } from '@/lib/server/helper-http'

export const dynamic = 'force-dynamic'

const schema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().trim().max(60).optional().default('Tend helper'),
  helperVersion: z.string().max(20).optional(),
})

/** `tend-helper pair <code>`: a one-time code from Settings for a device token, shown once. */
export async function POST(request: Request): Promise<Response> {
  if (!helperFeatureOn()) return notFound()
  const parsed = schema.safeParse(await readJson(request))
  if (!parsed.success) return json({ error: 'bad_request' }, 400)
  const result = await pairHelper(parsed.data, await ipKey(request))
  if (!result.ok) return json({ error: result.status === 429 ? 'rate_limited' : result.status === 400 ? 'bad_code' : 'invalid_code' }, result.status)
  return json({ token: result.token })
}
