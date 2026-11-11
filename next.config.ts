import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Next 16 `next dev` writes agent rules into AGENTS.md when a coding agent runs it; keep the tree clean.
  agentRules: false,
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['@libsql/client'],
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
