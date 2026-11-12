import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CopyButton } from '@/components/CopyButton'
import { ChatIcon, CheckIcon, ClockIcon, SendIcon } from '@/components/icons'
import { RescheduleForm } from '@/components/RescheduleForm'
import { ShareButton } from '@/components/ShareButton'
import { SubmitButton } from '@/components/SubmitButton'
import { Monogram, PageTitle, Section } from '@/components/ui'
import { signalChatUrl } from '@/lib/format'
import { smsShareUrl, telegramShareUrl, whatsappShareUrl } from '@/lib/share'
import { getContact, getMessage } from '@/lib/server/data'
import { activeHelper, helperAllowedFor } from '@/lib/server/helper'
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
  const helper = helperAllowedFor(user.email) && settings.helperEnabled ? await activeHelper(user.id) : null
  const now = Date.now()
  const first = contact.name.split(' ')[0]
  const waiting = message.status === 'scheduled'
  const early = waiting && message.scheduledFor > now
  const state = waiting
    ? early
      ? `Scheduled for ${formatWhen(message.scheduledFor, settings.timezone)}`
      : 'Ready to send'
    : message.status === 'sent' && message.sentAt
      ? `Sent ${formatWhen(message.sentAt, settings.timezone)}`
      : message.status === 'skipped'
        ? 'Skipped'
        : 'Canceled'

  return (
    <>
      <PageTitle
        eyebrow={state}
        lead={<Monogram name={contact.name} size="lg" />}
        title={message.kind === 'consent_request' ? `Ask ${contact.name}` : `Message ${contact.name}`}
        subtitle={waiting ? `Copy it, paste it into your Signal chat with ${first}, then mark it sent.` : `What you ${message.status === 'sent' ? 'sent' : 'had ready for'} ${first}.`}
        action={
          <Link href={`/people/${contact.id}`} className="btn btn-secondary">
            Back to {contact.name}
          </Link>
        }
      />
      {error === 'consent' ? (
        <p role="alert" className="notice notice-danger mb-6">
          {contact.name} asked not to get these messages, so this one can&rsquo;t be marked as sent.
        </p>
      ) : null}
      {error === 'helper_sending' || (waiting && message.sendState === 'sending') ? (
        <p role="alert" className="notice notice-warn mb-6">
          Your Signal helper is sending this message right now, so it can&rsquo;t be changed. Check back in a minute.
        </p>
      ) : null}

      <div className="app-columns">
        <div className="app-col">
          <Section title="The message" id="message-title" icon={ChatIcon} hint={`Exactly what ${first} will get.`}>
            <div className="chat-stage">
              <div className="chat-bubble" data-testid="message-body">
                {message.body}
              </div>
            </div>
            {message.status === 'sent' && message.sentVia === 'helper' ? (
              <p>
                <span className="badge badge-good">
                  <CheckIcon className="size-3.5" />
                  Sent by your helper
                </span>
              </p>
            ) : null}
          </Section>

          {waiting ? (
            <Section title="Not now?" id="later-title" icon={ClockIcon} tone="quiet" hint="Move it to another time, or skip it.">
              <RescheduleForm
                action={rescheduleMessage.bind(null, message.id)}
                defaultAt={toLocalInput(Math.max(message.scheduledFor, now + 60 * 60 * 1000), contact.timezone)}
                timezoneLabel={contact.timezone.replace(/_/g, ' ')}
              />
              <form action={skipMessage.bind(null, message.id)} className="border-t border-line pt-4">
                <p className="hint mb-2">Skipping keeps it in their history as not sent.</p>
                <SubmitButton className="btn btn-ghost btn-flush">Skip this message</SubmitButton>
              </form>
            </Section>
          ) : null}
        </div>

        {waiting ? (
          <div className="app-col app-col-sticky">
            {helper && !early && message.kind !== 'consent_request' && message.sendState !== 'sending' ? (
              <Section title="Signal helper" id="helper-title" icon={SendIcon} hint="Your own computer can send this one for you.">
                <p>
                  {message.sendState === 'unknown' || message.sendState === 'failed'
                    ? 'Your helper could not confirm this one.'
                    : message.approvalState === 'approved'
                      ? 'Approved for your Signal helper.'
                      : 'Or let your Signal helper send it.'}
                </p>
                <Link href={`/approve/${message.id}`} className="btn btn-secondary btn-sm">
                  {message.approvalState === 'approved' || message.sendState !== 'idle' ? 'See status' : 'Send with my helper'}
                </Link>
              </Section>
            ) : null}

            <Section title="Send it in three steps" id="steps-title" icon={SendIcon} tone="primary" hint="Tend never sends for you; you send it yourself.">
              <ol className="steps">
                <li>
                  <p className="step-title">Copy the message</p>
                  <div className="flex flex-wrap gap-2">
                    <CopyButton text={message.body} />
                    <ShareButton text={message.body} />
                  </div>
                </li>
                <li>
                  <p className="step-title">Paste it into your Signal chat with {first}</p>
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
                  <details className="text-sm">
                    <summary className="cursor-pointer font-semibold text-accent">Not on Signal? Send it another way</summary>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a href={whatsappShareUrl(message.body)} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                        WhatsApp
                      </a>
                      <a href={smsShareUrl(message.body)} className="btn btn-secondary btn-sm">
                        Text message
                      </a>
                      <a href={telegramShareUrl(message.body)} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                        Telegram
                      </a>
                    </div>
                    <p className="hint mt-2">Each opens the app with the message filled in; you pick {first} and press send.</p>
                  </details>
                </li>
                <li>
                  <p className="step-title">Once it&rsquo;s sent</p>
                  <form action={markSent.bind(null, message.id)}>
                    <SubmitButton pending="Saving..." className="btn btn-secondary">
                      <CheckIcon />I sent it
                    </SubmitButton>
                  </form>
                </li>
              </ol>
            </Section>
          </div>
        ) : null}
      </div>
    </>
  )
}
