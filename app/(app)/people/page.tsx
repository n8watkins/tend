import type { Metadata } from 'next'
import Link from 'next/link'

import { PeopleIcon, PlusIcon, UploadIcon } from '@/components/icons'
import { ConsentBadge, Done, Empty, Monogram, PageTitle, RowLink, Section } from '@/components/ui'
import { listContacts } from '@/lib/server/data'
import { getSettings, requireUser } from '@/lib/server/session'
import { formatWhen } from '@/lib/time'

export const metadata: Metadata = { title: 'People' }

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; done?: string; n?: string }> }) {
  const user = await requireUser()
  const { q, done, n } = await searchParams
  const [people, settings] = await Promise.all([listContacts(user.id, q), getSettings(user.id)])
  return (
    <>
      <PageTitle
        title="People"
        subtitle="Everyone you want to stay close to, and whether they said yes to messages."
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/people/import" className="btn btn-secondary">
              <UploadIcon className="size-4" />
              Import
            </Link>
            <Link href="/people/new" className="btn btn-primary">
              <PlusIcon />
              Add someone
            </Link>
          </div>
        }
      />
      {done === 'imported' ? (
        <p role="status" className="notice notice-good mb-6">
          Imported {Number(n) || 0} {Number(n) === 1 ? 'person' : 'people'}. Open each one to ask whether they would like messages.
        </p>
      ) : (
        <Done code={done} />
      )}
      <Section
        title={q ? `Matching "${q}"` : 'Everyone'}
        id="everyone"
        icon={PeopleIcon}
        hint={people.length ? `${people.length} ${people.length === 1 ? 'person' : 'people'}` : undefined}
        action={
          <form role="search" className="flex gap-2" action="/people">
            <label htmlFor="q" className="sr-only">
              Search people
            </label>
            <input id="q" name="q" type="search" defaultValue={q} placeholder="Search by name" className="input min-h-10 py-1.5 sm:w-56" />
            <button type="submit" className="btn btn-secondary btn-sm">
              Search
            </button>
          </form>
        }
      >
      {people.length ? (
        <ul>
          {people.map((c) => (
            <li key={c.id}>
              <RowLink
                href={`/people/${c.id}`}
                lead={<Monogram name={c.name} />}
                title={c.name}
                meta={c.nextAt ? `Next: ${formatWhen(c.nextAt, settings.timezone)}` : 'Nothing scheduled'}
                badge={<ConsentBadge consent={c.consent} byRecipient={c.stoppedByRecipient} />}
              />
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon={PeopleIcon}>{q ? `Nobody matches "${q}".` : 'No one here yet. Add the first person you would like to stay close to.'}</Empty>
      )}
      </Section>
    </>
  )
}
