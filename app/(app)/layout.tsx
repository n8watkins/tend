import Link from 'next/link'

import { AppNav } from '@/components/AppNav'
import { InstallHint } from '@/components/InstallHint'
import { Logo } from '@/components/icons'
import { SiteFooter } from '@/components/SiteFooter'
import { SubmitButton } from '@/components/SubmitButton'
import { getSettings, requireUser } from '@/lib/server/session'

import { setPaused } from './actions'
import './app.css'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const settings = await getSettings(user.id)
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <Link href="/today" className="app-wordmark">
            <Logo />
            Tend
          </Link>
          <AppNav />
        </div>
      </header>
      {settings.pausedAt ? (
        <div className="notice-warn">
          <form action={setPaused} className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <p>
              <strong>Tend is paused.</strong> No reminders and no new messages until you resume.
            </p>
            <input type="hidden" name="paused" value="no" />
            <input type="hidden" name="back" value="/today" />
            <SubmitButton className="btn btn-secondary btn-sm">Resume</SubmitButton>
          </form>
        </div>
      ) : null}
      <main id="main" className="app-main isolate">
        <div className="app-glow" aria-hidden="true" />
        <InstallHint />
        {children}
      </main>
      <SiteFooter wide />
    </div>
  )
}
