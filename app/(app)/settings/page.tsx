import type { Metadata } from 'next'

import { DeleteAccountForm, PreferencesForm } from '@/components/SettingsForms'
import { SubmitButton } from '@/components/SubmitButton'
import { Done, PageTitle, Section } from '@/components/ui'
import { getSettings, requireUser } from '@/lib/server/session'
import { timeZoneOptions } from '@/lib/timezones'

import { deleteAccount, setPaused, signOutAction, updateSettings } from '../actions'

export const metadata: Metadata = { title: 'Settings' }

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const user = await requireUser()
  const { done } = await searchParams
  const settings = await getSettings(user.id)
  return (
    <>
      <PageTitle title="Settings" subtitle={user.email ? `Signed in as ${user.email}` : undefined} />
      <Done code={done} />

      <PreferencesForm
        action={updateSettings}
        timezone={settings.timezone}
        translation={settings.translation}
        emailReminders={settings.emailReminders}
        timezones={timeZoneOptions(settings.timezone)}
      />

      <Section title="Pause everything" id="pause">
        <form action={setPaused} className="card space-y-3">
          <p>{settings.pausedAt ? 'Tend is paused: no reminders and no new messages.' : 'Stop all reminders and scheduling at once, for example while you are away.'}</p>
          <input type="hidden" name="paused" value={settings.pausedAt ? 'no' : 'yes'} />
          <input type="hidden" name="back" value="/settings" />
          <SubmitButton className="btn btn-secondary">{settings.pausedAt ? 'Resume Tend' : 'Pause Tend'}</SubmitButton>
        </form>
      </Section>

      <Section title="Your data" id="data">
        <div className="card space-y-3">
          <p>Download everything Tend holds for you, including phone numbers and notes, as a JSON file.</p>
          <a href="/api/export" className="btn btn-secondary" download>
            Export my data
          </a>
        </div>
      </Section>

      <Section title="Account" id="account">
        <div className="card space-y-6">
          <form action={signOutAction}>
            <SubmitButton className="btn btn-secondary">Sign out</SubmitButton>
          </form>
          <div className="border-t border-line pt-5">
            <p className="mb-3 text-sm text-muted">Deleting your account removes every person, message and setting immediately. It cannot be undone.</p>
            <DeleteAccountForm action={deleteAccount} />
          </div>
        </div>
      </Section>
    </>
  )
}
