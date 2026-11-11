import { eq } from 'drizzle-orm'
import type { Metadata } from 'next'

import { PublicHeader } from '@/components/PublicHeader'
import { SiteFooter } from '@/components/SiteFooter'
import { SubmitButton } from '@/components/SubmitButton'
import { db } from '@/db'
import { contacts, users } from '@/db/schema'

import { stopMessages } from './actions'

// No preview image or description, so a link preview in Signal stays plain,
// and never indexed.
export const metadata: Metadata = {
  title: 'Stop these messages',
  robots: { index: false, follow: false },
  openGraph: null,
  twitter: null,
}

export default async function StopPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params
  const { done } = await searchParams
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token)
  const row = valid
    ? await db
        .select({ consent: contacts.consent, senderName: users.name })
        .from(contacts)
        .innerJoin(users, eq(users.id, contacts.userId))
        .where(eq(contacts.stopToken, token))
        .get()
    : undefined
  const sender = row?.senderName?.trim().split(/\s+/)[0] || 'the person who sent you this link'
  const stopped = row?.consent === 'stopped'

  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto w-full max-w-md px-4 py-10">
        {!row ? (
          <>
            <h1 className="text-2xl font-bold">This link doesn&rsquo;t work</h1>
            <p className="mt-3 text-muted">It may have been copied incompletely, or the sender removed you from their list, in which case there is nothing to stop.</p>
          </>
        ) : done || stopped ? (
          <>
            <h1 className="text-2xl font-bold">Done</h1>
            <p className="mt-3 text-muted">
              Tend will no longer remind {sender} to send you these messages, and they will see that you asked to stop. Nothing else changes: you can still chat with them as usual.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Stop these messages?</h1>
            <p className="mt-3 text-muted">
              {sender[0]?.toUpperCase() + sender.slice(1)} uses Tend to remember to send you the occasional verse or quote on Signal. If you would rather not get them, press the button. They will see that you asked to stop.
            </p>
            <form action={stopMessages.bind(null, token)} className="mt-6">
              <SubmitButton className="btn btn-primary w-full" pending="Stopping...">
                Stop these messages
              </SubmitButton>
            </form>
            <p className="hint mt-4">This only affects messages sent with Tend. It doesn&rsquo;t block anyone on Signal.</p>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  )
}
