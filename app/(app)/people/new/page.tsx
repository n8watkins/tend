import type { Metadata } from 'next'

import { ContactForm } from '@/components/ContactForm'
import { PageTitle } from '@/components/ui'
import { getSettings, requireUser } from '@/lib/server/session'
import { timeZoneOptions } from '@/lib/timezones'

import { createContact } from '../../actions'

export const metadata: Metadata = { title: 'Add someone' }

export default async function NewContactPage() {
  const user = await requireUser()
  const settings = await getSettings(user.id)
  return (
    <>
      <PageTitle title="Add someone" subtitle="Only a name is required. You can change everything later." />
      <ContactForm
        action={createContact}
        isNew
        timezones={timeZoneOptions(settings.timezone)}
        initial={{
          name: '',
          phone: '',
          timezone: settings.timezone,
          signalStatus: 'unknown',
          topics: [],
          minDaysBetween: 7,
          maxPer30Days: 4,
          windowStart: 9 * 60,
          windowEnd: 20 * 60,
          allowedDays: 127,
          notes: '',
        }}
      />
    </>
  )
}
