import type { Metadata } from 'next'

import { HelperSettings } from '@/components/HelperSettings'
import { InstallApp } from '@/components/InstallApp'
import { PushSettings } from '@/components/PushSettings'
import { DeleteAccountForm, PreferencesForm } from '@/components/SettingsForms'
import { SubmitButton } from '@/components/SubmitButton'
import { Done, PageTitle, Section } from '@/components/ui'
import { helperAllowedFor, helperStatus } from '@/lib/server/helper'
import { userSubscriptions, vapidPublicKey } from '@/lib/server/push'
import { getSettings, requireUser } from '@/lib/server/session'
import { telegramConfigured } from '@/lib/server/telegram'
import { timeZoneOptions } from '@/lib/timezones'

import { connectTelegram, deleteAccount, disconnectTelegram, setPaused, setTelegramReminders, signOutAction, updateSettings } from '../actions'

export const metadata: Metadata = { title: 'Settings' }

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const user = await requireUser()
  const { done, error } = await searchParams
  const settings = await getSettings(user.id)
  const pushKey = await vapidPublicKey()
  const devices = pushKey ? (await userSubscriptions(user.id)).map(({ endpoint, device }) => ({ endpoint, device })) : []
  // The Signal helper is private for now: only accounts in SIGNAL_HELPER_USERS see it.
  const helper = helperAllowedFor(user.email) ? await helperStatus(user.id) : null
  return (
    <>
      <PageTitle title="Settings" subtitle={user.email ? `Signed in as ${user.email}` : undefined} />
      <Done code={done} />

      <PreferencesForm
        action={updateSettings}
        timezone={settings.timezone}
        translation={settings.translation}
        suggest={settings.suggest}
        emailReminders={settings.emailReminders}
        timezones={timeZoneOptions(settings.timezone)}
      />

      <Section title="On your phone" id="phone">
        <div className="card space-y-5">
          <div className="space-y-2">
            <h3 className="font-semibold">Install Tend</h3>
            <InstallApp />
          </div>
          {pushKey ? (
            <div className="border-t border-line pt-5">
              <PushSettings publicKey={pushKey} devices={devices} />
              <p className="hint mt-3">Email reminders are set above. Keep both, or turn email off to get notifications only.</p>
            </div>
          ) : null}
        </div>
      </Section>

      {telegramConfigured() ? (
        <Section title="Telegram" id="telegram">
          <div className="card space-y-3">
            {error === 'telegram' ? (
              <p role="alert" className="notice notice-warn">
                Telegram is not reachable just now. Please try again in a minute.
              </p>
            ) : null}
            {settings.telegramChatId ? (
              <>
                <p>Connected. Due reminders come to Telegram with the message ready to share, and buttons to mark it sent or snooze it.</p>
                <form action={setTelegramReminders} className="space-y-3">
                  <label className="flex items-start gap-2">
                    <input type="checkbox" name="telegramReminders" defaultChecked={settings.telegramReminders} className="mt-1 size-4" />
                    <span>Send my reminders to Telegram</span>
                  </label>
                  <SubmitButton className="btn btn-secondary">Save</SubmitButton>
                </form>
                <form action={disconnectTelegram} className="border-t border-line pt-3">
                  <SubmitButton className="btn btn-ghost">Disconnect Telegram</SubmitButton>
                </form>
              </>
            ) : (
              <>
                <p>Get your reminders in Telegram too, with the message ready to share and an &ldquo;I sent it&rdquo; button. Tend opens its bot; press Start there to connect. The link works once, for 15 minutes.</p>
                <form action={connectTelegram}>
                  <SubmitButton className="btn btn-secondary" pending="Opening Telegram...">
                    Connect Telegram
                  </SubmitButton>
                </form>
              </>
            )}
            <p className="hint">Email reminders are set above; keep both, or turn email off to get Telegram only. Send /stop to the bot to disconnect from Telegram itself.</p>
          </div>
        </Section>
      ) : null}

      {helper ? (
        <Section title="Signal helper" id="helper">
          <HelperSettings status={helper} timezone={settings.timezone} notificationsOn={devices.length > 0} error={error} />
        </Section>
      ) : null}

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
