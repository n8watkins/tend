import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth, githubConfigured } from '@/auth'
import { PublicHeader } from '@/components/PublicHeader'
import { SiteFooter } from '@/components/SiteFooter'
import { SubmitButton } from '@/components/SubmitButton'
import { turnstileSiteKey } from '@/lib/server/turnstile'

import { githubSignIn } from './actions'
import { SignInForm } from './SignInForm'

export const metadata: Metadata = { title: 'Sign in' }

const ERRORS: Record<string, string> = {
  Verification: 'That sign-in link has expired or was already used. Ask for a new one below.',
  OAuthAccountNotLinked: 'That GitHub account is linked to a different Tend account. Use the email form below.',
  GitHubEmail: 'Your GitHub account has no verified email address, so Tend cannot link it. Verify one on GitHub, or use the email form below.',
  AccessDenied: 'Sign-in was refused.',
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if ((await auth())?.user) redirect('/today')
  const { error } = await searchParams
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const message = error ? (ERRORS[error] ?? 'Something went wrong signing in. Please try again.') : null
  return (
    <>
      <PublicHeader hideSignIn />
      <main id="main" className="mx-auto w-full max-w-sm px-4 py-10">
        <h1 className="text-3xl font-bold">Sign in to Tend</h1>
        <p className="mt-2 text-muted">New here? The same link creates your account. No password needed.</p>
        {message ? (
          <p role="alert" className="notice notice-warn mt-6">
            {message}
          </p>
        ) : null}
        <div className="mt-6">
          <SignInForm siteKey={turnstileSiteKey()} nonce={nonce} />
        </div>
        {githubConfigured() ? (
          <>
            <div className="my-6 flex items-center gap-3 text-sm text-muted" aria-hidden="true">
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>
            <form action={githubSignIn}>
              <SubmitButton className="btn btn-secondary w-full" pending="Opening GitHub...">
                Continue with GitHub
              </SubmitButton>
            </form>
          </>
        ) : null}
        <p className="mt-8 text-sm text-muted">
          By signing in you agree to the{' '}
          <a href="/terms" className="underline underline-offset-2">
            terms
          </a>{' '}
          and{' '}
          <a href="/privacy" className="underline underline-offset-2">
            privacy policy
          </a>
          .
        </p>
      </main>
      <SiteFooter />
    </>
  )
}
