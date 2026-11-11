import Link from 'next/link'

import { AppNav } from '@/components/AppNav'
import { Logo } from '@/components/icons'
import { SiteFooter } from '@/components/SiteFooter'
import { SubmitButton } from '@/components/SubmitButton'
import { getSettings, requireUser } from '@/lib/server/session'

import { setPaused } from './actions'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const settings = await getSettings(user.id)
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/today" className="flex items-center gap-2 text-lg font-bold no-underline">
            <Logo />
            Tend
          </Link>
          <AppNav />
        </div>
      </header>
      {settings.pausedAt ? (
        <div className="notice-warn">
          <form action={setPaused} className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <p>
              <strong>Tend is paused.</strong> No reminders and no new messages until you resume.
            </p>
            <input type="hidden" name="paused" value="no" />
            <input type="hidden" name="back" value="/today" />
            <SubmitButton className="btn btn-secondary btn-sm">Resume</SubmitButton>
          </form>
        </div>
      ) : null}
      <main id="main" className="mx-auto w-full max-w-3xl px-4 py-6">
        {children}
      </main>
      <SiteFooter />
    </>
  )
}
