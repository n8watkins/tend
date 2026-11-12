import Link from 'next/link'

import type { ConsentState, SignalStatus } from '@/lib/enums'

import { ChevronIcon, SproutIcon } from './icons'

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

type IconType = (props: { className?: string }) => React.ReactNode

/**
 * The page head: a small eyebrow (where you are), the title in the display
 * face, one line on what the page is for, and the page's main action.
 */
export function PageTitle({
  title,
  subtitle,
  action,
  eyebrow,
  lead,
}: {
  title: string
  subtitle?: React.ReactNode
  action?: React.ReactNode
  eyebrow?: React.ReactNode
  lead?: React.ReactNode
}) {
  return (
    <div className="page-head">
      <div className="flex min-w-0 items-center gap-4">
        {lead}
        <div className="min-w-0">
          {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
          <h1 className="page-title">{title}</h1>
          {subtitle ? <div className="page-subtitle">{subtitle}</div> : null}
        </div>
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </div>
  )
}

export type SectionTone = 'default' | 'primary' | 'warm' | 'warn' | 'quiet'

/**
 * One clearly separated part of a page: a panel with a header (icon, title,
 * a one-line hint and an optional action) and its content below.
 */
export function Section({
  title,
  children,
  id,
  icon: Icon,
  hint,
  action,
  tone = 'default',
  className = '',
}: {
  title: string
  children: React.ReactNode
  id?: string
  icon?: IconType
  hint?: React.ReactNode
  action?: React.ReactNode
  tone?: SectionTone
  className?: string
}) {
  return (
    <section className={`panel panel-${tone} ${className}`} aria-labelledby={id}>
      <header className="panel-head">
        {Icon ? (
          <span className="panel-icon" aria-hidden="true">
            <Icon className="size-5" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 id={id} className="panel-title">
            {title}
          </h2>
          {hint ? <p className="panel-hint">{hint}</p> : null}
        </div>
        {action ? <div className="panel-action">{action}</div> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  )
}

export function Empty({ children, icon: Icon = SproutIcon, action }: { children: React.ReactNode; icon?: IconType; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <p>{children}</p>
      {action}
    </div>
  )
}

const MONO_TONES = ['mono-green', 'mono-sun', 'mono-rose', 'mono-sky'] as const

/** A round initial for a person, in one of four calm tones picked from the name. */
export function Monogram({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const words = name.trim().split(/\s+/)
  const initials = ((words[0]?.[0] ?? '') + (words.length > 1 ? (words.at(-1)?.[0] ?? '') : '')).toUpperCase()
  // FNV-1a, so similar names still spread across the tones.
  let hash = 2166136261
  for (const ch of name) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0
  return (
    <span className={`mono mono-${size} ${MONO_TONES[hash % MONO_TONES.length]}`} aria-hidden="true">
      {initials}
    </span>
  )
}

export function RowLink({
  href,
  title,
  meta,
  badge,
  lead,
}: {
  href: string
  title: React.ReactNode
  meta?: React.ReactNode
  badge?: React.ReactNode
  lead?: React.ReactNode
}) {
  return (
    <Link href={href} className="row">
      {lead}
      <span className="row-text min-w-0 flex-1">
        <span className="row-title">{title}</span>
        {meta ? <span className="row-meta">{meta}</span> : null}
      </span>
      {badge}
      <ChevronIcon className="row-chevron" />
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
