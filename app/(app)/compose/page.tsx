import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { ComposeForm } from '@/components/ComposeForm'
import { PageTitle } from '@/components/ui'
import { MESSAGE_KINDS, type MessageKind } from '@/lib/enums'
import { getItem } from '@/lib/content'
import { consentRequestBody } from '@/lib/format'
import { allowedKinds, checkTime, nextGoodTime, REFUSAL_TEXT } from '@/lib/schedule'
import { contactHistory, getContact, openConsentRequests, sentCount } from '@/lib/server/data'
import { getSettings, requireUser } from '@/lib/server/session'
import { formatWhen, toLocalInput } from '@/lib/time'
import { publicUrl } from '@/lib/url'

export const metadata: Metadata = { title: 'Compose' }

export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string; content?: string; kind?: string }>
}) {
  const user = await requireUser()
  const params = await searchParams
  if (!params.contact) redirect('/people')
  const contact = await getContact(user.id, params.contact)
  if (!contact) notFound()
  const item = getItem(params.content)
  const kind: MessageKind = item
    ? 'content'
    : MESSAGE_KINDS.includes(params.kind as MessageKind)
      ? (params.kind as MessageKind)
      : 'personal'

  const [settings, history, openRequests, sent] = await Promise.all([
    getSettings(user.id),
    contactHistory(user.id, contact.id),
    openConsentRequests(user.id, contact.id),
    sentCount(user.id, contact.id),
  ])

  if (!allowedKinds(contact.consent).includes(kind)) {
    return (
      <>
        <PageTitle title={`Message ${contact.name}`} />
        <p className="notice notice-warn">
          {contact.consent === 'yes'
            ? `${contact.name} already said yes, so there is no need to ask again.`
            : `${contact.name} has not said yes to messages, so Tend can only help you ask first.`}
        </p>
        <Link href={`/people/${contact.id}`} className="btn btn-secondary mt-4">
          Back to {contact.name}
        </Link>
      </>
    )
  }

  const now = Date.now()
  const rules = contact
  const paused = Boolean(settings.pausedAt)
  const nextAt = paused ? null : nextGoodTime(rules, history, now, Math.random, kind)
  const nowRefusal = checkTime(rules, kind, history, now, now, { paused, openRequests })
  const title =
    kind === 'consent_request' ? `Ask ${contact.name}` : kind === 'personal' ? `Write to ${contact.name}` : `Send to ${contact.name}`
  const sameZone = contact.timezone === settings.timezone
  const nextLabel = nextAt
    ? `${formatWhen(nextAt, contact.timezone)}${sameZone ? '' : ` (${formatWhen(nextAt, settings.timezone)} for you)`}`
    : null

  return (
    <>
      <PageTitle
        title={title}
        subtitle={kind === 'consent_request' ? 'Edit it so it sounds like you.' : item ? item.context : undefined}
      />
      {paused ? (
        <p className="notice notice-warn mb-6">Tend is paused. Resume it to schedule messages.</p>
      ) : null}
      <ComposeForm
        contactId={contact.id}
        contactName={contact.name}
        kind={kind}
        item={item}
        translation={settings.translation}
        initialNote={kind === 'consent_request' ? consentRequestBody(contact.name, contact.minDaysBetween) : ''}
        stopUrl={publicUrl(`/stop/${contact.stopToken}`)}
        stopLinkDefault={sent < 3}
        nextAt={nextAt}
        nextLabel={nextLabel}
        nowAllowed={!nowRefusal}
        nowRefusal={nowRefusal ? REFUSAL_TEXT[nowRefusal] : null}
        customDefault={toLocalInput(nextAt ?? now + 60 * 60 * 1000, contact.timezone)}
        timezoneLabel={contact.timezone.replace(/_/g, ' ')}
      />
    </>
  )
}
