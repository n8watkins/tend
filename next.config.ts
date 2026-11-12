import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Next 16 `next dev` writes agent rules into AGENTS.md when a coding agent runs it; keep the tree clean.
  agentRules: false,
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['@libsql/client'],
  // Names this build for the service worker (components/ServiceWorker.tsx):
  // each deploy registers /sw.js?v=<build>, so phones pick up the new version.
  env: { NEXT_PUBLIC_BUILD_ID: (process.env.GITHUB_SHA ?? '').slice(0, 12) || Date.now().toString(36) },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ]
  },
}

export default nextConfig

// Bindings (EMAIL) in `next dev`, simulated by wrangler.
if (process.env.NODE_ENV === 'development') initOpenNextCloudflareForDev()
