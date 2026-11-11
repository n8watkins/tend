import Link from 'next/link'

import { PublicHeader } from '@/components/PublicHeader'
import { SiteFooter } from '@/components/SiteFooter'

export default function NotFound() {
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto w-full max-w-md px-4 py-16 text-center">
        <h1 className="text-3xl font-bold">Not found</h1>
        <p className="mt-3 text-muted">That page does not exist, or it belongs to someone else.</p>
        <Link href="/" className="btn btn-primary mt-8">
          Go home
        </Link>
      </main>
      <SiteFooter />
    </>
  )
}
