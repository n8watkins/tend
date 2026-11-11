import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchGitHubProfile, githubConfigured, githubSignInAllowed, verifiedEmail } from '@/lib/github-auth'

describe('verifiedEmail', () => {
  it('prefers the primary verified address, lower-cased', () => {
    expect(
      verifiedEmail([
        { email: 'other@example.com', primary: false, verified: true },
        { email: 'Me@Example.com', primary: true, verified: true },
      ]),
    ).toBe('me@example.com')
  })

  it('never uses an unverified address, even the primary one', () => {
    expect(verifiedEmail([{ email: 'me@example.com', primary: true, verified: false }])).toBeNull()
    expect(
      verifiedEmail([
        { email: 'me@example.com', primary: true, verified: false },
        { email: 'work@example.com', primary: false, verified: true },
      ]),
    ).toBe('work@example.com')
    expect(verifiedEmail([])).toBeNull()
  })
})

describe('fetchGitHubProfile', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('replaces the public profile email with the verified one', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, _init?: RequestInit) =>
      String(url).endsWith('/user/emails')
        ? json([{ email: 'Real@Example.com', primary: true, verified: true }])
        : json({ id: 7, login: 'sam', name: 'Sam', email: 'unverified@example.com', avatar_url: 'https://avatars.example/7' }),
    )
    const profile = await fetchGitHubProfile('token', fetcher as typeof fetch)
    expect(profile).toMatchObject({ id: 7, login: 'sam', email: 'real@example.com' })
    for (const call of fetcher.mock.calls) expect((call[1]?.headers as Record<string, string>).authorization).toBe('Bearer token')
  })

  it('gives no email when the email list cannot be read', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => (String(url).endsWith('/user/emails') ? json({ message: 'no' }, 403) : json({ id: 7, email: 'public@example.com' })))
    expect((await fetchGitHubProfile('token', fetcher as typeof fetch)).email).toBeNull()
  })
})

describe('githubSignInAllowed', () => {
  it('refuses GitHub without an email and leaves other providers alone', () => {
    expect(githubSignInAllowed('github', null)).toBe(false)
    expect(githubSignInAllowed('github', 'me@example.com')).toBe(true)
    expect(githubSignInAllowed('email', null)).toBe(true)
  })
})

describe('githubConfigured', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('is on only with both the id and the secret', () => {
    vi.stubEnv('AUTH_GITHUB_ID', '')
    vi.stubEnv('AUTH_GITHUB_SECRET', '')
    expect(githubConfigured()).toBe(false)
    vi.stubEnv('AUTH_GITHUB_ID', 'id')
    expect(githubConfigured()).toBe(false)
    vi.stubEnv('AUTH_GITHUB_SECRET', 'secret')
    expect(githubConfigured()).toBe(true)
  })
})
