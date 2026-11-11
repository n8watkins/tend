/**
 * Sign in with GitHub, linked to the same Tend account as the email link.
 *
 * Linking by email is only safe with an address GitHub has verified, so the
 * profile's email is always the account's primary verified address (or,
 * failing that, any verified one), read from /user/emails, lower-cased like
 * the email sign-in. With no verified address the sign-in is refused
 * (see `githubSignInAllowed`), never matched to an account.
 */

import GitHub from 'next-auth/providers/github'

/** GitHub sign-in is on only when both Worker secrets are set; the button is hidden otherwise. */
export function githubConfigured(): boolean {
  return Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET)
}

export type GitHubEmail = { email: string; primary: boolean; verified: boolean }

/** The address to link by: primary and verified, else any verified one, else none. */
export function verifiedEmail(emails: GitHubEmail[]): string | null {
  const pick = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified)
  return pick ? pick.email.trim().toLowerCase() : null
}

const API = 'https://api.github.com'

export async function fetchGitHubProfile(accessToken: string, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json', 'user-agent': 'tend.n8builds.dev' }
  const [user, emails] = await Promise.all([fetcher(`${API}/user`, { headers }), fetcher(`${API}/user/emails`, { headers })])
  if (!user.ok) throw new Error(`GitHub /user: HTTP ${user.status}`)
  const profile = (await user.json()) as Record<string, unknown>
  const list = emails.ok ? ((await emails.json()) as GitHubEmail[]) : []
  return { ...profile, email: verifiedEmail(Array.isArray(list) ? list : []) }
}

export function githubProvider() {
  return GitHub({
    authorization: { params: { scope: 'read:user user:email' } },
    // Safe only because the email below is always one GitHub verified.
    allowDangerousEmailAccountLinking: true,
    userinfo: {
      url: `${API}/user`,
      async request({ tokens }: { tokens: { access_token?: string } }) {
        return fetchGitHubProfile(tokens.access_token ?? '')
      },
    },
  })
}

/** Auth.js signIn callback rule: a GitHub sign-in needs a verified email. */
export function githubSignInAllowed(provider: string | undefined, email: unknown): boolean {
  return provider !== 'github' || (typeof email === 'string' && email.length > 0)
}
