'use client'

import { useActionState } from 'react'

import type { FormState } from '@/app/(app)/actions'
import type { Translation } from '@/lib/enums'

import { SubmitButton } from './SubmitButton'

export function PreferencesForm({
  action,
  timezone,
  translation,
  emailReminders,
  timezones,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>
  timezone: string
  translation: Translation
  emailReminders: boolean
  timezones: string[]
}) {
  const [state, formAction] = useActionState(action, undefined)
  return (
    <form action={formAction} className="card space-y-4">
      <div>
        <label htmlFor="timezone" className="label">
          Your time zone
        </label>
        <select id="timezone" name="timezone" defaultValue={timezone} className="input">
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="translation" className="label">
          Bible translation
        </label>
        <select id="translation" name="translation" defaultValue={translation} className="input">
          <option value="web">World English Bible (modern English)</option>
          <option value="kjv">King James Version</option>
        </select>
      </div>
      <label className="flex items-start gap-2">
        <input type="checkbox" name="emailReminders" defaultChecked={emailReminders} className="mt-1 size-4" />
        <span>
          Email me when a message is ready to send
          <span className="hint block">At most a few a day. Due messages always show on Today.</span>
        </span>
      </label>
      {state?.error ? (
        <p role="alert" className="notice notice-danger">
          {state.error}
        </p>
      ) : null}
      <SubmitButton pending="Saving...">Save</SubmitButton>
    </form>
  )
}

export function DeleteAccountForm({ action }: { action: (state: FormState, form: FormData) => Promise<FormState> }) {
  const [state, formAction] = useActionState(action, undefined)
  return (
    <form action={formAction} className="space-y-3">
      <label htmlFor="confirm" className="label">
        Type DELETE to delete your account and everything in it
      </label>
      <input id="confirm" name="confirm" autoComplete="off" className="input max-w-xs" />
      {state?.error ? (
        <p role="alert" className="notice notice-danger">
          {state.error}
        </p>
      ) : null}
      <SubmitButton className="btn btn-danger" pending="Deleting...">
        Delete my account
      </SubmitButton>
    </form>
  )
}
