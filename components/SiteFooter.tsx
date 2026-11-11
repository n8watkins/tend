import Link from 'next/link'

export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-3xl px-4 pt-10 pb-28 text-sm text-muted md:pb-10">
      <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p>
          A project by{' '}
          <a href="https://n8builds.dev" className="font-semibold text-ink underline-offset-2 hover:underline">
            n8builds.dev
          </a>
        </p>
        <nav aria-label="Site" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/privacy" className="hover:text-ink hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-ink hover:underline">
            Terms
          </Link>
          <a href="https://github.com/n8watkins/tend" className="hover:text-ink hover:underline">
            Source code
          </a>
        </nav>
      </div>
      <p className="mt-4 text-xs">Tend is an independent project for Signal users. It is not made by or affiliated with Signal.</p>
    </footer>
  )
}
