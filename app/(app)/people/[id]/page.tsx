import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ConfirmButton } from '@/components/ConfirmButton'
import { SubmitButton } from '@/components/SubmitButton'
import { ConsentBadge, CONSENT_LABEL, Done, Empty, PageTitle, RowLink, Section, SIGNAL_LABEL } from '@/components/ui'
import type { ConsentState } from '@/lib/enums'
import { getItem, itemHeading, itemText, itemTitle, LIBRARY } from '@/lib/content'
import {
  describeCadence,
  describeDaysAway,
  describePartialDate,
  OCCASION_LABEL,
  occasionPicks,
  parsePartialDate,
  UPCOMING_DAYS,
} from '@/lib/occasions'
import { describeDays } from '@/lib/schedule'
import { contactConsentEvents, contactMessages, getContact } from '@/lib/server/data'
import { contactOccasions, keepInTouchState } from '@/lib/server/nudges'
import { getSettings, requireUser } from '@/lib/server/session'
import { suggest } from '@/lib/suggest'
import { formatDate, formatMinutes, formatWhen } from '@/lib/time'
import { topicLabel } from '@/lib/topics'

import { deleteContact, markInTouch, setConsent, surpriseMe } from '../../actions'

export const metadata: Metadata = { title: 'Person' }

const ERRORS: Record<string, string> = {
  consent: 'That change is not possible from their current consent state.',
  confirm: 'Tick the box to confirm they told you they want messages again.',
  surprise: 'Everything in the library has gone to them in the last 180 days or is already scheduled. Write your own message instead.',
}

function maskPhone(phone: string) {
  return phone.length > 4 ? `${'•'.repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}` : phone
}

function ConsentButton({ contactId, to, children, className = 'btn btn-secondary' }: { contactId: string; to: ConsentState; children: React.ReactNode; className?: string }) {
  return (
    <form action={setConsent.bind(null, contactId)}>
      <input type="hidden" name="to" value={to} />
      <SubmitButton className={className}>{children}</SubmitButton>
    </form>
  )
}

export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ done?: string; error?: string; occasion?: string }>
}) {
  const user = await requireUser()
  const { id } = await params
  const { done, error, occasion } = await searchParams
  const contact = await getContact(user.id, id)
  if (!contact) notFound()
  const now = Date.now()
  const [settings, history, events, touch] = await Promise.all([
    getSettings(user.id),
    contactMessages(user.id, id),
    contactConsentEvents(user.id, id),
    keepInTouchState(contact, now),
  ])
  const tz = settings.timezone
  const occasions = contactOccasions(contact, now)
  // The occasion the nudge pointed at, or the next one within two weeks.
  const soon = occasions.find((o) => o.kind === occasion) ?? occasions.find((o) => o.daysAway <= UPCOMING_DAYS)
  const pastForPicks = history.map((m) => ({ contentId: m.contentId, at: m.sentAt ?? m.scheduledFor, status: m.status }))
  const picks = soon ? occasionPicks(LIBRARY, soon.kind, pastForPicks, now) : []
  const scheduled = history.filter((m) => m.status === 'scheduled').sort((a, b) => a.scheduledFor - b.scheduledFor)
  const past = history.filter((m) => m.status !== 'scheduled')
  // Not the occasion's picks again, when those are shown above.
  const shownPicks = new Set(contact.consent === 'yes' ? picks.map((p) => p.id) : [])
  const suggestions =
    contact.consent === 'yes'
      ? suggest(LIBRARY, contact.id, contact.topics, pastForPicks, now, 5 + shownPicks.size)
          .filter((item) => !shownPicks.has(item.id))
          .slice(0, 5)
      : []
  const timeline = [
    ...past.map((m) => ({
      at: m.sentAt ?? m.updatedAt,
      text:
        m.status === 'sent'
          ? `${m.kind === 'consent_request' ? 'Asked about messages' : `Sent ${getItem(m.contentId) ? itemTitle(getItem(m.contentId)!) : 'a personal message'}`}${m.sentVia === 'helper' ? ' (sent by your helper)' : ''}`
          : `${m.status === 'skipped' ? 'Skipped' : 'Canceled'} ${m.kind === 'consent_request' ? 'a consent request' : getItem(m.contentId) ? itemTitle(getItem(m.contentId)!) : 'a personal message'}`,
      href: `/send/${m.id}`,
    })),
    ...events.map((e) => ({
      at: e.at,
      text: e.by === 'recipient' ? 'They used their stop link' : `Consent: ${CONSENT_LABEL[e.from]} to ${CONSENT_LABEL[e.to]}`,
      href: undefined,
    })),
  ].sort((a, b) => b.at - a.at)

  return (
    <>
      <PageTitle
        title={contact.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <ConsentBadge consent={contact.consent} byRecipient={contact.stoppedByRecipient} />
            <span className="badge">{SIGNAL_LABEL[contact.signalStatus]}</span>
          </span>
        }
        action={
          <Link href={`/people/${contact.id}/edit`} className="btn btn-secondary">
            Edit
          </Link>
        }
      />
      <Done code={done} />
      {error && ERRORS[error] ? (
        <p role="alert" className="notice notice-danger mb-6">
          {ERRORS[error]}
        </p>
      ) : null}

      <section aria-labelledby="consent-title" className="card space-y-3">
        <h2 id="consent-title" className="font-bold">
          Messages and consent
        </h2>
        {contact.consent === 'not_asked' ? (
          <>
            <p>Ask {contact.name} first. Tend drafts a short, friendly question for you to send on Signal.</p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/compose?contact=${contact.id}&kind=consent_request`} className="btn btn-primary">
                Draft the question
              </Link>
              <ConsentButton contactId={contact.id} to="yes">
                They already said yes
              </ConsentButton>
            </div>
          </>
        ) : null}
        {contact.consent === 'asked' ? (
          <>
            <p>You asked {contact.name}. What did they say?</p>
            <div className="flex flex-wrap gap-2">
              <ConsentButton contactId={contact.id} to="yes" className="btn btn-primary">
                They said yes
              </ConsentButton>
              <ConsentButton contactId={contact.id} to="no">
                They said no
              </ConsentButton>
            </div>
          </>
        ) : null}
        {contact.consent === 'yes' ? (
          <>
            <p>
              {contact.name} is happy to hear from you, up to {contact.maxPer30Days} {contact.maxPer30Days === 1 ? 'time' : 'times'} in 30 days.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/compose?contact=${contact.id}&kind=personal`} className="btn btn-secondary">
                Write your own message
              </Link>
              <ConsentButton contactId={contact.id} to="stopped" className="btn btn-ghost">
                They asked me to stop
              </ConsentButton>
            </div>
          </>
        ) : null}
        {contact.consent === 'no' ? (
          <>
            <p>{contact.name} said no, so Tend won&rsquo;t suggest messages for them.</p>
            <ConsentButton contactId={contact.id} to="yes">
              They changed their mind
            </ConsentButton>
          </>
        ) : null}
        {contact.consent === 'stopped' ? (
          <>
            <p>
              {contact.stoppedByRecipient
                ? `${contact.name} used their stop link, so everything scheduled for them was canceled.`
                : `Messages to ${contact.name} are stopped.`}
            </p>
            <form action={setConsent.bind(null, contact.id)} className="space-y-3">
              <input type="hidden" name="to" value="yes" />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="confirm" value="yes" className="mt-1 size-4" />
                <span>They told me they want these messages again.</span>
              </label>
              <SubmitButton className="btn btn-secondary">Start again</SubmitButton>
            </form>
          </>
        ) : null}
      </section>

      <section aria-labelledby="touch-title" className="card mt-4 space-y-3">
        <h2 id="touch-title" className="font-bold">
          Keeping in touch
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Last in touch</dt>
            <dd data-testid="last-in-touch">{touch.last ? formatDate(touch.last, tz) : 'Not yet'}</dd>
          </div>
          <div>
            <dt className="text-muted">{touch.cadence ? describeCadence(contact.cadenceDays!) : 'Keep in touch'}</dt>
            <dd data-testid="next-due">
              {!touch.cadence ? (
                <Link href={`/people/${contact.id}/edit#cadence`} className="underline underline-offset-2">
                  Set how often
                </Link>
              ) : touch.cadence.scheduled ? (
                'A message is scheduled'
              ) : touch.cadence.dueAt <= now ? (
                <span className="badge badge-warn">Due now</span>
              ) : (
                `Next due ${formatWhen(touch.cadence.dueAt, tz)}`
              )}
            </dd>
          </div>
          {occasions.map((o) => (
            <div key={o.kind}>
              <dt className="text-muted">{OCCASION_LABEL[o.kind]}</dt>
              <dd>
                {describePartialDate({ ...parsePartialDate(contact[o.kind])!, year: null })}
                <span className="text-muted">
                  {' '}
                  · {o.daysAway === 0 ? 'today' : describeDaysAway(o.daysAway)}
                  {o.years !== null && o.years > 0 ? (o.kind === 'birthday' ? `, turns ${o.years}` : `, ${o.years} ${o.years === 1 ? 'year' : 'years'}`) : ''}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        {touch.cadence && contact.consent !== 'yes' ? (
          <p className="hint">Keep-in-touch reminders start once {contact.name} says yes to messages.</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <form action={markInTouch.bind(null, contact.id)}>
            <SubmitButton className="btn btn-secondary btn-sm">We were in touch today</SubmitButton>
          </form>
          {!occasions.length ? (
            <Link href={`/people/${contact.id}/edit#birthday`} className="btn btn-ghost btn-sm">
              Add a birthday
            </Link>
          ) : null}
        </div>
      </section>

      {soon && contact.consent === 'yes' ? (
        <Section title={soon.daysAway === 0 ? `For their ${soon.kind} today` : `For their ${soon.kind}, ${describeDaysAway(soon.daysAway)}`} id="occasion">
          <p className="hint mb-3">
            {soon.kind === 'birthday' ? 'A blessing or a hopeful word to send with your wishes.' : 'Passages about love and faithfulness to send with your wishes.'}
          </p>
          {picks.length ? (
            <ul className="space-y-3">
              {picks.map((item) => (
                <li key={item.id} className="card">
                  <p className="text-sm font-semibold">{itemHeading(item)}</p>
                  <p className="passage mt-2 line-clamp-4">{itemText(item, contact.translation ?? settings.translation)}</p>
                  <div className="mt-3 flex justify-end">
                    <Link href={`/compose?contact=${contact.id}&content=${item.id}&occasion=${soon.kind}`} className="btn btn-primary btn-sm">
                      Use this
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <Link href={`/compose?contact=${contact.id}&kind=personal&occasion=${soon.kind}`} className="btn btn-secondary mt-3">
            Write your own wishes
          </Link>
        </Section>
      ) : null}

      <Section title="Scheduled" id="scheduled">
        {scheduled.length ? (
          <ul className="space-y-3">
            {scheduled.map((m) => {
              const item = getItem(m.contentId)
              return (
                <li key={m.id}>
                  <RowLink
                    href={`/send/${m.id}`}
                    title={m.kind === 'consent_request' ? 'Ask about messages' : item ? itemTitle(item) : 'Personal message'}
                    meta={`${m.scheduledFor <= now ? 'Ready now' : formatWhen(m.scheduledFor, tz)}`}
                    badge={m.scheduledFor <= now ? <span className="badge badge-good">Send now</span> : undefined}
                  />
                </li>
              )
            })}
          </ul>
        ) : (
          <Empty>Nothing scheduled.</Empty>
        )}
      </Section>

      {contact.consent === 'yes' ? (
        <Section title="Suggestions" id="suggestions">
          {contact.topics.length ? (
            <p className="hint mb-3">Picked for what {contact.name} cares about: {contact.topics.map((t) => topicLabel(t.topic).toLowerCase()).join(', ')}.</p>
          ) : null}
          {contact.topics.length === 0 ? (
            <p className="hint mb-3">
              <Link href={`/people/${contact.id}/edit`} className="underline underline-offset-2">
                Pick a few topics
              </Link>{' '}
              for suggestions that fit {contact.name} better.
            </p>
          ) : null}
          {suggestions.length ? (
            <ul className="space-y-3">
              {suggestions.map((item) => (
                <li key={item.id} className="card">
                  <p className="text-sm font-semibold">{itemHeading(item)}</p>
                  <p className="passage mt-2 line-clamp-4">{itemText(item, contact.translation ?? settings.translation)}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap gap-1">
                      {item.topics.map((t) => (
                        <span key={t} className="badge">
                          {topicLabel(t)}
                        </span>
                      ))}
                    </span>
                    <Link href={`/compose?contact=${contact.id}&content=${item.id}`} className="btn btn-primary btn-sm">
                      Use this
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing new fits their topics right now. Browse the library or write your own.</Empty>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={surpriseMe.bind(null, contact.id)}>
              <SubmitButton className="btn btn-secondary">Surprise me</SubmitButton>
            </form>
            <Link href={`/library?contact=${contact.id}`} className="btn btn-ghost">
              Browse the whole library
            </Link>
          </div>
          <p className="hint mt-2">Surprise me picks any passage or quote at random, never one {contact.name} has had in the last 180 days.</p>
        </Section>
      ) : null}

      <Section title="History" id="history">
        {timeline.length ? (
          <ol className="space-y-2">
            {timeline.map((t, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="w-24 shrink-0 text-muted">{formatDate(t.at, tz)}</span>
                {t.href ? (
                  <Link href={t.href} className="underline-offset-2 hover:underline">
                    {t.text}
                  </Link>
                ) : (
                  <span>{t.text}</span>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <Empty>No history yet.</Empty>
        )}
      </Section>

      <Section title="Details" id="details">
        <dl className="card grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Phone</dt>
            <dd>{contact.phone ? maskPhone(contact.phone) : 'Not added'}</dd>
          </div>
          <div>
            <dt className="text-muted">Their time zone</dt>
            <dd>{contact.timezone.replace(/_/g, ' ')}</dd>
          </div>
          <div>
            <dt className="text-muted">How often</dt>
            <dd>
              At most every {contact.minDaysBetween} days, {contact.maxPer30Days} in 30 days
            </dd>
          </div>
          <div>
            <dt className="text-muted">When</dt>
            <dd>
              {describeDays(contact.allowedDays)}, {formatMinutes(contact.windowStart)} to {formatMinutes(contact.windowEnd)}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted">Topics</dt>
            <dd>{contact.topics.length ? contact.topics.map((t) => topicLabel(t.topic)).join(', ') : 'None yet'}</dd>
          </div>
          {contact.notes ? (
            <div className="sm:col-span-2">
              <dt className="text-muted">Notes</dt>
              <dd className="whitespace-pre-wrap">{contact.notes}</dd>
            </div>
          ) : null}
        </dl>
        <form action={deleteContact.bind(null, contact.id)} className="mt-4">
          <ConfirmButton message={`Delete ${contact.name} and all of their history? This cannot be undone.`}>Delete {contact.name}</ConfirmButton>
        </form>
      </Section>
    </>
  )
}
