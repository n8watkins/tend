'use server'

/**
 * Contact import, one step at a time (docs/SPEC.md section 2, "Contact
 * import"): read the file, map CSV columns, review and import. The file is
 * read in memory; nothing from it is stored except the people imported.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { CSV_FIELDS, guessMapping, looksLikeVcard, mapCsvRows, MAX_IMPORT_ROWS, MAX_NAME, parseCsv, parseVcards, type CsvMapping, type ImportRow } from '@/lib/import'
import { IMPORT_READS_PER_USER_DAILY, MAX_CONTACTS } from '@/lib/limits'
import { parsePartialDate } from '@/lib/occasions'
import { countContacts } from '@/lib/server/data'
import { insertRows, previewRows, readUpload, type PreviewRow } from '@/lib/server/import'
import { readLimit, spend } from '@/lib/server/limits'
import { getSettings, requireUser } from '@/lib/server/session'

export type ImportSource = 'vcard' | 'csv' | 'google'

export type ImportState =
  | { step: 'upload'; error?: string }
  | { step: 'map'; fileName: string; headers: string[]; rows: string[][]; mapping: CsvMapping; error?: string }
  | { step: 'review'; source: ImportSource; rows: PreviewRow[]; truncated: boolean; error?: string }

export async function importStep(prev: ImportState, form: FormData): Promise<ImportState> {
  const user = await requireUser()
  switch (form.get('intent')) {
    case 'read':
      return readFile(user.id, form)
    case 'map':
      return prev.step === 'map' ? mapColumns(user.id, prev, form) : { step: 'upload' }
    case 'import':
      return prev.step === 'review' ? importChosen(user.id, prev, form) : { step: 'upload' }
    default:
      return { step: 'upload' }
  }
}

async function readFile(userId: string, form: FormData): Promise<ImportState> {
  const file = form.get('file')
  if (!(file instanceof File) || !file.name) return { step: 'upload', error: 'Choose a .vcf or .csv file first.' }
  if (!/\.(vcf|vcard|csv|txt)$/i.test(file.name)) return { step: 'upload', error: 'Tend reads .vcf (contacts) and .csv files.' }
  const allowed = await spend([{ key: `import:user:${userId}`, limit: readLimit('IMPORT_READS_PER_USER_DAILY', IMPORT_READS_PER_USER_DAILY) }]).catch(() => false)
  if (!allowed) return { step: 'upload', error: 'That is enough imports for today. Try again tomorrow.' }
  const upload = await readUpload(file)
  if ('error' in upload) return { step: 'upload', error: upload.error }

  if (looksLikeVcard(upload.text) || /\.vcf|\.vcard$/i.test(file.name)) {
    const rows = parseVcards(upload.text)
    if (!rows.length) return { step: 'upload', error: 'No contacts with a name were found in that file.' }
    return { step: 'review', source: 'vcard', rows: await previewRows(userId, rows.slice(0, MAX_IMPORT_ROWS)), truncated: rows.length > MAX_IMPORT_ROWS }
  }
  const [headers, ...rows] = parseCsv(upload.text)
  if (!headers || !rows.length) return { step: 'upload', error: 'That file has no rows to import. The first row should name the columns.' }
  return {
    step: 'map',
    fileName: file.name.slice(0, 120),
    headers: headers.map((h) => h.slice(0, 80)),
    // Only what the import can use: a few hundred rows, each cell trimmed.
    rows: rows.slice(0, MAX_IMPORT_ROWS + 1).map((r) => r.slice(0, 80).map((c) => c.slice(0, 200))),
    mapping: guessMapping(headers),
  }
}

async function mapColumns(userId: string, prev: Extract<ImportState, { step: 'map' }>, form: FormData): Promise<ImportState> {
  const mapping = { dateOrder: form.get('dateOrder') === 'dmy' ? 'dmy' : 'mdy' } as CsvMapping
  for (const field of CSV_FIELDS) {
    const index = Number(form.get(field) ?? -1)
    mapping[field] = Number.isInteger(index) && index >= 0 && index < prev.headers.length ? index : -1
  }
  if (mapping.name < 0 && mapping.firstName < 0 && mapping.lastName < 0) return { ...prev, mapping, error: 'Choose the column with their name.' }
  const rows = mapCsvRows(prev.rows, mapping)
  if (!rows.length) return { ...prev, mapping, error: 'None of the rows has a name in that column.' }
  return { step: 'review', source: 'csv', rows: await previewRows(userId, rows.slice(0, MAX_IMPORT_ROWS)), truncated: rows.length > MAX_IMPORT_ROWS }
}

async function importChosen(userId: string, prev: Extract<ImportState, { step: 'review' }>, form: FormData): Promise<ImportState> {
  // The chosen rows are indexes into the preview. The preview comes back
  // from the browser as the previous state, so validRow checks each again.
  if (!Array.isArray(prev.rows) || prev.rows.length > MAX_IMPORT_ROWS) return { step: 'upload' }
  const parsed = z
    .array(z.coerce.number().int().min(0).max(prev.rows.length - 1))
    .max(MAX_IMPORT_ROWS)
    .safeParse(form.getAll('row'))
  if (!parsed.success) return { ...prev, error: 'Choose the people to import again.' }
  const chosen = [...new Set(parsed.data)].map((i) => prev.rows[i]!).filter(validRow)
  if (!chosen.length) return { ...prev, error: 'Choose at least one person to import.' }
  const room = MAX_CONTACTS - (await countContacts(userId))
  if (chosen.length > room) {
    return { ...prev, error: room > 0 ? `You can add ${room} more ${room === 1 ? 'person' : 'people'} (up to ${MAX_CONTACTS} in all). Choose fewer.` : `You already have ${MAX_CONTACTS} people.` }
  }
  const settings = await getSettings(userId)
  const added = await insertRows(userId, settings.timezone, chosen)
  revalidatePath('/people')
  redirect(`/people?done=imported&n=${added}`)
}

/** Checks a row from the browser before it is stored: a name, an E.164 number, real dates. */
function validRow(row: ImportRow): boolean {
  return (
    typeof row === 'object' &&
    row !== null &&
    typeof row.name === 'string' &&
    row.name.trim().length > 0 &&
    row.name.length <= MAX_NAME &&
    (row.phone === null || /^\+[1-9]\d{6,14}$/.test(row.phone)) &&
    (row.email === null || (typeof row.email === 'string' && row.email.length <= 254)) &&
    (row.birthday === null || parsePartialDate(row.birthday) !== null) &&
    (row.anniversary === null || parsePartialDate(row.anniversary) !== null)
  )
}
