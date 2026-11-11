'use client'

import Script from 'next/script'

/**
 * The Turnstile widget, rendered only when the server passes a site key. It
 * adds the hidden `cf-turnstile-response` field to the surrounding form.
 */
export function Turnstile({ siteKey, nonce }: { siteKey: string; nonce?: string }) {
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" nonce={nonce} />
      <div className="cf-turnstile min-h-[65px]" data-sitekey={siteKey} data-theme="auto" data-size="flexible" />
    </>
  )
}
