import type { Metadata } from 'next'
import Link from 'next/link'

import { PlusIcon } from '@/components/icons'
import { Empty, PageTitle, RowLink, Section } from '@/components/ui'
import { couldUseAMessage, countContacts, todayLists } from '@/lib/server/data'
import { getSettings, requireUser } from '@/lib/server/session'
import { formatWhen } from '@/lib/time'

export const metadata: Metadata = { title: 'Today' }

function kindLabel(kind: string) {
  return kind === 'consent_request' ? 'Ask' : 'Message'
}

export default async function TodayPage() {
  const user = await requireUser()
  const now = Date.now()
  const [settings, lists, idle, people] = await Promise.all([
    getSettings(user.id),
    todayLists(user.id, now),
    couldUseAMessage(user.id, now),
    countContacts(user.id),
  ])
  const tz = settings.timezone

  if (people === 0) {
    return (
      <>
        <PageTitle title="Welcome to Tend" subtitle="Start with one person you would like to stay close to." />
        <div className="card space-y-4">
          <p>
            Add them with just a name, pick a few things that matter to them, and Tend will help you ask whether they would like the occasional message.
          </p>
          <Link href="/people/new" className="btn btn-primary">
            <PlusIcon />
            Add someone
          </Link>
        </div>
      </>
    )
  }

  const today = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(now)

  return (
    <>
      <PageTitle title="Today" subtitle={today} />

      <Section title="Ready to send" id="due">
        {lists.due.length ? (
          <ul className="space-y-3">
            {lists.due.map((m) => (
              <li key={m.id}>
                <RowLink
                  href={`/send/${m.id}`}
                  title={`${kindLabel(m.kind)} ${m.contactName}`}
                  meta={`Due ${formatWhen(m.scheduledFor, tz)}`}
                  badge={<span className="badge badge-good">Send now</span>}
                />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nothing to send right now.</Empty>
        )}
      </Section>

      {lists.missed.length ? (
        <Section title="Missed" id="missed">
          <ul className="space-y-3">
            {lists.missed.map((m) => (
              <li key={m.id}>
                <RowLink
                  href={`/send/${m.id}`}
                  title={`${kindLabel(m.kind)} ${m.contactName}`}
                  meta={`Was due ${formatWhen(m.scheduledFor, tz)}. Send, skip or reschedule.`}
                  badge={<span className="badge badge-warn">Missed</span>}
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Coming up" id="upcoming">
        {lists.upcoming.length ? (
          <ul className="space-y-3">
            {lists.upcoming.map((m) => (
              <li key={m.id}>
                <RowLink href={`/send/${m.id}`} title={`${kindLabel(m.kind)} ${m.contactName}`} meta={formatWhen(m.scheduledFor, tz)} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nothing scheduled in the next two weeks.</Empty>
        )}
      </Section>

      {idle.length ? (
        <Section title="Could use a message" id="idle">
          <ul className="space-y-3">
            {idle.map((c) => (
              <li key={c.id}>
                <RowLink href={`/people/${c.id}#suggestions`} title={c.name} meta="Said yes, and nothing is scheduled. See suggestions." />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  )
}
