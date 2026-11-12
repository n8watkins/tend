import { expect, test } from '@playwright/test'

import { addPerson, emails, runCron, signIn, testEmail } from './helpers'

test.use({ timezoneId: 'UTC' })

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

test('a birthday today shows on Today, suggests a blessing, and is reminded once', async ({ page }, info) => {
  const address = testEmail(info, 'birthday')
  await signIn(page, address)
  // addPerson puts them in UTC with an all-day window, so "today" is the UTC date.
  const id = await addPerson(page, { name: 'Maya Ortiz', consent: 'yes', topics: ['Joy'] })

  const today = new Date()
  await page.getByRole('link', { name: 'Edit' }).click()
  await page.getByLabel('Birthday month').selectOption(MONTHS[today.getUTCMonth()]!)
  await page.getByLabel('Birthday day', { exact: true }).selectOption(String(today.getUTCDate()))
  await page.getByLabel('Birthday year (optional)').fill(String(today.getUTCFullYear() - 30))
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Maya Ortiz' })).toBeVisible()

  // The person page: the date, and picks for the day.
  await expect(page.getByText(/· today, turns 30/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'For their birthday today' })).toBeVisible()

  // Today lists it.
  await page.goto('/today')
  const row = page.getByRole('region', { name: 'Birthdays and anniversaries' }).getByRole('link', { name: /Maya Ortiz/ })
  await expect(row).toContainText('Birthday today (turns 30)')

  // The reminder run emails it once, however often it runs.
  await runCron(page)
  await runCron(page)
  const reminders = (await emails(address)).filter((m) => m.subject.includes('birthday'))
  expect(reminders).toHaveLength(1)
  expect(reminders[0]!.subject).toBe("It's Maya Ortiz's birthday today")
  expect(reminders[0]!.text).toContain(`/people/${id}?occasion=birthday#occasion`)

  // Following it: a blessing, with the greeting already written.
  await page.goto(`/people/${id}?occasion=birthday#occasion`)
  await page.getByRole('region', { name: 'For their birthday today' }).getByRole('link', { name: 'Use this' }).first().click()
  await expect(page.getByLabel('A note from you (optional)')).toHaveValue('Happy birthday, Maya!')
  await expect(page.getByTestId('preview')).toContainText('Happy birthday, Maya!')
  await expect(page.getByTestId('preview')).toContainText('Numbers 6:24-26')
})

test('a keep-in-touch cadence becomes due, lists on Today, and resets when you are in touch', async ({ page }, info) => {
  const address = testEmail(info, 'cadence')
  await signIn(page, address)
  const id = await addPerson(page, { name: 'Leo Park', consent: 'yes', topics: ['Friendship'] })

  // Every week, last in touch ten days ago: due now.
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await page.getByRole('link', { name: 'Edit' }).click()
  await page.getByLabel('Keep in touch').selectOption('Every week')
  await page.getByLabel(/Last in touch outside Tend/).fill(tenDaysAgo)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByTestId('next-due')).toContainText('Due now')

  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Due to reach out' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Due to reach out' }).getByRole('link', { name: /Leo Park/ })).toContainText('Every week.')
  // Listed there, not again under "Could use a message".
  await expect(page.getByRole('link', { name: /Leo Park/ })).toHaveCount(1)

  await runCron(page)
  await runCron(page)
  const reminders = (await emails(address)).filter((m) => m.subject.includes('reach out'))
  expect(reminders).toHaveLength(1)
  expect(reminders[0]!.subject).toBe('Time to reach out to Leo Park')

  // A call counts: the next date moves a week out and Today no longer lists them.
  await page.goto(`/people/${id}`)
  await page.getByRole('button', { name: 'We were in touch today' }).click()
  await expect(page.getByText('Noted. Tend counts from today for keeping in touch.')).toBeVisible()
  await expect(page.getByTestId('next-due')).toContainText('Next due')
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Due to reach out' })).toHaveCount(0)
})

test('dates and cadence are not reminded before the person says yes', async ({ page }, info) => {
  const address = testEmail(info, 'not-yet')
  await signIn(page, address)
  await addPerson(page, { name: 'Ida Moss' })
  const today = new Date()
  await page.getByRole('link', { name: 'Edit' }).click()
  await page.getByLabel('Birthday month').selectOption(MONTHS[today.getUTCMonth()]!)
  await page.getByLabel('Birthday day', { exact: true }).selectOption(String(today.getUTCDate()))
  await page.getByLabel('Keep in touch').selectOption('Every week')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Keep-in-touch reminders start once Ida Moss says yes to messages.')).toBeVisible()

  await page.goto('/today')
  await expect(page.getByRole('link', { name: /Ida Moss/ })).toContainText('Not said yes to messages yet')
  await runCron(page)
  expect((await emails(address)).filter((m) => m.subject.includes('Ida'))).toHaveLength(0)
})

test('an impossible date is refused with a clear reason', async ({ page }, info) => {
  await signIn(page, testEmail(info, 'bad-date'))
  await addPerson(page, { name: 'Noor' })
  await page.getByRole('link', { name: 'Edit' }).click()
  await page.getByLabel('Birthday month').selectOption('February')
  await page.getByLabel('Birthday day', { exact: true }).selectOption('30')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('That birthday is not a real date.')).toBeVisible()
})
