'use client'

import { useActionState } from 'react'

import type { FormState } from '@/app/(app)/actions'
import { SIGNAL_STATUSES, type SignalStatus } from '@/lib/enums'
import { DAY_NAMES } from '@/lib/schedule'
import { formatMinutes } from '@/lib/time'
import { MAX_TOPICS_PER_CONTACT, TOPICS } from '@/lib/topics'

import { SubmitButton } from './SubmitButton'
import { SIGNAL_LABEL } from './ui'

export interface ContactValues {
  name: string
  phone: string
  timezone: string
  signalStatus: SignalStatus
  topics: string[]
  minDaysBetween: number
  maxPer30Days: number
  windowStart: number
  windowEnd: number
  allowedDays: number
  notes: string
}

export function ContactForm({
  action,
  initial,
  timezones,
  isNew,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>
  initial: ContactValues
  timezones: string[]
  isNew: boolean
}) {
  const [state, formAction] = useActionState(action, undefined)
  return (
    <form action={formAction} className="space-y-6">
      <fieldset className="card space-y-4">
        <legend className="sr-only">About them</legend>
        <div>
          <label htmlFor="name" className="label">
            Name
          </label>
          <input id="name" name="name" required maxLength={80} defaultValue={initial.name} className="input" autoComplete="off" />
        </div>
        <div>
          <label htmlFor="phone" className="label">
            Phone number <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={initial.phone}
            placeholder="+1 555 123 4567"
            className="input"
            aria-describedby="phone-hint"
            autoComplete="off"
          />
          <p id="phone-hint" className="hint mt-1">
            Only used to open your Signal chat with them. Stored encrypted.
          </p>
        </div>
        <div>
          <label htmlFor="signalStatus" className="label">
            Signal
          </label>
          <select id="signalStatus" name="signalStatus" defaultValue={initial.signalStatus} className="input">
            {SIGNAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SIGNAL_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        {isNew ? (
          <div>
            <label htmlFor="consent" className="label">
              Have you asked them about messages?
            </label>
            <select id="consent" name="consent" defaultValue="not_asked" className="input" aria-describedby="consent-hint">
              <option value="not_asked">Not yet: help me ask</option>
              <option value="asked">I asked, waiting to hear</option>
              <option value="yes">Yes, they said they would like that</option>
            </select>
            <p id="consent-hint" className="hint mt-1">
              Tend only suggests messages for people who said yes.
            </p>
          </div>
        ) : null}
      </fieldset>

      <fieldset className="card">
        <legend className="float-left mb-1 font-semibold">What matters to them</legend>
        <p className="hint clear-both mb-3">Pick up to {MAX_TOPICS_PER_CONTACT}. Suggestions follow these.</p>
        <div className="flex flex-wrap gap-2">
          {TOPICS.map((t) => (
            <label key={t.slug} className="chip">
              <input type="checkbox" name="topics" value={t.slug} defaultChecked={initial.topics.includes(t.slug)} className="sr-only" />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="card space-y-4">
        <legend className="float-left font-semibold">How often and when</legend>
        <div className="clear-both grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="minDaysBetween" className="label">
              At most one message every
            </label>
            <select id="minDaysBetween" name="minDaysBetween" defaultValue={String(initial.minDaysBetween)} className="input">
              {[3, 7, 14, 30, 60].map((d) => (
                <option key={d} value={d}>
                  {d === 7 ? 'week' : d === 14 ? 'two weeks' : d === 30 ? 'month' : d === 60 ? 'two months' : `${d} days`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="maxPer30Days" className="label">
              And no more than, in 30 days
            </label>
            <select id="maxPer30Days" name="maxPer30Days" defaultValue={String(initial.maxPer30Days)} className="input">
              {[1, 2, 3, 4, 6, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'message' : 'messages'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="windowStart" className="label">
              Not before
            </label>
            <input id="windowStart" name="windowStart" type="time" defaultValue={formatMinutes(initial.windowStart)} className="input" />
          </div>
          <div>
            <label htmlFor="windowEnd" className="label">
              Not after
            </label>
            <input id="windowEnd" name="windowEnd" type="time" defaultValue={formatMinutes(initial.windowEnd)} className="input" />
          </div>
        </div>
        <fieldset>
          <legend className="label">On these days</legend>
          <div className="flex flex-wrap gap-2">
            {DAY_NAMES.map((d, i) => (
              <label key={d} className="chip">
                <input type="checkbox" name="days" value={i} defaultChecked={Boolean(initial.allowedDays & (1 << i))} className="sr-only" />
                {d}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="timezone" className="label">
            Their time zone
          </label>
          <select id="timezone" name="timezone" defaultValue={initial.timezone} className="input">
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <div className="card">
        <label htmlFor="notes" className="label">
          Notes <span className="font-normal text-muted">(optional, private, encrypted)</span>
        </label>
        <textarea id="notes" name="notes" maxLength={1000} defaultValue={initial.notes} className="input" aria-describedby="notes-hint" />
        <p id="notes-hint" className="hint mt-1">
          Keep it light: things like &ldquo;just started a new job&rdquo;. Please don&rsquo;t store health or other sensitive details.
        </p>
      </div>

      {state?.error ? (
        <p role="alert" className="notice notice-danger">
          {state.error}
        </p>
      ) : null}
      <SubmitButton pending="Saving...">{isNew ? 'Add person' : 'Save changes'}</SubmitButton>
    </form>
  )
}
