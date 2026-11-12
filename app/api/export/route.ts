import { and, eq } from 'drizzle-orm'

import { auth } from '@/auth'
import { db } from '@/db'
import { consentEvents, contacts, contactTopics, helperDevices, helperEvents, messages, pushSubscriptions, userSettings } from '@/db/schema'
import { decrypt } from '@/lib/crypto'

export const dynamic = 'force-dynamic'

/** Everything the signed-in user owns, decrypted, as one JSON file. */
export async function GET(): Promise<Response> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return new Response('Sign in first.', { status: 401 })

  const [settings, people, sent, consent, devices, helpers, helperLog] = await Promise.all([
    db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) }),
    db.select().from(contacts).where(eq(contacts.userId, userId)),
    db.select().from(messages).where(eq(messages.userId, userId)),
    db.select().from(consentEvents).where(eq(consentEvents.userId, userId)),
    db
      .select({ device: pushSubscriptions.device, createdAt: pushSubscriptions.createdAt, lastPushedAt: pushSubscriptions.lastPushedAt })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId)),
    // The Signal helper: devices (never their token hashes) and its step log.
    db
      .select({
        name: helperDevices.name,
        createdAt: helperDevices.createdAt,
        lastSeenAt: helperDevices.lastSeenAt,
        helperVersion: helperDevices.helperVersion,
        signalCliVersion: helperDevices.signalCliVersion,
        haltedAt: helperDevices.haltedAt,
        haltReason: helperDevices.haltReason,
        revokedAt: helperDevices.revokedAt,
      })
      .from(helperDevices)
      .where(eq(helperDevices.userId, userId)),
    db
      .select({ messageId: helperEvents.messageId, kind: helperEvents.kind, reason: helperEvents.reason, at: helperEvents.at })
      .from(helperEvents)
      .where(eq(helperEvents.userId, userId)),
  ])
  const exported = await Promise.all(
    // emailHash is a keyed hash for spotting duplicates on import: meaningless outside Tend.
    people.map(async ({ phoneEnc, notesEnc, stopToken: _stopToken, userId: _userId, emailHash: _emailHash, ...contact }) => ({
      ...contact,
      phone: await decrypt(phoneEnc),
      notes: await decrypt(notesEnc),
      topics: await db
        .select({ topic: contactTopics.topic, weight: contactTopics.weight })
        .from(contactTopics)
        .where(and(eq(contactTopics.contactId, contact.id))),
    })),
  )
  const body = {
    exportedAt: new Date().toISOString(),
    account: { email: session.user?.email ?? null },
    settings: settings ? { ...settings, userId: undefined } : null,
    contacts: exported,
    messages: sent.map(({ userId: _u, ...m }) => m),
    consentEvents: consent.map(({ userId: _u, ...e }) => e),
    // Devices with phone notifications on (their push addresses stay out).
    notificationDevices: devices,
    signalHelpers: helpers,
    signalHelperEvents: helperLog,
  }
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="tend-export-${new Date().toISOString().slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  })
}
