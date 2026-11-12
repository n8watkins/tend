import { expect, test, type Page } from '@playwright/test'

import { addPerson, signIn, testEmail } from './helpers'

test.use({ timezoneId: 'UTC' })

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

async function choose(page: Page, id: string, mode: RegExp) {
  await page.goto(`/people/${id}/edit`)
  await page.getByRole('radio', { name: mode }).check({ force: true })
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page).toHaveURL(new RegExp(`/people/${id}$`))
}

test('what to suggest: a default in Settings, per person, and starters never repeat', async ({ page }, info) => {
  await signIn(page, testEmail(info, 'suggest'))

  // The default in Settings: Quotes.
  await page.goto('/settings')
  await page.getByRole('radio', { name: /^Quotes/ }).check({ force: true })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page).toHaveURL(/done=saved/)
  await expect(page.getByRole('radio', { name: /^Quotes/ })).toBeChecked()

  const id = await addPerson(page, { name: 'Ana Silva', consent: 'yes', topics: ['Hope', 'Gratitude'] })
  const suggestions = page.getByRole('region', { name: 'Suggestions' })
  await expect(suggestions).toContainText('Suggesting quotes (your default)')
  await expect(suggestions.locator('[data-kind="quote"]').first()).toBeVisible()
  await expect(suggestions.locator('[data-kind="scripture"]')).toHaveCount(0)

  // Scripture for this person overrides the default.
  await choose(page, id, /^Scripture/)
  await expect(suggestions).toContainText('Suggesting scripture,')
  await expect(suggestions.locator('[data-kind="scripture"]').first()).toBeVisible()
  await expect(suggestions.locator('[data-kind="quote"]')).toHaveCount(0)

  // Just my words: no passages or quotes, five starters.
  await choose(page, id, /^Just my words/)
  await expect(page.getByRole('region', { name: 'Suggestions' })).toHaveCount(0)
  const starters = page.getByRole('region', { name: 'Start in your own words' })
  await expect(starters.getByRole('link', { name: 'Start with this' })).toHaveCount(5)

  // Use the first starter: compose starts with it, and once scheduled it is not suggested again.
  const firstText = (await starters.getByRole('listitem').first().locator('p').innerText()).trim()
  await starters.getByRole('link', { name: 'Start with this' }).first().click()
  await expect(page.getByLabel('Your message')).toHaveValue(firstText)
  await page.getByLabel(/Now, I.ll send it straight away/).check()
  await page.getByRole('button', { name: 'Continue to send' }).click()
  await expect(page).toHaveURL(/\/send\//)
  await page.goto(`/people/${id}`)
  await expect(page.getByRole('region', { name: 'Start in your own words' })).not.toContainText(firstText)
})

test('a birthday follows what to suggest: quotes, or starters with the greeting', async ({ page }, info) => {
  await signIn(page, testEmail(info, 'suggest-birthday'))
  const id = await addPerson(page, { name: 'Maya Ortiz', consent: 'yes', topics: ['Joy'] })
  const today = new Date()
  await page.goto(`/people/${id}/edit`)
  await page.getByLabel('Birthday month').selectOption(MONTHS[today.getUTCMonth()]!)
  await page.getByLabel('Birthday day', { exact: true }).selectOption(String(today.getUTCDate()))
  await page.getByRole('radio', { name: /^Quotes/ }).check({ force: true })
  await page.getByRole('button', { name: 'Save changes' }).click()

  const panel = page.getByRole('region', { name: 'For their birthday today' })
  await expect(panel.locator('[data-kind="quote"]').first()).toBeVisible()
  await expect(panel.locator('[data-kind="scripture"]')).toHaveCount(0)

  await choose(page, id, /^Just my words/)
  await expect(panel.locator('.pick')).toHaveCount(0)
  await expect(panel.getByRole('link', { name: 'Start with this' })).toHaveCount(3)
  const text = (await panel.getByRole('listitem').first().locator('p').innerText()).trim()
  await panel.getByRole('link', { name: 'Start with this' }).first().click()
  const note = page.getByLabel('Your message')
  await expect(note).toHaveValue(/birthday/i)
  await expect(note).toHaveValue(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})
