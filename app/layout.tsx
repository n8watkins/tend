import type { Metadata, Viewport } from 'next'

import { TimezoneCookie } from '@/components/TimezoneCookie'
import { siteUrl } from '@/lib/url'

import './globals.css'

const description =
  'Stay close to the people you care about. Tend suggests a verified Bible verse or quote that fits them, reminds you when it is time, and you send it yourself on Signal.'

// Every page is rendered per request so it carries this request's CSP nonce
// (proxy.ts); a prerendered page's scripts would have none and be blocked.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: 'Tend: thoughtful messages, for Signal', template: '%s · Tend' },
  description,
  applicationName: 'Tend',
  openGraph: { title: 'Tend', description, siteName: 'Tend', type: 'website' },
  twitter: { card: 'summary_large_image', title: 'Tend', description },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f5f0' },
    { media: '(prefers-color-scheme: dark)', color: '#111513' },
  ],
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <a href="#main" className="sr-only-focusable btn btn-primary fixed top-2 left-2 z-50">
          Skip to content
        </a>
        <TimezoneCookie />
        {children}
      </body>
    </html>
  )
}
