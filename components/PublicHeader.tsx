import Link from 'next/link'

import { Logo } from './icons'

export function PublicHeader({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-4">
      <Link href="/" className="flex items-center gap-2 text-lg font-bold no-underline">
        <Logo />
        Tend
      </Link>
      <Link href={signedIn ? '/today' : '/signin'} className="btn btn-secondary btn-sm">
        {signedIn ? 'Open Tend' : 'Sign in'}
      </Link>
    </header>
  )
}
