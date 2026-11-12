import type { Metadata } from 'next'
import Link from 'next/link'

import { AlertIcon, CalendarIcon, CheckIcon, ClockIcon, GiftIcon, HeartIcon, PlusIcon, SendIcon } from '@/components/icons'
import { Empty, Monogram, PageTitle, RowLink, Section } from '@/components/ui'
import { describeCadence, describeUpcoming } from '@/lib/occasions'
import { couldUseAMessage, countContacts, todayLists } from '@/lib/server/data'
import { dueToReachOut, upcomingOccasions } from '@/lib/server/nudges'
import { approvalCount, helperAllowedFor } from '@/lib/server/helper'
import { getSettings, requireUser } from '@/lib/server/session'
import { formatDate, formatWhen } from '@/lib/time'

export const metadata: Metadata = { title: 'Today' }

function kindLabel(kind: string) {
  return kind === 'consent_request' ? 'Ask' : 'Message'
}

export default async function TodayPage() {
  const user = await requireUser()
  const now = Date.now()
  const [settings, lists, couldUse, people, reachOut, occasions] = await Promise.all([
    getSettings(user.id),
    todayLists(user.id, now),
    couldUseAMessage(user.id, now),
    countContacts(user.id),
    dueToReachOut(user.id, now),
    upcomingOccasions(user.id, now),
  ])
  const tz = settings.timezone
  // People due to reach out are listed there, not twice.
  const idle = couldUse.filter((c) => !reachOut.some((r) => r.id === c.id))
  const approvals = settings.helperEnabled && helperAllowedFor(user.email) ? await approvalCount(user.id) : 0

  if (people === 0) {
    return (
      <>
        <PageTitle eyebrow="Today" title="Welcome to Tend" subtitle="Start with one person you would like to stay close to." />
        <Section title="Your first person" id="first" icon={HeartIcon} tone="primary" hint="A name is all Tend needs.">
          <p>
            Add them with just a name, pick a few things that matter to them, and Tend will help you ask whether they would like the occasional message.
          </p>
          <Link href="/people/new" className="btn btn-primary">
            <PlusIcon />
            Add someone
          </Link>
        </Section>
      </>
    )
  }

  const today = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(now)
  const next = lists.due[0] ?? lists.missed[0]

  return (
    <>
      <PageTitle
        eyebrow={today}
        title="Today"
        subtitle="What is ready to send now, and what is coming up."
        action={
          next ? (
            <Link href={`/send/${next.id}`} className="btn btn-primary">
              <SendIcon />
              Send to {next.contactName}
            </Link>
          ) : (
            <Link href="/people" className="btn btn-secondary">
              Find someone to message
            </Link>
          )
        }
      />

      {approvals > 0 ? (
        <Link href="/approvals" className="row mb-5">
          <span className="panel-icon" aria-hidden="true">
            <CheckIcon className="size-5" />
          </span>
          <span className="row-text min-w-0 flex-1">
            <span className="row-title">{approvals === 1 ? '1 message needs your approval' : `${approvals} messages need your approval`}</span>
            <span className="row-meta">For your Signal helper. Tap to send or skip.</span>
          </span>
          <span className="badge badge-solid">Approve</span>
        </Link>
      ) : null}

      <div className="app-columns">
        <div className="app-col">
          <Section title="Ready to send" id="due" icon={SendIcon} tone="primary" hint="Due now. Copy it into Signal, then mark it sent.">
            {lists.due.length ? (
              <ul>
                {lists.due.map((m) => (
                  <li key={m.id}>
                    <RowLink
                      href={`/send/${m.id}`}
                      lead={<Monogram name={m.contactName} />}
                      title={`${kindLabel(m.kind)} ${m.contactName}`}
                      meta={`Due ${formatWhen(m.scheduledFor, tz)}`}
                      badge={
                        m.approvalState === 'pending' ? (
                          <span className="badge">Waiting for approval</span>
                        ) : (
                          <span className="badge badge-solid">Send now</span>
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={SendIcon}>Nothing to send right now. When a message is due, it shows here and Tend reminds you.</Empty>
            )}
          </Section>

          {lists.missed.length ? (
            <Section title="Missed" id="missed" icon={AlertIcon} tone="warn" hint="These were due earlier. Send, skip or reschedule each one.">
              <ul>
                {lists.missed.map((m) => (
                  <li key={m.id}>
                    <RowLink
                      href={`/send/${m.id}`}
                      lead={<Monogram name={m.contactName} />}
                      title={`${kindLabel(m.kind)} ${m.contactName}`}
                      meta={`Was due ${formatWhen(m.scheduledFor, tz)}`}
                      badge={<span className="badge badge-warn">Missed</span>}
                    />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {reachOut.length ? (
            <Section title="Due to reach out" id="reach-out" icon={ClockIcon} tone="warn" hint="You asked Tend to keep you in touch with them.">
              <ul>
                {reachOut.map((c) => (
                  <li key={c.id}>
                    <RowLink
                      href={`/people/${c.id}#suggestions`}
                      lead={<Monogram name={c.name} />}
                      title={c.name}
                      meta={`${describeCadence(c.cadenceDays)}. ${c.last ? `Last in touch ${formatDate(c.last, tz)}.` : 'Not in touch through Tend yet.'}`}
                      badge={<span className="badge badge-warn">Due</span>}
                    />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {idle.length ? (
            <Section title="Could use a message" id="idle" icon={HeartIcon} hint="They said yes, and nothing is on the way to them.">
              <ul>
                {idle.map((c) => (
                  <li key={c.id}>
                    <RowLink href={`/people/${c.id}#suggestions`} lead={<Monogram name={c.name} />} title={c.name} meta="See suggestions for them" />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>

        <div className="app-col">
          {occasions.length ? (
            <Section title="Birthdays and anniversaries" id="occasions" icon={GiftIcon} tone="warm" hint="In the next two weeks.">
              <ul>
                {occasions.map((o) => (
                  <li key={`${o.id}-${o.occasion.kind}`}>
                    <RowLink
                      href={o.consent === 'yes' ? `/people/${o.id}?occasion=${o.occasion.kind}#occasion` : `/people/${o.id}`}
                      lead={<Monogram name={o.name} />}
                      title={o.name}
                      meta={`${describeUpcoming(o.occasion)}${o.consent === 'yes' ? '' : '. Not said yes to messages yet.'}`}
                      badge={o.occasion.daysAway === 0 ? <span className="badge badge-good">Today</span> : undefined}
                    />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title="Coming up" id="upcoming" icon={CalendarIcon} hint="Scheduled for the next two weeks.">
            {lists.upcoming.length ? (
              <ul>
                {lists.upcoming.map((m) => (
                  <li key={m.id}>
                    <RowLink
                      href={`/send/${m.id}`}
                      lead={<Monogram name={m.contactName} />}
                      title={`${kindLabel(m.kind)} ${m.contactName}`}
                      meta={formatWhen(m.scheduledFor, tz)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={CalendarIcon}>Nothing scheduled in the next two weeks. Pick someone in People to plan the next message.</Empty>
            )}
          </Section>
        </div>
      </div>
    </>
  )
}
