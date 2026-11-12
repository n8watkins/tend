import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Empty, PageTitle, RowLink, Section } from '@/components/ui'
import { getItem, itemTitle } from '@/lib/content'
import { approvalQueue, helperAllowedFor, helperStatus, type QueueItem } from '@/lib/server/helper'
import { getSettings, requireUser } from '@/lib/server/session'
import { formatWhen } from '@/lib/time'

export const metadata: Metadata = { title: 'Approvals' }

function what(m: QueueItem) {
  const item = getItem(m.contentId)
  return item ? itemTitle(item) : 'Personal message'
}

/** The approval queue (docs/SIGNAL-HELPER.md 8.3): what waits on you, what is with your helper, and what needs a look. */
export default async function ApprovalsPage() {
  const user = await requireUser()
  if (!helperAllowedFor(user.email)) notFound()
  const [settings, queue, status] = await Promise.all([getSettings(user.id), approvalQueue(user.id), helperStatus(user.id)])
  const tz = settings.timezone
  const now = Date.now()
  const waiting = queue.filter((m) => m.approvalState === 'pending' && m.sendState === 'idle')
  const withHelper = queue.filter((m) => (m.approvalState === 'approved' && m.sendState === 'idle') || m.sendState === 'sending')
  const needsLook = queue.filter((m) => m.sendState === 'unknown' || m.sendState === 'failed')
  const device = status.device

  return (
    <>
      <PageTitle
        title="Approvals"
        subtitle={
          !status.enabled || !device
            ? 'Your Signal helper is not set up.'
            : device.online
              ? 'Your helper is online.'
              : device.lastSeenAt
                ? `Your helper is offline since ${formatWhen(device.lastSeenAt, tz)}. You can still send messages yourself.`
                : 'Your helper has not connected yet.'
        }
      />
      {!status.enabled || !device ? (
        <p className="notice notice-warn mb-6">
          Set up your helper in{' '}
          <Link href="/settings#helper" className="underline underline-offset-2">
            Settings
          </Link>{' '}
          first.
        </p>
      ) : null}

      <Section title="Waiting for you" id="waiting">
        {waiting.length ? (
          <ul className="space-y-3">
            {waiting.map((m) => (
              <li key={m.id}>
                <RowLink
                  href={`/approve/${m.id}`}
                  title={`${m.contactName}: ${what(m)}`}
                  meta={`Due ${formatWhen(m.scheduledFor, tz)}`}
                  badge={<span className="badge badge-good">Approve</span>}
                />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nothing waiting. When a message is due, it shows up here and on your phone.</Empty>
        )}
      </Section>

      {needsLook.length ? (
        <Section title="Needs a look" id="check">
          <ul className="space-y-3">
            {needsLook.map((m) => (
              <li key={m.id}>
                <RowLink
                  href={`/approve/${m.id}`}
                  title={`${m.contactName}: ${what(m)}`}
                  meta={m.sendState === 'unknown' ? 'Not sure it was sent. Check your Signal chat.' : 'Your helper could not send it.'}
                  badge={<span className="badge badge-warn">{m.sendState === 'unknown' ? 'Not sure' : 'Not sent'}</span>}
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {withHelper.length ? (
        <Section title="With your helper" id="sending">
          <ul className="space-y-3">
            {withHelper.map((m) => (
              <li key={m.id}>
                <RowLink
                  href={`/approve/${m.id}`}
                  title={`${m.contactName}: ${what(m)}`}
                  meta={
                    m.sendState === 'sending'
                      ? 'Sending now'
                      : m.sendBy && m.sendBy > now
                        ? `Approved. Sends soon, or comes back to you at ${formatWhen(m.sendBy, tz)}.`
                        : 'Approved'
                  }
                  badge={<span className="badge">{m.sendState === 'sending' ? 'Sending' : 'Approved'}</span>}
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  )
}
