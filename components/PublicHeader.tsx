import { headers } from 'next/headers'
import Link from 'next/link'

import { githubConfigured } from '@/auth'
import { turnstileSiteKey } from '@/lib/server/turnstile'

import { Logo } from './icons'
import { SignInDialog, SignInLink } from './SignIn'

const LANDING_NAV = [
  { href: '#how', label: 'How it works' },
  { href: '#passages', label: 'Passages' },
  { href: '#why', label: 'Why Tend' },
  { href: '#questions', label: 'Questions' },
]

/**
 * The header on public pages. Signed out, its "Sign in" opens the sign-in
 * dialog (rendered here, once per page); any SignInLink on the page opens it too.
 */
export async function PublicHeader({ signedIn = false, landing = false, hideSignIn = false }: { signedIn?: boolean; landing?: boolean; hideSignIn?: boolean }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const showDialog = !signedIn && !hideSignIn
  return (
    <header className={landing ? 'site-header' : undefined}>
      <div className={`mx-auto flex w-full items-center justify-between gap-4 px-4 py-3 ${landing ? 'max-w-6xl' : 'max-w-3xl py-4'}`}>
        <Link href="/" className="flex items-center gap-2 text-lg font-bold no-underline">
          <Logo />
          Tend
        </Link>
        {landing ? (
          <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
            {LANDING_NAV.map((item) => (
              <a key={item.href} href={item.href} className="nav-link">
                {item.label}
              </a>
            ))}
          </nav>
        ) : null}
        <div className="flex items-center gap-2">
          {landing ? (
            <a href="https://github.com/n8watkins/tend" className="btn btn-ghost btn-sm hidden px-2 sm:inline-flex" aria-label="Tend on GitHub">
              <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
                <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.3 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
              </svg>
            </a>
          ) : null}
          {signedIn ? (
            <Link href="/today" className="btn btn-primary btn-sm">
              Open Tend
            </Link>
          ) : hideSignIn ? null : (
            <SignInLink className="btn btn-secondary btn-sm">Sign in</SignInLink>
          )}
        </div>
      </div>
      {showDialog ? <SignInDialog siteKey={turnstileSiteKey()} nonce={nonce} github={githubConfigured()} /> : null}
    </header>
  )
}
