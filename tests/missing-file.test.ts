import { describe, expect, it } from 'vitest'

import { isMissingFile, missingFile } from '../worker/missing-file'

const at = (path: string, init?: RequestInit) => new Request(`https://tend.n8builds.dev${path}`, init)

describe('isMissingFile', () => {
  it('lets every real route and static file through', () => {
    for (const path of [
      '/',
      '/today',
      '/people/0b9f6c1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
      '/people/import/google',
      '/stop/AbC-_123xyz',
      '/send/0b9f6c1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
      '/api/auth/session',
      '/api/helper/jobs/abc/claim',
      '/api/cron/reminders',
      '/healthz',
      '/_next/image',
      '/does-not-exist',
      '/manifest.webmanifest',
      '/icon.svg',
      '/apple-icon.png',
    ]) {
      expect(isMissingFile(path), path).toBe(false)
    }
  })

  it('refuses file-like paths that are not routes', () => {
    for (const path of [
      '/config.json',
      '/.s3cfg',
      '/secrets.json',
      '/www.zip',
      '/terraform.tfvars',
      '/vercel.json',
      '/.env',
      '/.git/config',
      '/wp-login.php',
      '/backup.sql',
      '/api/config.json',
      '/_next/static/chunks/gone.js',
      '/icon.png',
      '/.well-known/.env',
      '/.well-known/security.txt',
      '/manifest.webmanifest.bak',
    ]) {
      expect(isMissingFile(path), path).toBe(true)
    }
  })
})

describe('missingFile', () => {
  it('is a small, cookie-free, briefly cached 404, whatever the method', async () => {
    for (const method of ['GET', 'HEAD', 'POST']) {
      const response = missingFile(at('/config.json', { method }))
      expect(response?.status).toBe(404)
      expect(response?.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
      expect(response?.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=300')
      expect(response?.headers.get('Set-Cookie')).toBeNull()
    }
    expect(await missingFile(at('/.s3cfg'))?.text()).toBe('Not found')
  })

  it('leaves everything else to the app, including its own 404 page', () => {
    expect(missingFile(at('/nope'))).toBeNull()
    expect(missingFile(at('/icon.svg'))).toBeNull()
  })
})
