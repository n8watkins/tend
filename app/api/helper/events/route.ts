import { z } from 'zod'

import { HELPER_REPORTED_EVENTS, reportEvent } from '@/lib/server/helper'
import { json, readJson, withHelper } from '@/lib/server/helper-http'

export const dynamic = 'force-dynamic'

const schema = z.object({ kind: z.enum(HELPER_REPORTED_EVENTS) })

/** challenge (a captcha: all sending stops until the user resumes), unlinked, outdated. */
export function POST(request: Request): Promise<Response> {
  return withHelper(request, async (auth) => {
    const parsed = schema.safeParse(await readJson(request))
    if (!parsed.success) return json({ error: 'bad_request' }, 400)
    await reportEvent(auth, parsed.data.kind)
    return json({ ok: true })
  })
}
