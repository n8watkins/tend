import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ContactForm } from '@/components/ContactForm'
import { PageTitle } from '@/components/ui'
import { getContact } from '@/lib/server/data'
import { requireUser } from '@/lib/server/session'
import { timeZoneOptions } from '@/lib/timezones'

import { updateContact } from '../../../actions'

export const metadata: Metadata = { title: 'Edit' }

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const { id } = await params
  const contact = await getContact(user.id, id)
  if (!contact) notFound()
  return (
    <>
      <PageTitle title={`Edit ${contact.name}`} />
      <ContactForm
        action={updateContact.bind(null, contact.id)}
        isNew={false}
        timezones={timeZoneOptions(contact.timezone)}
        initial={{
          name: contact.name,
          phone: contact.phone ?? '',
          timezone: contact.timezone,
          signalStatus: contact.signalStatus,
          topics: contact.topics.map((t) => t.topic),
          minDaysBetween: contact.minDaysBetween,
          maxPer30Days: contact.maxPer30Days,
          windowStart: contact.windowStart,
          windowEnd: contact.windowEnd,
          allowedDays: contact.allowedDays,
          notes: contact.notes ?? '',
        }}
      />
    </>
  )
}
