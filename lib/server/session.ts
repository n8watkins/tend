import 'server-only'

import { eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { db } from '@/db'
import { userSettings, type UserSettings } from '@/db/schema'
import { isValidTimeZone } from '@/lib/time'

export interface CurrentUser {
  id: string
  email: string | null
  name: string | null
}

/** The signed-in user, or a redirect to /signin. */
export async function requireUser(): Promise<CurrentUser> {
  const session = await auth()
  const id = session?.user?.id
  if (!id) redirect('/signin')
  return { id, email: session.user?.email ?? null, name: session.user?.name ?? null }
}

/** The browser's time zone, which components/TimezoneCookie.tsx keeps in a cookie. */
export async function browserTimeZone(): Promise<string> {
  const value = (await cookies()).get('tz')?.value
  return value && isValidTimeZone(value) ? value : 'UTC'
}

/** The user's settings row, created with defaults on first use. */
export async function getSettings(userId: string): Promise<UserSettings> {
  const existing = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) })
  if (existing) return existing
  const [created] = await db
    .insert(userSettings)
    .values({ userId, timezone: await browserTimeZone(), createdAt: Date.now() })
    .onConflictDoNothing()
    .returning()
  return created ?? (await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) }))!
}
