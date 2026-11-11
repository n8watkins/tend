'use client'

import Script from 'next/script'
import { useCallback, useEffect, useRef } from 'react'

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

/**
 * The Turnstile widget, rendered only when the server passes a site key. It
 * adds the hidden `cf-turnstile-response` field to the surrounding form.
 *
 * Rendered explicitly rather than by the script's page scan, so it also works
 * when the form mounts after the script has loaded (the sign-in dialog) and
 * cleans up when the form goes away.
 */
export function Turnstile({ siteKey, nonce }: { siteKey: string; nonce?: string }) {
  const container = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)

  const render = useCallback(() => {
    if (!container.current || !window.turnstile || widget.current) return
    widget.current = window.turnstile.render(container.current, { sitekey: siteKey, theme: 'light', size: 'flexible' })
  }, [siteKey])

  useEffect(() => {
    render()
    return () => {
      if (widget.current) window.turnstile?.remove(widget.current)
      widget.current = null
    }
  }, [render])

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" nonce={nonce} onReady={render} />
      <div ref={container} className="min-h-[65px]" />
    </>
  )
}
