/**
 * Auth.js (v5): email magic links through Cloudflare Email Service, and GitHub
 * when AUTH_GITHUB_ID and AUTH_GITHUB_SECRET are set. Database sessions in
 * Turso, so session.user.id is the id every query is scoped by.
 *
 * Email sign-in only starts from the sign-in action (app/signin/actions.ts),
 * which checks Turnstile and the email limits; the Auth.js route refuses a
 * direct POST to /api/auth/signin/email (app/api/auth/[...nextauth]/route.ts).
 */

import { DrizzleAdapter } from '@auth/drizzle-adapter'
import NextAuth from 'next-auth'
import GitHub from 'next-auth/providers/github'
import type { Provider } from 'next-auth/providers'

import { db } from '@/db'
import { accounts, sessions, users, verificationTokens } from '@/db/schema'
import { layout, sendEmail } from '@/lib/server/email'

export function githubConfigured(): boolean {
  return Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET)
}

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
      const sent = await sendEmail({
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
      if (!sent) throw new Error('Email is not configured')
    },
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
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
    ...(githubConfigured()
      ? [
          // No automatic linking to an email account with the same address:
          // GitHub can report an unverified address.
          GitHub({ authorization: { params: { scope: 'read:user user:email' } } }),
        ]
      : []),
  ],
  callbacks: {
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
})
