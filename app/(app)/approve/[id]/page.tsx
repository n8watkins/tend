import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CheckIcon } from '@/components/icons'
import { SubmitButton } from '@/components/SubmitButton'
import { PageTitle } from '@/components/ui'
import { FAILURE_TEXT, failureReason, sendByFor } from '@/lib/helper'
import { getContact, getMessage } from '@/lib/server/data'
import { activeHelper, APPROVAL_REFUSAL_TEXT, helperAllowedFor, type ApprovalRefusal } from '@/lib/server/helper'
import { getSettings, requireUser } from '@/lib/server/session'
import { formatMinutes, formatWhen } from '@/lib/time'

import { approveAction, confirmSentAction, sendAgainAction, skipApprovalAction } from '../../helper-actions'

export const metadata: Metadata = { title: 'Approve' }

const DONE: Record<string, string> = {
  approved: 'Approved. Your helper sends it within a minute or so.',
  skipped: 'Skipped. Nothing was sent.',
  confirmed: 'Marked as sent by your helper.',
}

/**
 * One approval (docs/SIGNAL-HELPER.md 3.1): the whole message with Send and
 * Skip. Notifications open this page; on iPhone, where notifications have no
 * buttons, this is where you approve.
 */
export default async function ApprovePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; error?: string }> }) {
  const user = await requireUser()
  if (!helperAllowedFor(user.email)) notFound()
  const { id } = await params
  const { done, error } = await searchParams
  const message = await getMessage(user.id, id)
  if (!message) notFound()
  const [contact, settings, device] = await Promise.all([getContact(user.id, message.contactId), getSettings(user.id), activeHelper(user.id)])
  if (!contact) notFound()
  const tz = settings.timezone
  const now = Date.now()
  const first = contact.name.split(' ')[0]
  const scheduled = message.status === 'scheduled'
  const idle = message.sendState === 'idle'
  const approved = scheduled && idle && message.approvalState === 'approved' && message.sendBy !== null && message.sendBy >= now

  // Why the helper cannot take it right now, if it cannot (the server checks again on Send).
  const blocked: ApprovalRefusal | null = !device
    ? 'no_helper'
    : message.kind === 'consent_request'
      ? 'kind'
      : contact.consent !== 'yes'
        ? 'consent'
        : !contact.phone
          ? 'no_phone'
          : settings.pausedAt
            ? 'paused'
            : message.scheduledFor > now
              ? 'not_due'
              : !sendByFor(contact, now)
                ? 'window'
                : null

  const subtitle =
    message.status === 'sent'
      ? message.sentVia === 'helper'
        ? `Sent by your helper ${formatWhen(message.sentAt ?? message.updatedAt, tz)}`
        : `Sent ${formatWhen(message.sentAt ?? message.updatedAt, tz)}`
      : message.status === 'skipped'
        ? 'Skipped'
        : message.status === 'canceled'
          ? 'Canceled'
          : message.sendState === 'sending'
            ? 'Your helper is sending it'
            : approved
              ? 'Approved'
              : `Due ${formatWhen(message.scheduledFor, tz)}`

  return (
    <>
      <PageTitle title={`Send to ${contact.name}?`} subtitle={subtitle} />
      {done && DONE[done] ? (
        <p role="status" className="notice notice-good mb-6">
          {DONE[done]}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="notice notice-danger mb-6">
          {APPROVAL_REFUSAL_TEXT[error as ApprovalRefusal] ?? 'That did not work. Please try again.'}
        </p>
      ) : null}

      <div className="rounded-2xl rounded-bl-md bg-accent-soft p-4 whitespace-pre-wrap break-words text-accent-soft-ink" data-testid="message-body">
        {message.body}
      </div>

      {message.status === 'sent' && message.sentVia === 'helper' ? (
        <p className="mt-4">
          <span className="badge badge-good">
            <CheckIcon className="size-3.5" />
            Sent by your helper
          </span>
        </p>
      ) : null}

      {scheduled && message.sendState === 'sending' ? (
        <p className="notice mt-6 bg-surface-2">Your helper is sending this now. Check back in a minute.</p>
      ) : null}

      {scheduled && message.sendState === 'unknown' ? (
        <div className="card mt-6 space-y-3">
          <p className="font-semibold">We are not sure this was sent.</p>
          <p>Your helper stopped before it could say. Check your Signal chat with {first}, then tell Tend.</p>
          <div className="flex flex-wrap gap-2">
            <form action={confirmSentAction.bind(null, message.id)}>
              <SubmitButton className="btn btn-primary">It was sent</SubmitButton>
            </form>
            {!blocked ? (
              <form action={sendAgainAction.bind(null, message.id)}>
                <SubmitButton className="btn btn-secondary">Send it again</SubmitButton>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}

      {scheduled && message.sendState === 'failed' ? (
        <div className="card mt-6 space-y-3">
          <p className="font-semibold">Your helper could not send it.</p>
          <p>{FAILURE_TEXT[failureReason(message.sendFailure)]}</p>
          <div className="flex flex-wrap gap-2">
            {!blocked ? (
              <form action={sendAgainAction.bind(null, message.id)}>
                <SubmitButton className="btn btn-primary">Send it again</SubmitButton>
              </form>
            ) : null}
            <Link href={`/send/${message.id}`} className="btn btn-secondary">
              Send it yourself
            </Link>
          </div>
        </div>
      ) : null}

      {approved ? (
        <div className="card mt-6 space-y-3">
          <p>
            Approved. Your helper sends this exact text within a minute or so. If your PC is off, it comes back to you at {formatWhen(message.sendBy!, tz)} to send
            yourself.
          </p>
          <form action={skipApprovalAction.bind(null, message.id)}>
            <SubmitButton className="btn btn-ghost">Don&rsquo;t send it, skip</SubmitButton>
          </form>
        </div>
      ) : null}

      {scheduled && idle && !approved ? (
        <div className="mt-6 space-y-4">
          {blocked ? (
            <p className="notice notice-warn">{APPROVAL_REFUSAL_TEXT[blocked]}</p>
          ) : (
            <div className="card space-y-3">
              <form action={approveAction.bind(null, message.id)}>
                <SubmitButton pending="Approving...">Send with my helper</SubmitButton>
              </form>
              <p className="hint">
                Your helper sends this exact text from your Signal, as a normal message to {first}, inside their window ({formatMinutes(contact.windowStart)} to{' '}
                {formatMinutes(contact.windowEnd)} their time).
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href={`/send/${message.id}`} className="btn btn-secondary">
              Send it yourself
            </Link>
            <form action={skipApprovalAction.bind(null, message.id)}>
              <SubmitButton className="btn btn-ghost">Skip</SubmitButton>
            </form>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/approvals" className="btn btn-ghost">
          All approvals
        </Link>
        <Link href={`/people/${contact.id}`} className="btn btn-ghost">
          {contact.name}
        </Link>
      </div>
    </>
  )
}
