import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { guessMapping, mapCsvRows, markDuplicates, parseCsv, parseLooseDate, parseVcards, peopleToRows } from '@/lib/import'

const SAMPLE_VCF = readFileSync(join(__dirname, '..', 'e2e', 'fixtures', 'contacts.vcf'), 'utf8')

describe('parseLooseDate', () => {
  it('reads the formats contact files use', () => {
    expect(parseLooseDate('1986-11-14')).toBe('1986-11-14')
    expect(parseLooseDate('19861114')).toBe('1986-11-14')
    expect(parseLooseDate('1986-11-14T00:00:00Z')).toBe('1986-11-14')
    expect(parseLooseDate('--11-14')).toBe('--11-14')
    expect(parseLooseDate('--1114')).toBe('--11-14')
    expect(parseLooseDate('14 November 1986')).toBe('1986-11-14')
    expect(parseLooseDate('Nov 14')).toBe('--11-14')
    expect(parseLooseDate('November 14, 1986')).toBe('1986-11-14')
  })

  it('reads slashed dates month first, or day first when asked or when it can only be that', () => {
    expect(parseLooseDate('03/04/1990')).toBe('1990-03-04')
    expect(parseLooseDate('03/04/1990', 'dmy')).toBe('1990-04-03')
    expect(parseLooseDate('25/12/1990')).toBe('1990-12-25')
    expect(parseLooseDate('12/25/1990', 'dmy')).toBe('1990-12-25')
  })

  it('treats placeholder years as no year, and refuses nonsense', () => {
    expect(parseLooseDate('1604-03-21')).toBe('--03-21')
    expect(parseLooseDate('0/0/00')).toBeNull()
    expect(parseLooseDate('2023-02-29')).toBeNull()
    expect(parseLooseDate('soon')).toBeNull()
    expect(parseLooseDate('')).toBeNull()
  })
})

describe('parseVcards', () => {
  const rows = parseVcards(SAMPLE_VCF)

  it('reads every card with a name', () => {
    expect(rows.map((r) => r.name)).toEqual(['Grace Rivera', 'Daniel Okafor', 'Zsófia Novák', 'Sam Lee', 'Grace R.', 'Corner Bakery'])
  })

  it('reads an iPhone card: mobile number, birthday without a year, anniversary label', () => {
    expect(rows[0]).toEqual({
      name: 'Grace Rivera',
      phone: '+15552013344',
      unreadablePhone: null,
      email: 'grace.rivera@example.com',
      birthday: '--03-21',
      anniversary: '2012-06-09',
    })
  })

  it('prefers the mobile number', () => {
    expect(rows[1]!.phone).toBe('+447700900123')
    expect(rows[1]!.birthday).toBe('1988-09-02')
  })

  it('decodes Android quoted-printable names and vCard 2.1 types', () => {
    expect(rows[2]).toMatchObject({ name: 'Zsófia Novák', phone: '+36301234567', email: 'zsofia@example.com', birthday: '1992-01-15' })
  })

  it('reads vCard 4 tel: URIs and dates without a year', () => {
    expect(rows[3]).toMatchObject({ phone: '+15551234567', birthday: '--11-14' })
  })

  it('keeps a number it cannot read aside, to warn about', () => {
    expect(rows[5]).toMatchObject({ phone: null, unreadablePhone: '12345' })
  })

  it('unfolds long lines and unescapes text', () => {
    const folded = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Anne-Marie\r\n  de la Cruz\\, Jr.\r\nEND:VCARD\r\n'
    expect(parseVcards(folded)[0]!.name).toBe('Anne-Marie de la Cruz, Jr.')
  })

  it('builds a name from N when there is no FN', () => {
    expect(parseVcards('BEGIN:VCARD\nVERSION:3.0\nN:Park;Leo;;Dr.;\nEND:VCARD')[0]!.name).toBe('Dr. Leo Park')
  })

  it('joins quoted-printable soft line breaks', () => {
    const card = 'BEGIN:VCARD\nVERSION:2.1\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Bj=C3=B6rk Gu=\n=C3=B0mundsd=C3=B3ttir\nEND:VCARD'
    expect(parseVcards(card)[0]!.name).toBe('Björk Guðmundsdóttir')
  })
})

describe('CSV', () => {
  it('parses quotes, doubled quotes, line breaks and semicolons', () => {
    expect(parseCsv('\uFEFFName,Notes\r\n"Lee, Sam","Said ""hi""\nlater"\r\n')).toEqual([
      ['Name', 'Notes'],
      ['Lee, Sam', 'Said "hi"\nlater'],
    ])
    expect(parseCsv('Name;Phone\nAna;+44 7700 900123\n')).toEqual([
      ['Name', 'Phone'],
      ['Ana', '+44 7700 900123'],
    ])
  })

  it('guesses a Google Contacts export', () => {
    const headers = ['First Name', 'Middle Name', 'Last Name', 'Birthday', 'E-mail 1 - Label', 'E-mail 1 - Value', 'Phone 1 - Label', 'Phone 1 - Value']
    expect(guessMapping(headers)).toMatchObject({ name: -1, firstName: 0, lastName: 2, birthday: 3, email: 5, phone: 7 })
  })

  it('guesses an Outlook export, mobile before home', () => {
    const headers = ['First Name', 'Last Name', 'E-mail Address', 'Home Phone', 'Mobile Phone', 'Birthday']
    expect(guessMapping(headers)).toMatchObject({ firstName: 0, lastName: 1, email: 2, phone: 4, birthday: 5 })
  })

  it('maps rows, joining first and last names and taking the first of several values', () => {
    const [header, ...rows] = parseCsv(
      'First Name,Last Name,Phone 1 - Value,E-mail 1 - Value,Birthday\nAna,Diaz,+44 7700 900123 ::: +44 20 7946 0958,ANA@example.com, --07-04\n,,555,,\n',
    )
    const rows2 = mapCsvRows(rows, guessMapping(header!))
    expect(rows2).toEqual([
      { name: 'Ana Diaz', phone: '+447700900123', unreadablePhone: null, email: 'ana@example.com', birthday: '--07-04', anniversary: null },
    ])
  })
})

describe('peopleToRows (Google People API)', () => {
  it('takes the primary name, a mobile number in E.164, the primary email, birthday and anniversary', () => {
    const rows = peopleToRows([
      {
        names: [{ displayName: 'Old Name' }, { displayName: 'Priya Shah', metadata: { primary: true } }],
        phoneNumbers: [
          { value: '020 7946 0000', type: 'home' },
          { value: '07700 900456', canonicalForm: '+447700900456', type: 'mobile' },
        ],
        emailAddresses: [{ value: 'Priya@Example.com', metadata: { primary: true } }],
        birthdays: [{ text: 'May 9' }, { date: { month: 5, day: 9 }, metadata: { primary: true } }],
        events: [{ type: 'anniversary', date: { year: 2015, month: 8, day: 22 } }],
      },
      { emailAddresses: [{ value: 'no-name@example.com' }] },
      { names: [{ displayName: 'Text Birthday' }], birthdays: [{ text: '3 April 1990' }] },
    ])
    expect(rows).toEqual([
      { name: 'Priya Shah', phone: '+447700900456', unreadablePhone: null, email: 'priya@example.com', birthday: '--05-09', anniversary: '2015-08-22' },
      { name: 'Text Birthday', phone: null, unreadablePhone: null, email: null, birthday: '1990-04-03', anniversary: null },
    ])
  })
})

describe('markDuplicates', () => {
  it('matches people already in Tend by phone or email, and repeats within the file', () => {
    const rows = parseVcards(SAMPLE_VCF)
    const statuses = markDuplicates(rows, { phones: new Set(['+15551234567']), emails: new Set(['zsofia@example.com']) })
    expect(statuses).toEqual(['new', 'new', 'existing', 'existing', 'repeat', 'new'])
  })
})
