import type { Metadata } from 'next'

import { HistoryIcon } from '@/components/icons'
import { Empty, Monogram, PageTitle, RowLink, Section } from '@/components/ui'
import { getItem, itemTitle } from '@/lib/content'
import { historyList } from '@/lib/server/data'
import { getSettings, requireUser } from '@/lib/server/session'
import { formatWhen } from '@/lib/time'

export const metadata: Metadata = { title: 'History' }

const STATUS: Record<string, { label: string; className: string }> = {
  sent: { label: 'Sent', className: 'badge badge-good' },
  skipped: { label: 'Skipped', className: 'badge' },
  canceled: { label: 'Canceled', className: 'badge badge-warn' },
}

const HELPER_SENT = { label: 'Sent by your helper', className: 'badge badge-good' }

export default async function HistoryPage() {
  const user = await requireUser()
  const [rows, settings] = await Promise.all([historyList(user.id), getSettings(user.id)])
  return (
    <>
      <PageTitle title="History" subtitle="Everything you sent, skipped or canceled, newest first." />
      <Section title="All messages" id="all" icon={HistoryIcon} hint={rows.length ? `${rows.length} so far. Open one to see exactly what went out.` : undefined}>
      {rows.length ? (
        <ul>
          {rows.map((m) => {
            const item = getItem(m.contentId)
            const what = m.kind === 'consent_request' ? 'Asked about messages' : item ? itemTitle(item) : 'Personal message'
            // Everything the Signal helper sent in your name is marked as such.
            const status = m.status === 'sent' && m.sentVia === 'helper' ? HELPER_SENT : (STATUS[m.status] ?? STATUS.canceled!)
            return (
              <li key={m.id}>
                <RowLink
                  href={`/send/${m.id}`}
                  lead={<Monogram name={m.contactName} />}
                  title={`${m.contactName}: ${what}`}
                  meta={formatWhen(m.sentAt ?? m.updatedAt, settings.timezone)}
                  badge={<span className={status.className}>{status.label}</span>}
                />
              </li>
            )
          })}
        </ul>
      ) : (
        <Empty icon={HistoryIcon}>Nothing yet. Messages you send, skip or cancel show up here.</Empty>
      )}
      </Section>
    </>
  )
}
