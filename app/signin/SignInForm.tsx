'use client'

import { useActionState } from 'react'

import { SubmitButton } from '@/components/SubmitButton'
import { Turnstile } from '@/components/Turnstile'

import { emailSignIn, type SignInState } from './actions'

export function SignInForm({ siteKey, nonce }: { siteKey: string | null; nonce?: string }) {
  const [state, action] = useActionState<SignInState, FormData>(emailSignIn, undefined)
  return (
    <form action={action} className="space-y-4" noValidate>
      <div>
        <label htmlFor="email" className="label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          className="input"
          aria-invalid={Boolean(state?.error)}
          aria-describedby={state?.error ? 'signin-error' : undefined}
        />
      </div>
      {siteKey ? <Turnstile siteKey={siteKey} nonce={nonce} /> : null}
      {state?.error ? (
        <p id="signin-error" role="alert" className="notice notice-danger">
          {state.error}
        </p>
      ) : null}
      <SubmitButton className="btn btn-primary w-full" pending="Sending link...">
        Email me a sign-in link
      </SubmitButton>
    </form>
  )
}
