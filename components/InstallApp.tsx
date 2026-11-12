'use client'

import { useState } from 'react'

import { promptInstall, useInstallState } from '@/lib/pwa-client'

import { CheckIcon, InstallIcon, ShareIcon } from './icons'

/** The steps to add Tend on iPhone and iPad, which have no install prompt. */
export function IosSteps({ className = '' }: { className?: string }) {
  return (
    <ol className={`list-decimal space-y-1 pl-5 ${className}`}>
      <li>
        Tap <ShareIcon className="-mt-1 inline size-[1.1em]" /> <strong>Share</strong> (in Safari at the bottom of the screen, in Chrome at the top).
      </li>
      <li>
        Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
      </li>
      <li>Open Tend from your Home Screen.</li>
    </ol>
  )
}

/** "Install Tend" in Settings: the browser's prompt, the iPhone steps, or how to do it elsewhere. */
export function InstallApp() {
  const state = useInstallState()
  const [declined, setDeclined] = useState(false)

  if (state === 'installed') {
    return (
      <p className="flex items-start gap-2">
        <CheckIcon className="mt-0.5 size-5 shrink-0 text-accent" />
        <span>Tend is installed on this device. Open it from your home screen or app list.</span>
      </p>
    )
  }
  if (state === 'prompt') {
    return (
      <div className="space-y-3">
        <p>Add Tend to your home screen to open it in one tap, full screen, like any other app.</p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={async () => setDeclined(!(await promptInstall()))}
        >
          <InstallIcon className="size-5" />
          Install Tend
        </button>
        {declined ? <p className="hint">No problem. You can install Tend from here whenever you like.</p> : null}
      </div>
    )
  }
  if (state === 'ios') {
    return (
      <div className="space-y-2">
        <p>Add Tend to your Home Screen to open it in one tap, like any other app:</p>
        <IosSteps />
      </div>
    )
  }
  return (
    <p>
      Add Tend to your home screen to open it in one tap. On Android, open Tend in Chrome and choose <strong>Install app</strong> from the menu. On
      iPhone, open it in Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
    </p>
  )
}
