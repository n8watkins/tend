'use client'

import { useFormStatus } from 'react-dom'

/** A submit button that shows a busy label while its form's action runs. */
export function SubmitButton({
  children,
  pending: pendingLabel,
  className = 'btn btn-primary',
  name,
  value,
  disabled = false,
}: {
  children: React.ReactNode
  pending?: string
  className?: string
  name?: string
  value?: string
  disabled?: boolean
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-disabled={pending || disabled} name={name} value={value}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  )
}
