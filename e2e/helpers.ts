import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

const EMAIL_DIR = join(process.cwd(), '.e2e', 'email')

export function mailFile(address: string) {
  return join(EMAIL_DIR, `${address.toLowerCase().replace(/[^a-z0-9@._-]/g, '_')}.jsonl`)
}

export async function emails(address: string): Promise<{ subject: string; text: string }[]> {
  try {
    const raw = await readFile(mailFile(address), 'utf8')
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

/** A unique address per test and project, so runs never share an inbox. */
export function testEmail(info: TestInfo, label: string) {
  return `${label}-${info.project.name}-${Date.now()}@example.test`
}

/** The real email sign-in: request a link, read it from the test inbox, open it. */
export async function signIn(page: Page, address: string) {
  await page.goto('/signin')
  await page.getByLabel('Email').fill(address)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  let link: string | undefined
  await expect
    .poll(async () => {
      const mail = (await emails(address)).at(-1)
      link = mail?.text.match(/https?:\/\/\S+/)?.[0]
      return link
    })
    .toBeTruthy()
  await page.goto(link!)
  await expect(page).toHaveURL(/\/today$/)
}

export async function addPerson(
  page: Page,
  opts: { name: string; phone?: string; consent?: 'not_asked' | 'asked' | 'yes'; topics?: string[] },
) {
  await page.goto('/people/new')
  await page.getByLabel('Name').fill(opts.name)
  if (opts.phone) await page.getByLabel(/Phone number/).fill(opts.phone)
  if (opts.consent) await page.getByLabel('Have you asked them about messages?').selectOption(opts.consent)
  for (const topic of opts.topics ?? []) await page.getByText(topic, { exact: true }).click()
  // All day, every day, so "Now" is always inside the window.
  await page.getByLabel('Not before').fill('00:00')
  await page.getByLabel('Not after').fill('23:59')
  await page.getByLabel('Their time zone').selectOption('UTC')
  await page.getByRole('button', { name: 'Add person' }).click()
  await expect(page.getByRole('heading', { level: 1, name: opts.name })).toBeVisible()
  return page.url().split('/').pop()!
}

export async function runCron(page: Page) {
  const response = await page.request.post('/api/cron/reminders', { headers: { authorization: 'Bearer e2e-cron-secret' } })
  expect(response.ok()).toBe(true)
  return response.json()
}
