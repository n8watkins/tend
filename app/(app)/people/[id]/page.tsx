import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ConfirmButton } from '@/components/ConfirmButton'
import { CalendarIcon, ClockIcon, GiftIcon, HeartIcon, PenIcon, ShieldIcon, SparkleIcon, UserIcon } from '@/components/icons'
import { SubmitButton } from '@/components/SubmitButton'
import { ConsentBadge, CONSENT_LABEL, Done, Empty, Monogram, PageTitle, RowLink, Section, SIGNAL_LABEL } from '@/components/ui'
import type { ConsentState, SuggestMode } from '@/lib/enums'
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
import { contactConsentEvents, contactMessages, getContact, usedElsewhere } from '@/lib/server/data'
import { contactOccasions, keepInTouchState } from '@/lib/server/nudges'
import { getSettings, requireUser } from '@/lib/server/session'
import { PROMPTS, SITUATION_LABEL, SUGGEST_LABEL } from '@/lib/prompts'
import { ELSEWHERE_DAYS, promptLimit, situationsFor, suggest, suggestPrompts } from '@/lib/suggest'
import { DAY, formatDate, formatMinutes, formatWhen } from '@/lib/time'
import { topicLabel } from '@/lib/topics'

import { deleteContact, markInTouch, setConsent, surpriseMe } from '../../actions'

export const metadata: Metadata = { title: 'Person' }

const ERRORS: Record<string, string> = {
  consent: 'That change is not possible from their current consent state.',
  confirm: 'Tick the box to confirm they told you they want messages again.',
  surprise: 'Nothing is left that they have not had. Write your own message instead.',
}

/** What the occasion panel offers, by "What to suggest". */
const OCCASION_HINT: Record<'birthday' | 'anniversary', Record<SuggestMode, string>> = {
  birthday: {
    mix: 'A blessing or a hopeful word to send with your wishes.',
    scripture: 'A blessing to send with your wishes.',
    quotes: 'A hopeful line from a good book to send with your wishes.',
    words: 'A first line for your wishes, to make your own.',
  },
  anniversary: {
    mix: 'Passages and quotes about love and faithfulness to send with your wishes.',
    scripture: 'Passages about love and faithfulness to send with your wishes.',
    quotes: 'Quotes about love and friendship to send with your wishes.',
    words: 'Write your wishes in your own words.',
  },
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
  const [settings, history, events, touch, elsewhere] = await Promise.all([
    getSettings(user.id),
    contactMessages(user.id, id),
    contactConsentEvents(user.id, id),
    keepInTouchState(contact, now),
    usedElsewhere(user.id, id, now - ELSEWHERE_DAYS * DAY),
  ])
  const mode = contact.suggest ?? settings.suggest
  const tz = settings.timezone
  const occasions = contactOccasions(contact, now)
  // The occasion the nudge pointed at, or the next one within two weeks.
  const soon = occasions.find((o) => o.kind === occasion) ?? occasions.find((o) => o.daysAway <= UPCOMING_DAYS)
  const pastForPicks = history.map((m) => ({ contentId: m.contentId, at: m.sentAt ?? m.scheduledFor, status: m.status }))
  const picks = soon ? occasionPicks(LIBRARY, soon.kind, pastForPicks, now, { mode, contactId: contact.id, elsewhere }) : []
  // "Just my words": birthday starters stand in for the occasion's passages and quotes.
  const occasionStarters =
    soon?.kind === 'birthday' && mode === 'words' ? suggestPrompts(PROMPTS, contact.id, ['birthday'], pastForPicks, now, 3) : []
  const scheduled = history.filter((m) => m.status === 'scheduled').sort((a, b) => a.scheduledFor - b.scheduledFor)
  const past = history.filter((m) => m.status !== 'scheduled')
  // Not the occasion's picks again, when those are shown above.
  const shownPicks = new Set(contact.consent === 'yes' ? picks.map((p) => p.id) : [])
  const pastMessages = pastForPicks
  const suggestions =
    contact.consent === 'yes'
      ? suggest(LIBRARY, contact.id, contact.topics, pastMessages, now, { limit: 5 + shownPicks.size, mode, elsewhere })
          .filter((item) => !shownPicks.has(item.id))
          .slice(0, 5)
      : []
  const shownStarters = new Set(occasionStarters.map((p) => p.id))
  const starters =
    contact.consent === 'yes'
      ? suggestPrompts(
          PROMPTS,
          contact.id,
          situationsFor(contact.topics, pastMessages, now, soon?.kind),
          pastMessages,
          now,
          promptLimit(mode) + shownStarters.size,
        )
          .filter((p) => !shownStarters.has(p.id))
          .slice(0, promptLimit(mode))
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

  // One main panel per page: asking first, else their day, else suggestions.
  const consentIsTheTask = contact.consent === 'not_asked' || contact.consent === 'asked'
  const occasionPanel = Boolean(soon && contact.consent === 'yes')
  const main = consentIsTheTask ? 'consent' : occasionPanel ? 'occasion' : 'suggestions'
  const topics = contact.topics.map((t) => topicLabel(t.topic).toLowerCase()).join(', ')
  const modeLabel = mode === 'words' ? 'conversation starters only' : SUGGEST_LABEL[mode].toLowerCase()

  return (
    <>
      <PageTitle
        eyebrow="Person"
        lead={<Monogram name={contact.name} size="lg" />}
        title={contact.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <ConsentBadge consent={contact.consent} byRecipient={contact.stoppedByRecipient} />
            <span className="badge">{SIGNAL_LABEL[contact.signalStatus]}</span>
          </span>
        }
        action={
          <Link href={`/people/${contact.id}/edit`} className="btn btn-secondary">
            <PenIcon className="size-4" />
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

      <div className="app-columns">
        <div className="app-col">
          <Section
            title="Messages and consent"
            id="consent-title"
            icon={ShieldIcon}
            tone={main === 'consent' ? 'primary' : 'default'}
            hint="Tend only suggests messages for people who said yes."
          >
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
                    <PenIcon className="size-4" />
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
          </Section>

          {soon && occasionPanel ? (
            <Section
              title={soon.daysAway === 0 ? `For their ${soon.kind} today` : `For their ${soon.kind}, ${describeDaysAway(soon.daysAway)}`}
              id="occasion"
              icon={GiftIcon}
              tone={main === 'occasion' ? 'primary' : 'warm'}
              hint={OCCASION_HINT[soon.kind][mode]}
            >
              {picks.length ? (
                <ul className="space-y-3">
                  {picks.map((item, i) => (
                    <li key={item.id} className="pick" data-kind={item.kind}>
                      <p className="pick-source">{itemHeading(item)}</p>
                      <p className="passage mt-1.5 line-clamp-4">{itemText(item, contact.translation ?? settings.translation)}</p>
                      <div className="mt-3 flex justify-end">
                        <Link
                          href={`/compose?contact=${contact.id}&content=${item.id}&occasion=${soon.kind}`}
                          className={`btn btn-sm ${i === 0 && main === 'occasion' ? 'btn-primary' : 'btn-secondary'}`}
                        >
                          Use this
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              {occasionStarters.length ? (
                <ul className="-my-2 divide-y divide-line">
                  {occasionStarters.map((p, i) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <p className="min-w-0 flex-1 basis-56">{p.text}</p>
                      <Link
                        href={`/compose?contact=${contact.id}&kind=personal&prompt=${p.id}&occasion=${soon.kind}`}
                        className={`btn btn-sm ${i === 0 && main === 'occasion' ? 'btn-primary' : 'btn-secondary'}`}
                      >
                        Start with this
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Link href={`/compose?contact=${contact.id}&kind=personal&occasion=${soon.kind}`} className="btn btn-ghost btn-sm">
                <PenIcon className="size-4" />
                Write your own wishes
              </Link>
            </Section>
          ) : null}

          {contact.consent === 'yes' && mode !== 'words' ? (
            <Section
              title="Suggestions"
              id="suggestions"
              icon={SparkleIcon}
              tone={main === 'suggestions' ? 'primary' : 'default'}
              hint={
                <>
                  Suggesting {modeLabel}
                  {contact.suggest ? '' : ' (your default)'}
                  {topics ? `, picked for what ${contact.name} cares about: ${topics}` : ''}.{' '}
                  <Link href={`/people/${contact.id}/edit`} className="font-semibold underline underline-offset-2">
                    Change
                  </Link>
                </>
              }
              action={
                <form action={surpriseMe.bind(null, contact.id)}>
                  <SubmitButton className="btn btn-secondary btn-sm">
                    <SparkleIcon className="size-4" />
                    Surprise me
                  </SubmitButton>
                </form>
              }
            >
              {suggestions.length ? (
                <ul className="space-y-3">
                  {suggestions.map((item, i) => (
                    <li key={item.id} className="pick" data-kind={item.kind}>
                      <p className="pick-source">{itemHeading(item)}</p>
                      <p className="passage mt-1.5 line-clamp-4">{itemText(item, contact.translation ?? settings.translation)}</p>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <span className="flex flex-wrap gap-1">
                          {item.topics.map((t) => (
                            <span key={t} className="badge">
                              {topicLabel(t)}
                            </span>
                          ))}
                        </span>
                        <Link
                          href={`/compose?contact=${contact.id}&content=${item.id}`}
                          className={`btn btn-sm ${i === 0 && main === 'suggestions' ? 'btn-primary' : 'btn-secondary'}`}
                        >
                          Use this
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty icon={SparkleIcon}>Nothing new fits their topics right now. Browse the library or write your own.</Empty>
              )}
              <p className="hint">
                {contact.topics.length === 0 ? (
                  <>
                    <Link href={`/people/${contact.id}/edit`} className="underline underline-offset-2">
                      Pick a few topics
                    </Link>{' '}
                    for picks that fit {contact.name} better.{' '}
                  </>
                ) : null}
                Surprise me picks any {mode === 'scripture' ? 'passage' : mode === 'quotes' ? 'quote' : 'passage or quote'} {contact.name} hasn&rsquo;t had.{' '}
                <Link href={`/library?contact=${contact.id}`} className="font-semibold text-accent underline underline-offset-2">
                  Browse the whole library
                </Link>
              </p>
            </Section>
          ) : null}

          {starters.length ? (
            <Section
              title={mode === 'words' ? 'Start in your own words' : 'Or start in your own words'}
              id="starters"
              icon={PenIcon}
              tone={mode === 'words' && main === 'suggestions' ? 'primary' : 'default'}
              hint={`A first line to make your own. Tend never suggests the same one to ${contact.name} twice.`}
            >
              <ul className="-my-2 divide-y divide-line">
                {starters.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1 basis-56">
                      <span className="badge mb-1.5">{SITUATION_LABEL[p.situation]}</span>
                      <p>{p.text}</p>
                    </div>
                    <Link href={`/compose?contact=${contact.id}&kind=personal&prompt=${p.id}`} className="btn btn-secondary btn-sm">
                      Start with this
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title="History" id="history" icon={ClockIcon} tone="quiet" hint="What you sent, skipped, and their answers.">
            {timeline.length ? (
              <ol className="timeline">
                {timeline.map((t, i) => (
                  <li key={i}>
                    <time>{formatDate(t.at, tz)}</time>
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
              <Empty icon={ClockIcon}>No history yet. Messages you send show up here.</Empty>
            )}
          </Section>
        </div>

        <div className="app-col">
          <Section title="Keeping in touch" id="touch-title" icon={HeartIcon} hint="Their dates, and how often Tend nudges you.">
            <dl className="facts sm:grid-cols-2">
              <div>
                <dt>Last in touch</dt>
                <dd data-testid="last-in-touch">{touch.last ? formatDate(touch.last, tz) : 'Not yet'}</dd>
              </div>
              <div>
                <dt>{touch.cadence ? describeCadence(contact.cadenceDays!) : 'Keep in touch'}</dt>
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
                  <dt>{OCCASION_LABEL[o.kind]}</dt>
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
            {touch.cadence && contact.consent !== 'yes' ? <p className="hint">Keep-in-touch reminders start once {contact.name} says yes to messages.</p> : null}
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
          </Section>

          <Section title="Scheduled" id="scheduled" icon={CalendarIcon} hint={`What is on the way to ${contact.name}.`}>
            {scheduled.length ? (
              <ul>
                {scheduled.map((m) => {
                  const item = getItem(m.contentId)
                  return (
                    <li key={m.id}>
                      <RowLink
                        href={`/send/${m.id}`}
                        title={m.kind === 'consent_request' ? 'Ask about messages' : item ? itemTitle(item) : 'Personal message'}
                        meta={`${m.scheduledFor <= now ? 'Ready now' : formatWhen(m.scheduledFor, tz)}`}
                        badge={m.scheduledFor <= now ? <span className="badge badge-solid">Send now</span> : undefined}
                      />
                    </li>
                  )
                })}
              </ul>
            ) : (
              <Empty icon={CalendarIcon}>Nothing scheduled. Pick a suggestion to plan the next one.</Empty>
            )}
          </Section>

          <Section title="Details" id="details" icon={UserIcon} tone="quiet" hint="Only you can see these.">
            <dl className="facts sm:grid-cols-2">
              <div>
                <dt>Phone</dt>
                <dd>{contact.phone ? maskPhone(contact.phone) : 'Not added'}</dd>
              </div>
              <div>
                <dt>Their time zone</dt>
                <dd>{contact.timezone.replace(/_/g, ' ')}</dd>
              </div>
              <div>
                <dt>How often</dt>
                <dd>
                  At most every {contact.minDaysBetween} days, {contact.maxPer30Days} in 30 days
                </dd>
              </div>
              <div>
                <dt>When</dt>
                <dd>
                  {describeDays(contact.allowedDays)}, {formatMinutes(contact.windowStart)} to {formatMinutes(contact.windowEnd)}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt>Topics</dt>
                <dd>{contact.topics.length ? contact.topics.map((t) => topicLabel(t.topic)).join(', ') : 'None yet'}</dd>
              </div>
              {contact.notes ? (
                <div className="sm:col-span-2">
                  <dt>Notes</dt>
                  <dd className="whitespace-pre-wrap">{contact.notes}</dd>
                </div>
              ) : null}
            </dl>
            <form action={deleteContact.bind(null, contact.id)} className="border-t border-line pt-4">
              <ConfirmButton message={`Delete ${contact.name} and all of their history? This cannot be undone.`} className="btn btn-danger btn-sm">
                Delete {contact.name}
              </ConfirmButton>
            </form>
          </Section>
        </div>
      </div>
    </>
  )
}
