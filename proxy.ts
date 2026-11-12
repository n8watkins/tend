import { NextResponse, type NextRequest } from 'next/server'

/**
 * A Content-Security-Policy with a fresh script nonce on every page. Next reads
 * the nonce from the request's CSP header and puts it on the scripts it
 * renders; 'strict-dynamic' lets those load Turnstile. No 'unsafe-inline' or
 * 'unsafe-eval' for scripts in production.
 */
export function proxy(request: NextRequest) {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const nonce = btoa(String.fromCharCode(...bytes))
  const dev = process.env.NODE_ENV === 'development'
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    // The service worker (public/sw.js); 'strict-dynamic' above would refuse it otherwise.
    "worker-src 'self'",
    "manifest-src 'self'",
    "font-src 'self'",
    `connect-src 'self' https://challenges.cloudflare.com${dev ? ' ws:' : ''}`,
    'frame-src https://challenges.cloudflare.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://github.com",
    "frame-ancestors 'none'",
    ...(dev || request.nextUrl.protocol === 'http:' ? [] : ['upgrade-insecure-requests']),
  ].join('; ')

  const headers = new Headers(request.headers)
  headers.set('x-nonce', nonce)
  headers.set('Content-Security-Policy', policy)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set('Content-Security-Policy', policy)
  return response
}

export const config = {
  // Pages only: not static files, images, the app manifest, service worker and icons, or the API.
  matcher: [
    {
      source:
        '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|opengraph-image|manifest.webmanifest|sw.js|offline.html|icons/).*)',
    },
  ],
}
