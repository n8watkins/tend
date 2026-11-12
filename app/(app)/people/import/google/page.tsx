import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { ImportFlow } from '@/components/ImportFlow'
import { PageTitle } from '@/components/ui'
import { GOOGLE_STATE_COOKIE, googleConfigured, readGoogleContacts } from '@/lib/server/google'
import { previewRows } from '@/lib/server/import'
import { requireUser } from '@/lib/server/session'

export const metadata: Metadata = { title: 'Import from Google' }
export const dynamic = 'force-dynamic'

/**
 * Google's redirect after the consent screen. Checks the one-time state,
 * reads the contacts with the code (the token is used once and revoked),
 * and shows the same review as a file import. Nothing is stored until the
 * person chooses who to import.
 */
export default async function GoogleImportPage({ searchParams }: { searchParams: Promise<{ code?: string; state?: string; error?: string }> }) {
  const user = await requireUser()
  if (!googleConfigured()) redirect('/people/import')
  const { code, state, error } = await searchParams
  if (error) redirect('/people/import?google=denied')
  const expected = (await cookies()).get(GOOGLE_STATE_COOKIE)?.value
  if (!code || !state || !expected || expected !== `${user.id}.${state}`) redirect('/people/import?google=state')

  const result = await readGoogleContacts(code)
  if (!result.ok) redirect(`/people/import?google=${result.reason}`)
  if (!result.rows.length) redirect('/people/import?google=empty')
  const rows = await previewRows(user.id, result.rows)
  return (
    <>
      <PageTitle title="Import from Google" subtitle="Choose who to bring into Tend." />
      <ImportFlow initial={{ step: 'review', source: 'google', rows, truncated: result.truncated }} />
    </>
  )
}
