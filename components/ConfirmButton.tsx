'use client'

import { useFormStatus } from 'react-dom'

/** A submit button that asks the browser to confirm first (for deletes). */
export function ConfirmButton({ children, message, className = 'btn btn-danger' }: { children: React.ReactNode; message: string; className?: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault()
      }}
    >
      {children}
    </button>
  )
}
