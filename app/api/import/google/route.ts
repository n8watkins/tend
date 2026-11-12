import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { auth } from '@/auth'
import { randomToken } from '@/lib/crypto'
import { IMPORT_READS_PER_USER_DAILY } from '@/lib/limits'
import { GOOGLE_STATE_COOKIE, googleAuthUrl, googleConfigured } from '@/lib/server/google'
import { readLimit, spend } from '@/lib/server/limits'
import { publicUrl } from '@/lib/url'

export const dynamic = 'force-dynamic'

/**
 * Starts a Google Contacts import: a one-time state in a short-lived cookie,
 * then off to Google's consent screen. Google sends the person back to
 * /people/import/google, which checks the state.
 */
export async function GET(): Promise<Response> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.redirect(publicUrl('/signin'))
  if (!googleConfigured()) return NextResponse.redirect(publicUrl('/people/import'))
  const allowed = await spend([{ key: `import:user:${userId}`, limit: readLimit('IMPORT_READS_PER_USER_DAILY', IMPORT_READS_PER_USER_DAILY) }]).catch(() => false)
  if (!allowed) return NextResponse.redirect(publicUrl('/people/import?google=limit'))
  const state = randomToken()
  ;(await cookies()).set(GOOGLE_STATE_COOKIE, `${userId}.${state}`, {
    httpOnly: true,
    secure: publicUrl('/').startsWith('https:'),
    sameSite: 'lax',
    path: '/people/import',
    maxAge: 10 * 60,
  })
  return NextResponse.redirect(googleAuthUrl(state))
}
