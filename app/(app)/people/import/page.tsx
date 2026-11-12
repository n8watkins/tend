import type { Metadata } from 'next'
import Link from 'next/link'

import { ImportFlow } from '@/components/ImportFlow'
import { PageTitle } from '@/components/ui'
import { googleConfigured } from '@/lib/server/google'
import { requireUser } from '@/lib/server/session'

export const metadata: Metadata = { title: 'Import people' }

const GOOGLE_ERRORS: Record<string, string> = {
  denied: 'Google import was canceled. Nothing was read.',
  state: 'That Google sign-in had expired. Start it again.',
  exchange: 'Google did not accept that sign-in. Start it again.',
  scope: 'Tend needs permission to see your contacts. Start again and tick the contacts box.',
  fetch: 'Your Google contacts could not be read just now. Try again in a minute.',
  limit: 'That is enough imports for today. Try again tomorrow.',
  empty: 'No contacts with a name were found in your Google account.',
}

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  await requireUser()
  const { google } = await searchParams
  return (
    <>
      <PageTitle title="Import people" subtitle="Bring in the people you want to keep in touch with, with their birthdays." />
      {google && GOOGLE_ERRORS[google] ? (
        <p role="alert" className="notice notice-danger mb-6">
          {GOOGLE_ERRORS[google]}
        </p>
      ) : null}
      {googleConfigured() ? (
        <section aria-labelledby="google-title" className="card mb-6 space-y-3">
          <h2 id="google-title" className="font-bold">
            From Google Contacts
          </h2>
          <p className="text-sm">
            Sign in with Google and Tend reads your contacts once, to show you the list. It keeps no access afterwards.
          </p>
          <p className="hint">Google may say Tend is not verified yet. That is expected while Google reviews it; choose Continue to go on.</p>
          {/* A plain link (not a form), so the browser may follow the redirect to Google. */}
          <a href="/api/import/google" className="btn btn-secondary">
            Import from Google
          </a>
        </section>
      ) : null}
      <h2 className="mb-3 text-lg font-bold">From a file</h2>
      <ImportFlow />
      <p className="mt-8 text-sm">
        <Link href="/people" className="underline underline-offset-2">
          Back to People
        </Link>
      </p>
    </>
  )
}
