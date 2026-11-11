'use server'

/**
 * The recipient's stop (docs/SPEC.md section 9). A POST only: Signal fetches
 * link previews with a GET, and a preview must never stop anything.
 */

import { and, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { db } from '@/db'
import { consentEvents, contacts, messages } from '@/db/schema'

export async function stopMessages(token: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) redirect('/')
  const contact = await db.query.contacts.findFirst({ where: eq(contacts.stopToken, token) })
  if (!contact) redirect('/')
  if (contact.consent !== 'stopped') {
    const now = Date.now()
    await db
      .update(contacts)
      .set({ consent: 'stopped', stoppedByRecipient: true, consentUpdatedAt: now, updatedAt: now })
      .where(eq(contacts.id, contact.id))
    await db.insert(consentEvents).values({
      userId: contact.userId,
      contactId: contact.id,
      from: contact.consent,
      to: 'stopped',
      by: 'recipient',
      at: now,
    })
    await db
      .update(messages)
      .set({ status: 'canceled', updatedAt: now })
      .where(and(eq(messages.contactId, contact.id), eq(messages.status, 'scheduled')))
  }
  redirect(`/stop/${token}?done=1`)
}
