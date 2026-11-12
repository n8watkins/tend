'use client'

import { useActionState } from 'react'

import { newPairCode, type PairCodeState } from '@/app/(app)/helper-actions'

import { CopyButton } from './CopyButton'

/** "Get a pairing code": a one-time code for `tend-helper pair`, shown once (Tend keeps only its hash). */
export function HelperPairCode() {
  const [state, action, pending] = useActionState<PairCodeState, FormData>(() => newPairCode(), undefined)
  const command = state?.code ? `tend-helper pair ${state.code}` : null
  return (
    <form action={action} className="space-y-3">
      {command ? (
        <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
          <p className="text-sm text-muted">Your pairing code</p>
          <p className="font-mono text-3xl font-bold tracking-widest" data-testid="pair-code">
            {state!.code}
          </p>
          <p className="text-sm">On your PC, run:</p>
          <code className="block overflow-x-auto rounded-lg bg-surface px-3 py-2 font-mono text-sm whitespace-nowrap">{command}</code>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={command} label="Copy the command" className="btn btn-secondary btn-sm" />
          </div>
          <p className="hint">It works once, for 10 minutes. Reload this page after pairing to see your helper.</p>
        </div>
      ) : null}
      {state?.error ? (
        <p role="alert" className="notice notice-warn">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className={command ? 'btn btn-ghost' : 'btn btn-primary'} disabled={pending}>
        {pending ? 'Getting a code...' : command ? 'Get a new code' : 'Get a pairing code'}
      </button>
    </form>
  )
}
