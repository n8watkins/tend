import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'

import { TimezoneCookie } from '@/components/TimezoneCookie'
import { siteUrl } from '@/lib/url'

import './globals.css'

// Fonts are bundled (variable, Latin subset, from @fontsource-variable; OFL,
// see app/fonts/*-OFL.txt): Inter for the n8builds family look, Fraunces for
// headings and passages. The CSP allows fonts from 'self' only.
const sans = localFont({
  src: './fonts/inter-latin-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-inter',
  fallback: ['system-ui', 'arial'],
})
const display = localFont({
  src: [
    { path: './fonts/fraunces-latin-wght-normal.woff2', style: 'normal' },
    { path: './fonts/fraunces-latin-wght-italic.woff2', style: 'italic' },
  ],
  weight: '100 900',
  display: 'swap',
  variable: '--font-fraunces',
  fallback: ['Georgia', 'serif'],
})

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
  // The n8builds family share card, rendered by ops/share-cards/source (render.mjs tend).
  openGraph: {
    title: 'Tend',
    description,
    siteName: 'Tend',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Tend: a verse or quote that fits each person, a nudge when it is time, and you send it on Signal.' }],
  },
  twitter: { card: 'summary_large_image', title: 'Tend', description, images: ['/og.png'] },
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
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
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
