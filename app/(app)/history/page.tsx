import type { Metadata } from 'next'

import { Empty, PageTitle, RowLink } from '@/components/ui'
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

export default async function HistoryPage() {
  const user = await requireUser()
  const [rows, settings] = await Promise.all([historyList(user.id), getSettings(user.id)])
  return (
    <>
      <PageTitle title="History" subtitle="Everything you sent, skipped or canceled." />
      {rows.length ? (
        <ul className="space-y-3">
          {rows.map((m) => {
            const item = getItem(m.contentId)
            const what = m.kind === 'consent_request' ? 'Asked about messages' : item ? itemTitle(item) : 'Personal message'
            const status = STATUS[m.status] ?? STATUS.canceled!
            return (
              <li key={m.id}>
                <RowLink
                  href={`/send/${m.id}`}
                  title={`${m.contactName}: ${what}`}
                  meta={formatWhen(m.sentAt ?? m.updatedAt, settings.timezone)}
                  badge={<span className={status.className}>{status.label}</span>}
                />
              </li>
            )
          })}
        </ul>
      ) : (
        <Empty>Nothing yet. Messages you send, skip or cancel show up here.</Empty>
      )}
    </>
  )
}
