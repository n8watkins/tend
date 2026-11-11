'use client'

import { useState } from 'react'

import { CheckIcon, CopyIcon } from './icons'

export function CopyButton({ text, label = 'Copy message', className = 'btn btn-primary' }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
    setTimeout(() => setState('idle'), 2500)
  }
  return (
    <>
      <button type="button" className={className} onClick={copy}>
        {state === 'copied' ? <CheckIcon /> : <CopyIcon />}
        {state === 'copied' ? 'Copied' : label}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === 'copied' ? 'Message copied' : state === 'failed' ? 'Copy failed: select the text and copy it' : ''}
      </span>
    </>
  )
}
