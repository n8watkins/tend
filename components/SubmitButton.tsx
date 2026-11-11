'use client'

import { useFormStatus } from 'react-dom'

/** A submit button that shows a busy label while its form's action runs. */
export function SubmitButton({
  children,
  pending: pendingLabel,
  className = 'btn btn-primary',
  name,
  value,
}: {
  children: React.ReactNode
  pending?: string
  className?: string
  name?: string
  value?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={className} disabled={pending} aria-disabled={pending} name={name} value={value}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  )
}
