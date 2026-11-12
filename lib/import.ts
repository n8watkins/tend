/**
 * Contact import (docs/SPEC.md section 2, "Contact import"): vCard (.vcf, the
 * phone-contacts export from iPhone and Android) and CSV with column mapping,
 * turned into rows to preview, mark duplicates and import. Pure functions:
 * the server reads the upload, calls these, and never stores the file.
 */

import { normalizePhone } from './format'
import { formatPartialDate, isValidPartialDate, MONTH_NAMES } from './occasions'

/** The largest file accepted, and the most people one file may hold. */
export const MAX_IMPORT_BYTES = 1_000_000
export const MAX_IMPORT_ROWS = 500

export interface ImportRow {
  name: string
  /** E.164, or null when the file had none or it could not be read. */
  phone: string | null
  /** The number as the file wrote it, when it could not be read (shown as a warning). */
  unreadablePhone: string | null
  /** Lower case. Used only to spot duplicates; Tend does not keep email addresses. */
  email: string | null
  /** Stored form: "1986-11-14" or "--11-14". */
  birthday: string | null
  anniversary: string | null
}

export const MAX_NAME = 80

function cleanName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim()
}

function cleanEmail(value: string | undefined | null): string | null {
  const email = value?.trim().replace(/^mailto:/i, '').toLowerCase() ?? ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

function readPhone(raw: string | undefined | null): Pick<ImportRow, 'phone' | 'unreadablePhone'> {
  const text = raw?.trim().replace(/^tel:/i, '') ?? ''
  if (!text) return { phone: null, unreadablePhone: null }
  const phone = normalizePhone(text)
  return phone ? { phone, unreadablePhone: null } : { phone: null, unreadablePhone: text.slice(0, 40) }
}

/* Dates ------------------------------------------------------------------------ */

export type DateOrder = 'mdy' | 'dmy'

const MONTH_INDEX = new Map(MONTH_NAMES.flatMap((m, i) => [[m.toLowerCase(), i + 1] as const, [m.slice(0, 3).toLowerCase(), i + 1] as const]))

function partial(month: number, day: number, year: number | null): string | null {
  // Placeholder years mean "no year": Apple writes 1604, some Android apps 0000 or 1900.
  const y = year === null || year === 1604 || year === 0 || year === 1900 ? null : year
  return isValidPartialDate(month, day, y) ? formatPartialDate({ month, day, year: y }) : null
}

/**
 * A birthday or anniversary as files write it: "1986-11-14", "19861114",
 * "--11-14", "--1114", "1986-11-14T00:00:00Z", "11/14/1986" (or 14/11/1986
 * with `order` 'dmy'; unambiguous ones read either way), "14 November 1986",
 * "November 14, 1986", "Nov 14". Null when it cannot be read.
 */
export function parseLooseDate(value: string | undefined | null, order: DateOrder = 'mdy'): string | null {
  const text = value?.trim() ?? ''
  if (!text) return null
  let m = /^(\d{4})-?(\d{2})-?(\d{2})(?:T.*)?$/.exec(text)
  if (m) return partial(Number(m[2]), Number(m[3]), Number(m[1]))
  m = /^--(\d{2})-?(\d{2})$/.exec(text)
  if (m) return partial(Number(m[1]), Number(m[2]), null)
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(text)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    let year = m[3] === undefined ? null : Number(m[3])
    // Two-digit years: the most recent past century that makes sense for a birthday.
    if (year !== null && m[3]!.length === 2) year += year > (new Date().getFullYear() % 100) ? 1900 : 2000
    const dmy = a > 12 || (order === 'dmy' && b <= 12)
    return dmy ? partial(b, a, year) : partial(a, b, year)
  }
  m = /^(\d{1,2})\s+([A-Za-z]+)\.?(?:,?\s+(\d{4}))?$/.exec(text)
  if (m && MONTH_INDEX.has(m[2]!.toLowerCase())) return partial(MONTH_INDEX.get(m[2]!.toLowerCase())!, Number(m[1]), m[3] ? Number(m[3]) : null)
  m = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(text)
  if (m && MONTH_INDEX.has(m[1]!.toLowerCase())) return partial(MONTH_INDEX.get(m[1]!.toLowerCase())!, Number(m[2]), m[3] ? Number(m[3]) : null)
  return null
}

/* vCard ------------------------------------------------------------------------ */

interface VcardLine {
  group: string | null
  name: string
  params: Map<string, string[]>
  value: string
}

function decodeQuotedPrintable(value: string, charset = 'utf-8'): string {
  const bytes: number[] = []
  const text = value.replace(/=\r?\n/g, '')
  for (let i = 0; i < text.length; i++) {
    const hex = text[i] === '=' ? text.slice(i + 1, i + 3) : ''
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16))
      i += 2
    } else bytes.push(...new TextEncoder().encode(text[i]!))
  }
  try {
    return new TextDecoder(charset).decode(new Uint8Array(bytes))
  } catch {
    return new TextDecoder().decode(new Uint8Array(bytes))
  }
}

function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))
}

/** Splits on separators not escaped with a backslash. */
function splitUnescaped(value: string, separator: string): string[] {
  const parts: string[] = []
  let current = ''
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!
    if (c === '\\' && i + 1 < value.length) {
      current += c + value[i + 1]
      i++
    } else if (c === separator) {
      parts.push(current)
      current = ''
    } else current += c
  }
  parts.push(current)
  return parts
}

/** Physical lines to logical ones: folded lines (starting with a space or tab) and quoted-printable soft breaks are joined. */
function logicalLines(text: string): string[] {
  const lines: string[] = []
  for (const line of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const last = lines.length - 1
    if ((line.startsWith(' ') || line.startsWith('\t')) && last >= 0) lines[last] += line.slice(1)
    else if (last >= 0 && /ENCODING=QUOTED-PRINTABLE/i.test(lines[last]!.split(':')[0]!) && lines[last]!.endsWith('=')) lines[last] = lines[last]!.slice(0, -1) + line
    else lines.push(line)
  }
  return lines
}

function parseLine(line: string): VcardLine | null {
  // The value starts at the first colon outside a quoted parameter value.
  let colon = -1
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted
    else if (line[i] === ':' && !quoted) {
      colon = i
      break
    }
  }
  if (colon < 1) return null
  const [nameWithGroup, ...rawParams] = line.slice(0, colon).split(';')
  const dot = nameWithGroup!.lastIndexOf('.')
  const params = new Map<string, string[]>()
  for (const p of rawParams) {
    const eq = p.indexOf('=')
    // vCard 2.1 writes bare types: "TEL;CELL;PREF:...".
    const key = (eq < 0 ? 'TYPE' : p.slice(0, eq)).toUpperCase()
    const values = (eq < 0 ? p : p.slice(eq + 1)).replace(/"/g, '').split(',').map((v) => v.trim().toUpperCase())
    params.set(key, [...(params.get(key) ?? []), ...values])
  }
  let value = line.slice(colon + 1)
  if (params.get('ENCODING')?.includes('QUOTED-PRINTABLE')) value = decodeQuotedPrintable(value, params.get('CHARSET')?.[0]?.toLowerCase())
  return {
    group: dot > 0 ? nameWithGroup!.slice(0, dot).toLowerCase() : null,
    name: nameWithGroup!.slice(dot + 1).toUpperCase(),
    params,
    value,
  }
}

function vcardDate(line: VcardLine | undefined): string | null {
  if (!line) return null
  const value = unescapeText(line.value).trim()
  // iPhone: a birthday without a year is "1604-11-14" with X-APPLE-OMIT-YEAR=1604.
  if (line.params.has('X-APPLE-OMIT-YEAR')) {
    const m = /^\d{4}-?(\d{2})-?(\d{2})/.exec(value)
    return m ? partial(Number(m[1]), Number(m[2]), null) : null
  }
  return parseLooseDate(value)
}

function preferred(lines: VcardLine[], types: string[]): VcardLine | undefined {
  const typed = (l: VcardLine) => l.params.get('TYPE') ?? []
  return (
    lines.find((l) => typed(l).some((t) => types.includes(t)) && (typed(l).includes('PREF') || l.params.has('PREF'))) ??
    lines.find((l) => typed(l).some((t) => types.includes(t))) ??
    lines.find((l) => typed(l).includes('PREF') || l.params.has('PREF')) ??
    lines[0]
  )
}

function cardToRow(lines: VcardLine[]): ImportRow | null {
  const get = (name: string) => lines.filter((l) => l.name === name)
  const fn = get('FN')[0]
  const n = get('N')[0]
  let name = fn ? cleanName(unescapeText(fn.value)) : ''
  if (!name && n) {
    const [family = '', given = '', additional = '', prefix = '', suffix = ''] = splitUnescaped(n.value, ';').map(unescapeText)
    name = cleanName([prefix, given, additional, family, suffix].filter(Boolean).join(' '))
  }
  if (!name) name = cleanName(unescapeText(get('ORG')[0]?.value.split(';')[0] ?? ''))
  if (!name) return null
  const tel = preferred(get('TEL'), ['CELL', 'MOBILE', 'IPHONE'])
  const email = preferred(get('EMAIL'), [])
  // Anniversaries: vCard 4 ANNIVERSARY, X-ANNIVERSARY (Android and others),
  // or an iPhone "item1.X-ABDATE" whose "item1.X-ABLabel" is the Anniversary label.
  const anniversaryLabel = lines.find((l) => l.name === 'X-ABLABEL' && /anniversary/i.test(l.value))
  const anniversary =
    get('ANNIVERSARY')[0] ??
    get('X-ANNIVERSARY')[0] ??
    get('X-EVOLUTION-ANNIVERSARY')[0] ??
    (anniversaryLabel ? lines.find((l) => l.name === 'X-ABDATE' && l.group === anniversaryLabel.group) : undefined)
  return {
    name,
    ...readPhone(tel ? unescapeText(tel.value) : null),
    email: cleanEmail(email ? unescapeText(email.value) : null),
    birthday: vcardDate(get('BDAY')[0]),
    anniversary: vcardDate(anniversary),
  }
}

/** Every contact in a .vcf file (vCard 2.1, 3.0 and 4.0). Cards without any name are left out. */
export function parseVcards(text: string): ImportRow[] {
  const rows: ImportRow[] = []
  let card: VcardLine[] | null = null
  for (const raw of logicalLines(text)) {
    const line = raw.trim() ? parseLine(raw) : null
    if (!line) continue
    if (line.name === 'BEGIN' && line.value.trim().toUpperCase() === 'VCARD') card = []
    else if (line.name === 'END' && line.value.trim().toUpperCase() === 'VCARD') {
      const row = card ? cardToRow(card) : null
      if (row) rows.push(row)
      card = null
    } else card?.push(line)
  }
  return rows
}

export function looksLikeVcard(text: string): boolean {
  return /^\s*BEGIN:VCARD/im.test(text.slice(0, 2000))
}

/* CSV -------------------------------------------------------------------------- */

/** RFC 4180 CSV (quotes, doubled quotes, line breaks in quotes), with the delimiter guessed from the first line: comma, semicolon or tab. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '')
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
  const count = (c: string) => firstLine.split(c).length - 1
  const delimiter = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0]!
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

export const CSV_FIELDS = ['name', 'firstName', 'lastName', 'phone', 'email', 'birthday', 'anniversary'] as const
export type CsvField = (typeof CSV_FIELDS)[number]

export const CSV_FIELD_LABEL: Record<CsvField, string> = {
  name: 'Full name',
  firstName: 'First name',
  lastName: 'Last name',
  phone: 'Phone',
  email: 'Email',
  birthday: 'Birthday',
  anniversary: 'Anniversary',
}

/** Column index per field; -1 for none. */
export type CsvMapping = Record<CsvField, number> & { dateOrder: DateOrder }

const HEADER_PATTERNS: Record<CsvField, RegExp[]> = {
  name: [/^(full ?name|name|display ?name|contact ?name|contact)$/i],
  firstName: [/^(first ?name|given ?name|first|forename)$/i],
  lastName: [/^(last ?name|family ?name|surname|last)$/i],
  // Mobile first, then any phone value column (Google: "Phone 1 - Value").
  phone: [/^(mobile|cell)( ?phone| ?number)?$/i, /^(mobile|cell)/i, /^phone( number)?$/i, /^phone \d+ - value$/i, /phone|tel/i],
  email: [/^e-?mail( address)?$/i, /^e-?mail \d+ - value$/i, /^e-?mail(?!.*(type|label))/i],
  birthday: [/^(birthday|birth ?date|date of birth|dob)$/i, /birth/i],
  anniversary: [/anniversary/i],
}

/** A first guess at the mapping from the header row (Google, Outlook, iCloud and plain exports). */
export function guessMapping(headers: string[]): CsvMapping {
  const used = new Set<number>()
  const mapping = { dateOrder: 'mdy' } as CsvMapping
  for (const field of CSV_FIELDS) {
    mapping[field] = -1
    for (const pattern of HEADER_PATTERNS[field]) {
      const index = headers.findIndex((h, i) => !used.has(i) && pattern.test(h.trim()) && !/(label|type)$/i.test(h.trim()))
      if (index >= 0) {
        mapping[field] = index
        used.add(index)
        break
      }
    }
  }
  return mapping
}

/** Rows (without the header) to import rows, by the mapping. Rows with no name are left out. */
export function mapCsvRows(rows: string[][], mapping: CsvMapping): ImportRow[] {
  const cell = (row: string[], field: CsvField) => (mapping[field] >= 0 ? (row[mapping[field]] ?? '').trim() : '')
  const out: ImportRow[] = []
  for (const row of rows) {
    const name = cleanName(cell(row, 'name') || [cell(row, 'firstName'), cell(row, 'lastName')].filter(Boolean).join(' '))
    if (!name) continue
    out.push({
      name,
      ...readPhone(cell(row, 'phone').split(/\s*:::\s*/)[0]),
      email: cleanEmail(cell(row, 'email').split(/\s*:::\s*/)[0]),
      birthday: parseLooseDate(cell(row, 'birthday'), mapping.dateOrder),
      anniversary: parseLooseDate(cell(row, 'anniversary'), mapping.dateOrder),
    })
  }
  return out
}

/* Google People API ------------------------------------------------------------- */

interface GoogleDate {
  year?: number
  month?: number
  day?: number
}

/** The parts of a People API person that import reads (personFields=names,phoneNumbers,emailAddresses,birthdays,events). */
export interface GooglePerson {
  names?: { displayName?: string; metadata?: { primary?: boolean } }[]
  phoneNumbers?: { value?: string; canonicalForm?: string; type?: string; metadata?: { primary?: boolean } }[]
  emailAddresses?: { value?: string; metadata?: { primary?: boolean } }[]
  birthdays?: { date?: GoogleDate; text?: string; metadata?: { primary?: boolean } }[]
  events?: { date?: GoogleDate; type?: string }[]
}

function googleDate(date: GoogleDate | undefined): string | null {
  return date?.month && date.day ? partial(date.month, date.day, date.year ?? null) : null
}

function primaryFirst<T extends { metadata?: { primary?: boolean } }>(list: T[] | undefined): T[] {
  return [...(list ?? [])].sort((a, b) => Number(Boolean(b.metadata?.primary)) - Number(Boolean(a.metadata?.primary)))
}

/** People API connections to import rows: the primary name, a mobile number first, the primary email, birthday and anniversary. */
export function peopleToRows(people: GooglePerson[]): ImportRow[] {
  const rows: ImportRow[] = []
  for (const person of people) {
    const name = cleanName(primaryFirst(person.names)[0]?.displayName ?? '')
    if (!name) continue
    const phones = primaryFirst(person.phoneNumbers)
    const phone = phones.find((p) => p.type === 'mobile') ?? phones[0]
    const birthday = primaryFirst(person.birthdays).find((b) => b.date) ?? primaryFirst(person.birthdays)[0]
    rows.push({
      name,
      // canonicalForm is Google's E.164 version, when it could work one out.
      ...readPhone(phone?.canonicalForm || phone?.value),
      email: cleanEmail(primaryFirst(person.emailAddresses)[0]?.value),
      birthday: birthday?.date ? googleDate(birthday.date) : parseLooseDate(birthday?.text),
      anniversary: googleDate(person.events?.find((e) => e.type === 'anniversary')?.date),
    })
  }
  return rows
}

/* Duplicates --------------------------------------------------------------------- */

export type RowStatus = 'new' | 'existing' | 'repeat'

/**
 * Marks each row: 'existing' when its phone or email matches someone already
 * in People, 'repeat' when an earlier row in the same file has the same phone
 * or email, else 'new'. Rows with neither can only be 'new'.
 */
export function markDuplicates(rows: Pick<ImportRow, 'phone' | 'email'>[], existing: { phones: Set<string>; emails: Set<string> }): RowStatus[] {
  const seenPhones = new Set<string>()
  const seenEmails = new Set<string>()
  return rows.map((row) => {
    if ((row.phone && existing.phones.has(row.phone)) || (row.email && existing.emails.has(row.email))) return 'existing'
    const repeat = (row.phone && seenPhones.has(row.phone)) || (row.email && seenEmails.has(row.email))
    if (row.phone) seenPhones.add(row.phone)
    if (row.email) seenEmails.add(row.email)
    return repeat ? 'repeat' : 'new'
  })
}
