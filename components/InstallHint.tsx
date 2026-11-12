'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { dismissHint, hintDismissed, isMobile, promptInstall, useInstallState } from '@/lib/pwa-client'

import { CloseIcon, Logo, ShareIcon } from './icons'

/**
 * A one-time hint on phones to add Tend to the home screen: the install
 * prompt on Android, the Share steps on iPhone. Gone for good once dismissed
 * or installed; never shown in the installed app or on Settings, which has
 * its own Install section.
 */
export function InstallHint() {
  const state = useInstallState()
  const pathname = usePathname()
  const [eligible, setEligible] = useState(false)

  useEffect(() => {
    // Reads the browser (screen, storage) once mounted; the server renders nothing.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEligible(isMobile() && !hintDismissed())
  }, [])

  const show = eligible && (state === 'prompt' || state === 'ios') && !pathname.startsWith('/settings')
  useEffect(() => {
    // One time: once seen, it stays while the app is open (the layout keeps it
    // across pages) and is not offered again on a later visit.
    if (show) dismissHint()
  }, [show])

  if (!show) return null

  const close = () => {
    dismissHint()
    setEligible(false)
  }

  return (
    <aside aria-label="Install Tend" className="card mb-6 flex items-start gap-3 border-accent/40 bg-accent-soft/40 pr-2">
      <Logo className="size-10 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Get the Tend app</p>
        {state === 'prompt' ? (
          <>
            <p className="mt-0.5 text-sm text-muted">Open it in one tap, and get reminders as notifications.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  await promptInstall()
                  close()
                }}
              >
                Install
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
                Not now
              </button>
            </div>
          </>
        ) : (
          <p className="mt-0.5 text-sm text-muted">
            Tap <ShareIcon className="-mt-1 inline size-[1.15em] text-ink" /> <strong className="text-ink">Share</strong>, then{' '}
            <strong className="text-ink">Add to Home Screen</strong>. Notifications work from there too.
          </p>
        )}
      </div>
      <button type="button" onClick={close} className="btn btn-ghost btn-sm -mt-1 shrink-0 px-2" aria-label="Dismiss">
        <CloseIcon className="size-5" />
      </button>
    </aside>
  )
}
