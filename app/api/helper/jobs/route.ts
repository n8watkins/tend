import { helperJobs } from '@/lib/server/helper'
import { json, withHelper } from '@/lib/server/helper-http'

export const dynamic = 'force-dynamic'

const version = (value: string | null) => (value && /^[\w.+-]{1,20}$/.test(value) ? value : null)

/** The helper's poll and heartbeat: approved jobs (ids only), pause and halt state, caps. */
export function GET(request: Request): Promise<Response> {
  return withHelper(request, async (auth) =>
    json(
      await helperJobs(auth, {
        helperVersion: version(request.headers.get('x-tend-helper-version')),
        signalCliVersion: version(request.headers.get('x-signal-cli-version')),
      }),
    ),
  )
}
