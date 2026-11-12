import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { signIn, testEmail } from './helpers'

test.use({ timezoneId: 'UTC' })

const SAMPLE_VCF = join(process.cwd(), 'e2e', 'fixtures', 'contacts.vcf')

test('import a phone contacts .vcf: preview, duplicates, choose, import with birthdays', async ({ page }, info) => {
  await signIn(page, testEmail(info, 'import-vcf'))
  await page.goto('/people')
  await page.getByRole('link', { name: 'Import', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Import people' })).toBeVisible()

  await page.getByLabel('Contacts file').setInputFiles(SAMPLE_VCF)
  await page.getByRole('button', { name: 'Read the file' }).click()
  await expect(page.getByText('Found 6 people in the file.')).toBeVisible()

  // New people are chosen; the repeat of Grace (same email) is not.
  const grace = page.getByRole('checkbox', { name: /^Grace Rivera/ })
  await expect(grace).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /^Grace R\. / })).not.toBeChecked()
  await expect(page.getByText('Twice in this file')).toBeVisible()
  await expect(page.getByText('Birthday 21 March · Anniversary 9 June 2012')).toBeVisible()
  await expect(page.getByText('Number 12345 left out: it needs a country code.', { exact: false })).toBeVisible()

  // Leave the bakery out.
  await page.getByRole('checkbox', { name: /^Corner Bakery/ }).uncheck()
  await page.getByRole('button', { name: 'Import 4 people' }).click()
  await expect(page.getByText('Imported 4 people.')).toBeVisible()
  await expect(page.getByRole('link', { name: /Zsófia Novák/ })).toBeVisible()

  // Imported at "Not asked yet", with the birthday and anniversary from the card.
  await page.getByRole('link', { name: /Grace Rivera/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Grace Rivera' })).toBeVisible()
  await expect(page.getByText('Not asked yet', { exact: true })).toBeVisible()
  await expect(page.getByText(/^21 March/)).toBeVisible()
  await expect(page.getByText(/^9 June/)).toBeVisible()

  // The same file again: everyone imported is recognised by phone or email.
  await page.goto('/people/import')
  await page.getByLabel('Contacts file').setInputFiles(SAMPLE_VCF)
  await page.getByRole('button', { name: 'Read the file' }).click()
  await expect(page.getByText('Found 6 people in the file. 5 already in People.')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /^Corner Bakery/ })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /^Sam Lee/ })).not.toBeChecked()
})

test('import a CSV with column mapping and day-first dates', async ({ page }, info) => {
  await signIn(page, testEmail(info, 'import-csv'))
  await page.goto('/people/import')
  const csv = 'Given Name;Family Name;Mobile Phone;E-mail Address;Birthday\nAna;Diaz;+44 7700 900111;ana@example.com;04/03/1990\nBen;Ito;;;\n'
  await page.getByLabel('Contacts file').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await page.getByRole('button', { name: 'Read the file' }).click()

  await expect(page.getByLabel('First name')).toHaveValue('0')
  await expect(page.getByLabel('Last name')).toHaveValue('1')
  await expect(page.getByLabel('Phone')).toHaveValue('2')
  await expect(page.getByLabel('Birthday')).toHaveValue('4')
  await page.getByLabel('Dates like 03/04/1990 mean').selectOption('dmy')
  await page.getByRole('button', { name: 'Preview' }).click()

  await expect(page.getByText('Found 2 people in the spreadsheet.')).toBeVisible()
  await expect(page.getByText('+447700900111 · Birthday 4 March 1990')).toBeVisible()
  await page.getByRole('button', { name: 'Import 2 people' }).click()
  await expect(page.getByText('Imported 2 people.')).toBeVisible()
  await expect(page.getByRole('link', { name: /Ben Ito/ })).toBeVisible()
})

test('a file that is not contacts is refused with a reason', async ({ page }, info) => {
  await signIn(page, testEmail(info, 'import-bad'))
  await page.goto('/people/import')
  await page.getByLabel('Contacts file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('not really') })
  await page.getByRole('button', { name: 'Read the file' }).click()
  await expect(page.getByText('Tend reads .vcf (contacts) and .csv files.')).toBeVisible()
})

test('Google Contacts: consent, review, import, and the token is revoked', async ({ page }, info) => {
  await signIn(page, testEmail(info, 'import-google'))
  await page.goto('/people/import')
  await page.getByRole('link', { name: 'Import from Google' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Import from Google' })).toBeVisible()
  await expect(page.getByText('Found 2 people in Google Contacts.')).toBeVisible()
  await expect(page.getByText('+447700900456 · Birthday 9 May')).toBeVisible()
  await page.getByRole('button', { name: 'Import 2 people' }).click()
  await expect(page.getByText('Imported 2 people.')).toBeVisible()
  await expect(page.getByRole('link', { name: /Priya Shah/ })).toBeVisible()

  const calls = (await readFile(join(process.cwd(), '.e2e', 'google.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
  expect(calls.some((c) => c.path === '/google/people' && c.authorization === 'Bearer mock-access-token')).toBe(true)
  expect(calls.some((c) => c.path === '/google/revoke')).toBe(true)
})

test('opening the Google return page without a matching state is refused', async ({ page }, info) => {
  await signIn(page, testEmail(info, 'import-state'))
  await page.goto('/people/import/google?code=stolen&state=guess')
  await expect(page).toHaveURL(/\/people\/import\?google=state$/)
  await expect(page.getByText('That Google sign-in had expired. Start it again.')).toBeVisible()
})
