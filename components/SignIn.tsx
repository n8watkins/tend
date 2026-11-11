'use client'

import { useEffect, useRef, useState } from 'react'

import { githubSignIn } from '@/app/signin/actions'
import { SignInForm } from '@/app/signin/SignInForm'

import { Logo } from './icons'
import { Avatar, PEOPLE } from './landing/People'
import { SubmitButton } from './SubmitButton'

const OPEN_EVENT = 'tend:signin'
const DIALOG_ID = 'signin-dialog'

/**
 * A link to /signin that opens the sign-in dialog instead, when the page has
 * one and the click is a plain one. Without JavaScript, or opened in a new tab,
 * it is an ordinary link to the sign-in page.
 */
export function SignInLink({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <a
      href="/signin"
      className={className}
      aria-haspopup="dialog"
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        if (!document.getElementById(DIALOG_ID)) return
        event.preventDefault()
        window.dispatchEvent(new Event(OPEN_EVENT))
      }}
    >
      {children}
    </a>
  )
}

/**
 * The sign-in dialog: the same email form (and Turnstile, when configured) and
 * the same server actions as the /signin page. Its contents mount only when it
 * opens, so the Turnstile script loads only for people who want to sign in.
 */
export function SignInDialog({ siteKey, nonce, github }: { siteKey: string | null; nonce?: string; github: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const show = () => {
      setOpen(true)
      dialog.current?.showModal()
    }
    window.addEventListener(OPEN_EVENT, show)
    if (window.location.hash === '#signin') show()
    return () => window.removeEventListener(OPEN_EVENT, show)
  }, [])

  useEffect(() => {
    if (open) dialog.current?.querySelector<HTMLInputElement>('input[name="email"]')?.focus()
  }, [open])

  return (
    <dialog
      id={DIALOG_ID}
      ref={dialog}
      aria-labelledby="signin-dialog-title"
      className="signin-dialog"
      onClose={() => setOpen(false)}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === dialog.current) dialog.current.close()
      }}
    >
      {open ? (
        <div className="signin-dialog-body">
          <div className="flex items-start justify-between gap-4">
            <span className="flex items-center gap-2 font-semibold">
              <Logo className="size-7" />
              Tend
            </span>
            <button type="button" className="btn btn-ghost btn-sm -mt-1 -mr-2 px-2" onClick={() => dialog.current?.close()} aria-label="Close">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div className="mt-6 flex -space-x-2" aria-hidden="true">
            {PEOPLE.slice(0, 4).map((p) => (
              <Avatar key={p.name} person={p} className="size-10 ring-2 ring-surface" />
            ))}
          </div>
          <h2 id="signin-dialog-title" className="font-display mt-4 text-3xl font-semibold tracking-tight">
            Welcome to Tend
          </h2>
          <p className="mt-2 text-muted">Enter your email and we&rsquo;ll send you a link. New here? The same link creates your account. No password needed.</p>
          <div className="mt-6">
            <SignInForm siteKey={siteKey} nonce={nonce} />
          </div>
          {github ? (
            <>
              <div className="my-5 flex items-center gap-3 text-sm text-muted" aria-hidden="true">
                <span className="h-px flex-1 bg-line" />
                or
                <span className="h-px flex-1 bg-line" />
              </div>
              <form action={githubSignIn}>
                <SubmitButton className="btn btn-secondary w-full" pending="Opening GitHub...">
                  Continue with GitHub
                </SubmitButton>
              </form>
            </>
          ) : null}
          <p className="mt-6 text-xs text-muted">
            By signing in you agree to the{' '}
            <a href="/terms" className="underline underline-offset-2">
              terms
            </a>{' '}
            and{' '}
            <a href="/privacy" className="underline underline-offset-2">
              privacy policy
            </a>
            .
          </p>
        </div>
      ) : null}
    </dialog>
  )
}
