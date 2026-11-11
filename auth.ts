/**
 * Auth.js (v5): email magic links through the shared mailroom, and GitHub
 * when AUTH_GITHUB_ID and AUTH_GITHUB_SECRET are set (lib/github-auth: linked
 * to the same account by verified email). Database sessions in
 * Turso, so session.user.id is the id every query is scoped by.
 *
 * Email sign-in only starts from the sign-in action (app/signin/actions.ts),
 * which checks Turnstile and the email limits; the Auth.js route refuses a
 * direct POST to /api/auth/signin/email (app/api/auth/[...nextauth]/route.ts).
 */

import { DrizzleAdapter } from '@auth/drizzle-adapter'
import NextAuth from 'next-auth'
import type { Provider } from 'next-auth/providers'

import { db } from '@/db'
import { accounts, sessions, users, verificationTokens } from '@/db/schema'
import { githubConfigured, githubProvider, githubSignInAllowed } from '@/lib/github-auth'
import { emailKey, layout, sendEmail } from '@/lib/server/email'

export { githubConfigured }

function EmailLink(): Provider {
  return {
    id: 'email',
    type: 'email',
    name: 'Email',
    from: process.env.EMAIL_FROM || 'tend@n8builds.dev',
    server: {},
    maxAge: 60 * 60,
    options: {},
    async sendVerificationRequest({ identifier, url }) {
      const sent = await sendEmail('signin', {
        key: `signin-${await emailKey(url)}`,
        to: identifier,
        subject: 'Your sign-in link for Tend',
        text: `Sign in to Tend:\n\n${url}\n\nThe link works once and expires in an hour. If you didn't ask for it, you can ignore this email.`,
        html: layout({
          heading: 'Sign in to Tend',
          paragraphs: ['Use the button below to sign in. The link works once and expires in an hour.'],
          button: { label: 'Sign in', url },
          footer: "If you didn't ask for this, you can ignore this email; nobody can sign in without it.",
        }),
      })
      if (!sent.ok) throw new Error(`Sign-in email not sent (${sent.code})`)
    },
  }
}

// A function, so the providers are chosen per request from the Worker's
// secrets rather than once at module load.
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'database', maxAge: 30 * 24 * 60 * 60 },
  trustHost: true,
  pages: { signIn: '/signin', verifyRequest: '/signin/check-email', error: '/signin' },
  providers: [
    EmailLink(),
    ...(githubConfigured() ? [githubProvider()] : []),
  ],
  callbacks: {
    signIn({ account, user }) {
      return githubSignInAllowed(account?.provider, user.email) ? true : '/signin?error=GitHubEmail'
    },
    session({ session, user }) {
      if (session.user) session.user.id = user.id
      return session
    },
  },
  logger: {
    // Error names only: Auth.js messages can contain addresses.
    error(error) {
      console.error(JSON.stringify({ event: 'auth_error', name: error.name, type: (error as { type?: string }).type }))
    },
    warn() {},
    debug() {},
  },
}))
