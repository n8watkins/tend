'use client'

import { useActionState, useState } from 'react'

import type { FormState } from '@/app/(app)/actions'

import { SubmitButton } from './SubmitButton'

export function RescheduleForm({
  action,
  defaultAt,
  timezoneLabel,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>
  defaultAt: string
  timezoneLabel: string
}) {
  const [state, formAction] = useActionState(action, undefined)
  const [when, setWhen] = useState<'next' | 'custom'>('next')
  return (
    <form action={formAction} className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="mb-1 font-semibold">Reschedule</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="when" value="next" checked={when === 'next'} onChange={() => setWhen('next')} className="mt-1 size-4" />
          <span>Next good time</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="when" value="custom" checked={when === 'custom'} onChange={() => setWhen('custom')} className="mt-1 size-4" />
          <span>Choose a time ({timezoneLabel})</span>
        </label>
      </fieldset>
      {when === 'custom' ? (
        <div>
          <label htmlFor="reschedule-at" className="label">
            Date and time
          </label>
          <input id="reschedule-at" name="at" type="datetime-local" step={900} defaultValue={defaultAt} className="input" required />
        </div>
      ) : null}
      {state?.error ? (
        <p role="alert" className="notice notice-danger">
          {state.error}
        </p>
      ) : null}
      <SubmitButton className="btn btn-secondary" pending="Saving...">
        Reschedule
      </SubmitButton>
    </form>
  )
}
