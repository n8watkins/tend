'use client'

import { useSyncExternalStore } from 'react'

import { ShareIcon } from './icons'

const noSubscription = () => () => {}

function canShare(): boolean {
  return typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches
}

/** Shares the text through the system share sheet (Signal is one of the targets). Phones only; hidden elsewhere. */
export function ShareButton({ text, className = 'btn btn-secondary' }: { text: string; className?: string }) {
  const supported = useSyncExternalStore(noSubscription, canShare, () => false)
  if (!supported) return null
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        navigator.share({ text }).catch(() => {
          // Dismissed or not allowed: nothing to do.
        })
      }}
    >
      <ShareIcon />
      Share to Signal
    </button>
  )
}
