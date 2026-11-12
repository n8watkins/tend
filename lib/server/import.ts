import 'server-only'

/**
 * Contact import on the server (docs/SPEC.md section 2, "Contact import"):
 * reading an upload, marking duplicates against People, and adding the
 * chosen rows. Files are read in memory and never stored. Imported people
 * start at consent "not asked", with the user's time zone and the default
 * rules; phone numbers are encrypted like any other, and an email address
 * is kept only as a keyed hash, to spot the same person next time.
 */

import { and, eq, isNotNull, or } from 'drizzle-orm'

import { db } from '@/db'
import { contacts } from '@/db/schema'
import { blindIndex, decrypt, encrypt, randomToken } from '@/lib/crypto'
import { markDuplicates, MAX_IMPORT_BYTES, type ImportRow, type RowStatus } from '@/lib/import'
import { DEFAULT_LEAD_DAYS } from '@/lib/occasions'

export interface PreviewRow extends ImportRow {
  status: RowStatus
}

/** The upload as text: UTF-8, or Windows-1252 (older Outlook and Excel exports) when it is not valid UTF-8. */
export async function readUpload(file: File): Promise<{ text: string } | { error: string }> {
  if (file.size === 0) return { error: 'That file is empty.' }
  if (file.size > MAX_IMPORT_BYTES) return { error: 'That file is over 1 MB. Export fewer contacts at a time, or as a .vcf.' }
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes) }
  }
}

async function emailKey(email: string | null): Promise<string | null> {
  return email ? blindIndex(email) : null
}

/** Phone numbers and email hashes of the user's people, to match against. */
async function existingKeys(userId: string) {
  const rows = await db
    .select({ phoneEnc: contacts.phoneEnc, emailHash: contacts.emailHash })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), or(isNotNull(contacts.phoneEnc), isNotNull(contacts.emailHash))))
  const phones = new Set<string>()
  const emails = new Set<string>()
  for (const row of rows) {
    const phone = await decrypt(row.phoneEnc)
    if (phone) phones.add(phone)
    if (row.emailHash) emails.add(row.emailHash)
  }
  return { phones, emails }
}

/** Each row with its status: new, already in People, or a repeat within the file. */
export async function previewRows(userId: string, rows: ImportRow[]): Promise<PreviewRow[]> {
  const keys = await existingKeys(userId)
  const hashed = await Promise.all(rows.map(async (r) => ({ phone: r.phone, email: await emailKey(r.email) })))
  const statuses = markDuplicates(hashed, keys)
  return rows.map((row, i) => ({ ...row, status: statuses[i]! }))
}

/** Adds the rows to People. The caller has checked the contact limit. */
export async function insertRows(userId: string, timezone: string, rows: ImportRow[], now = Date.now()): Promise<number> {
  const values = await Promise.all(
    rows.map(async (row) => ({
      id: crypto.randomUUID(),
      userId,
      name: row.name,
      phoneEnc: await encrypt(row.phone),
      emailHash: await emailKey(row.email),
      timezone,
      consent: 'not_asked' as const,
      consentUpdatedAt: now,
      birthday: row.birthday,
      anniversary: row.anniversary,
      occasionLeadDays: DEFAULT_LEAD_DAYS,
      stopToken: randomToken(),
      createdAt: now,
      updatedAt: now,
    })),
  )
  // A few dozen rows per statement keeps well inside SQLite's limits.
  for (let i = 0; i < values.length; i += 40) await db.insert(contacts).values(values.slice(i, i + 40))
  return values.length
}
