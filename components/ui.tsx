import Link from 'next/link'

import type { ConsentState, SignalStatus } from '@/lib/enums'

import { ChevronIcon } from './icons'

export const CONSENT_LABEL: Record<ConsentState, string> = {
  not_asked: 'Not asked yet',
  asked: 'Asked, waiting',
  yes: 'Said yes',
  no: 'Said no',
  stopped: 'Stopped',
}

const CONSENT_CLASS: Record<ConsentState, string> = {
  not_asked: 'badge',
  asked: 'badge badge-warn',
  yes: 'badge badge-good',
  no: 'badge badge-danger',
  stopped: 'badge badge-danger',
}

export function ConsentBadge({ consent, byRecipient }: { consent: ConsentState; byRecipient?: boolean }) {
  return <span className={CONSENT_CLASS[consent]}>{consent === 'stopped' && byRecipient ? 'Stopped by them' : CONSENT_LABEL[consent]}</span>
}

export const SIGNAL_LABEL: Record<SignalStatus, string> = {
  unknown: 'Not sure if on Signal',
  on_signal: 'On Signal',
  invited: 'Invited to Signal',
  not_on_signal: 'Not on Signal',
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold break-words md:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="mt-8" aria-labelledby={id}>
      <h2 id={id} className="mb-3 text-lg font-bold">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line p-5 text-center text-muted">{children}</p>
}

export function RowLink({ href, title, meta, badge }: { href: string; title: React.ReactNode; meta?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <Link href={href} className="card flex items-center gap-3 no-underline hover:border-accent">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{title}</span>
        {meta ? <span className="mt-0.5 block text-sm text-muted">{meta}</span> : null}
      </span>
      {badge}
      <ChevronIcon className="size-5 shrink-0 text-muted" />
    </Link>
  )
}

export const DONE_TEXT: Record<string, string> = {
  scheduled: 'Scheduled. Tend will remind you when it is time.',
  sent: 'Marked as sent.',
  skipped: 'Skipped.',
  rescheduled: 'Rescheduled.',
  deleted: 'Deleted.',
  'in-touch': 'Noted. Tend counts from today for keeping in touch.',
  saved: 'Saved.',
  'telegram-off': 'Telegram disconnected. Tend will not message you there.',
  'helper-on': 'The Signal helper is on. Pair your helper below.',
  'helper-off': 'The Signal helper is off. Nothing will be sent for you.',
  'helper-removed': 'Helper removed. It can no longer fetch or send anything.',
  'helper-resumed': 'Sending is back on.',
}

export function Done({ code }: { code?: string }) {
  const text = code ? DONE_TEXT[code] : undefined
  if (!text) return null
  return (
    <p role="status" className="notice notice-good mb-6">
      {text}
    </p>
  )
}
