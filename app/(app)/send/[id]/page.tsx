import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CopyButton } from '@/components/CopyButton'
import { ChatIcon, CheckIcon } from '@/components/icons'
import { RescheduleForm } from '@/components/RescheduleForm'
import { ShareButton } from '@/components/ShareButton'
import { SubmitButton } from '@/components/SubmitButton'
import { PageTitle } from '@/components/ui'
import { signalChatUrl } from '@/lib/format'
import { getContact, getMessage } from '@/lib/server/data'
import { getSettings, requireUser } from '@/lib/server/session'
import { formatWhen, toLocalInput } from '@/lib/time'

import { markSent, rescheduleMessage, skipMessage } from '../../actions'

export const metadata: Metadata = { title: 'Send' }

export default async function SendPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser()
  const { id } = await params
  const { error } = await searchParams
  const message = await getMessage(user.id, id)
  if (!message) notFound()
  const [contact, settings] = await Promise.all([getContact(user.id, message.contactId), getSettings(user.id)])
  if (!contact) notFound()
  const now = Date.now()
  const first = contact.name.split(' ')[0]
  const waiting = message.status === 'scheduled'
  const early = waiting && message.scheduledFor > now

  return (
    <>
      <PageTitle
        title={message.kind === 'consent_request' ? `Ask ${contact.name}` : `Message ${contact.name}`}
        subtitle={
          waiting
            ? early
              ? `Scheduled for ${formatWhen(message.scheduledFor, settings.timezone)}`
              : 'Ready to send'
            : message.status === 'sent' && message.sentAt
              ? `Sent ${formatWhen(message.sentAt, settings.timezone)}`
              : message.status === 'skipped'
                ? 'Skipped'
                : 'Canceled'
        }
      />
      {error === 'consent' ? (
        <p role="alert" className="notice notice-danger mb-6">
          {contact.name} asked not to get these messages, so this one can&rsquo;t be marked as sent.
        </p>
      ) : null}

      <div className="rounded-2xl rounded-bl-md bg-accent-soft p-4 whitespace-pre-wrap break-words text-accent-soft-ink" data-testid="message-body">
        {message.body}
      </div>

      {waiting ? (
        <>
          <ol className="mt-6 space-y-4">
            <li className="card space-y-3">
              <p className="font-semibold">1. Copy the message</p>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={message.body} />
                <ShareButton text={message.body} />
              </div>
            </li>
            <li className="card space-y-3">
              <p className="font-semibold">2. Paste it into your Signal chat with {first}</p>
              {contact.phone ? (
                <a href={signalChatUrl(contact.phone)} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                  <ChatIcon />
                  Open chat with {first} in Signal
                </a>
              ) : (
                <p className="hint">
                  Open Signal and find {first}.{' '}
                  <Link href={`/people/${contact.id}/edit`} className="underline underline-offset-2">
                    Add their number
                  </Link>{' '}
                  to open the chat in one tap next time.
                </p>
              )}
            </li>
            <li className="card space-y-3">
              <p className="font-semibold">3. Once it&rsquo;s sent</p>
              <form action={markSent.bind(null, message.id)}>
                <SubmitButton pending="Saving...">
                  <CheckIcon />I sent it
                </SubmitButton>
              </form>
            </li>
          </ol>

          <details className="card mt-6">
            <summary className="cursor-pointer font-semibold">Not now?</summary>
            <div className="mt-4 space-y-5">
              <RescheduleForm
                action={rescheduleMessage.bind(null, message.id)}
                defaultAt={toLocalInput(Math.max(message.scheduledFor, now + 60 * 60 * 1000), contact.timezone)}
                timezoneLabel={contact.timezone.replace(/_/g, ' ')}
              />
              <form action={skipMessage.bind(null, message.id)}>
                <p className="hint mb-2">Skipping keeps it in their history as not sent.</p>
                <SubmitButton className="btn btn-ghost">Skip this message</SubmitButton>
              </form>
            </div>
          </details>
        </>
      ) : null}

      <Link href={`/people/${contact.id}`} className="btn btn-ghost mt-6">
        Back to {contact.name}
      </Link>
    </>
  )
}
