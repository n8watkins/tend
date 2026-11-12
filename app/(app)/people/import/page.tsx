import type { Metadata } from 'next'
import Link from 'next/link'

import { ImportFlow } from '@/components/ImportFlow'
import { PeopleIcon, UploadIcon } from '@/components/icons'
import { PageTitle, Section } from '@/components/ui'
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
      <PageTitle
        eyebrow="People"
        title="Import people"
        subtitle="Bring in the people you want to keep in touch with, with their birthdays. You choose who to add."
        action={
          <Link href="/people" className="btn btn-secondary">
            Back to People
          </Link>
        }
      />
      {google && GOOGLE_ERRORS[google] ? (
        <p role="alert" className="notice notice-danger mb-6">
          {GOOGLE_ERRORS[google]}
        </p>
      ) : null}
      {googleConfigured() ? (
        <Section title="From Google Contacts" id="google-title" icon={PeopleIcon} hint="Tend reads your contacts once, to show you the list, and keeps no access.">
          <p className="hint">Google may say Tend is not verified yet. That is expected while Google reviews it; choose Continue to go on.</p>
          {/* A plain link (not a form), so the browser may follow the redirect to Google. */}
          <a href="/api/import/google" className="btn btn-secondary">
            Import from Google
          </a>
        </Section>
      ) : null}
      <Section title="From a file" id="file-title" icon={UploadIcon} tone="primary" hint="A contacts export from your phone (.vcf) or a spreadsheet (.csv).">
        <ImportFlow />
      </Section>
    </>
  )
}
