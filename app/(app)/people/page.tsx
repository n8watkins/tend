import type { Metadata } from 'next'
import Link from 'next/link'

import { PlusIcon } from '@/components/icons'
import { ConsentBadge, Done, Empty, PageTitle, RowLink } from '@/components/ui'
import { listContacts } from '@/lib/server/data'
import { getSettings, requireUser } from '@/lib/server/session'
import { formatWhen } from '@/lib/time'

export const metadata: Metadata = { title: 'People' }

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; done?: string }> }) {
  const user = await requireUser()
  const { q, done } = await searchParams
  const [people, settings] = await Promise.all([listContacts(user.id, q), getSettings(user.id)])
  return (
    <>
      <PageTitle
        title="People"
        action={
          <Link href="/people/new" className="btn btn-primary">
            <PlusIcon />
            Add someone
          </Link>
        }
      />
      <Done code={done} />
      <form role="search" className="mb-5 flex gap-2" action="/people">
        <label htmlFor="q" className="sr-only">
          Search people
        </label>
        <input id="q" name="q" type="search" defaultValue={q} placeholder="Search by name" className="input" />
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>
      {people.length ? (
        <ul className="space-y-3">
          {people.map((c) => (
            <li key={c.id}>
              <RowLink
                href={`/people/${c.id}`}
                title={c.name}
                meta={c.nextAt ? `Next: ${formatWhen(c.nextAt, settings.timezone)}` : 'Nothing scheduled'}
                badge={<ConsentBadge consent={c.consent} byRecipient={c.stoppedByRecipient} />}
              />
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{q ? `Nobody matches "${q}".` : 'No one here yet. Add the first person you would like to stay close to.'}</Empty>
      )}
    </>
  )
}
