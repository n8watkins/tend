import type { Metadata } from 'next'
import Link from 'next/link'

import { PublicHeader } from '@/components/PublicHeader'
import { SiteFooter } from '@/components/SiteFooter'

export const metadata: Metadata = { title: 'Check your email' }

export default function CheckEmailPage() {
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto w-full max-w-sm px-4 py-10">
        <h1 className="text-3xl font-bold">Check your email</h1>
        <p className="mt-3 text-muted">
          We sent you a sign-in link from tend@n8builds.dev. Open it on this device to sign in. It works once and expires in an hour.
        </p>
        <p className="mt-3 text-muted">Nothing there after a minute or two? Check your spam folder.</p>
        <Link href="/signin" className="btn btn-secondary mt-8">
          Use a different email
        </Link>
      </main>
      <SiteFooter />
    </>
  )
}
