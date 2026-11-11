import { expect, test } from '@playwright/test'

import { addPerson, emails, runCron, signIn, telegramCalls, telegramUpdate, testEmail } from './helpers'

test.use({ timezoneId: 'UTC', permissions: ['clipboard-read', 'clipboard-write'] })

test('ask first, record yes, choose a suggestion and schedule it', async ({ page }, info) => {
  await signIn(page, testEmail(info, 'flow'))
  await expect(page.getByRole('heading', { name: 'Welcome to Tend' })).toBeVisible()

  await addPerson(page, { name: 'Sam Lee', phone: '+1 555 123 4567', topics: ['Courage', 'Hope'] })
  await expect(page.getByText('Not asked yet', { exact: true })).toBeVisible()

  // Ask first: the drafted consent request, sent "now".
  await page.getByRole('link', { name: 'Draft the question' }).click()
  await expect(page.getByTestId('preview')).toContainText('Hi Sam,')
  await expect(page.getByTestId('preview')).toContainText('/stop/')
  await page.getByLabel(/Now, I.ll send it straight away/).check()
  await page.getByRole('button', { name: 'Continue to send' }).click()

  // The send screen: exact text, copy, chat link, mark sent.
  await expect(page.getByTestId('message-body')).toContainText('Hi Sam,')
  await expect(page.getByRole('link', { name: /Open chat with Sam in Signal/ })).toHaveAttribute('href', 'https://signal.me/#p/+15551234567')
  await page.getByRole('button', { name: 'Copy message' }).click()
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Hi Sam,')
  await page.getByRole('button', { name: 'I sent it' }).click()
  await expect(page.getByText('Marked as sent.')).toBeVisible()
  await expect(page.getByText('Asked, waiting', { exact: true })).toBeVisible()

  // They said yes: suggestions appear, fitted to their topics.
  await page.getByRole('button', { name: 'They said yes' }).click()
  await expect(page.getByText('Said yes', { exact: true })).toBeVisible()
  const suggestions = page.locator('#suggestions ~ ul li, section:has(#suggestions) li')
  await expect(suggestions.first()).toBeVisible()
  await suggestions.first().getByRole('link', { name: 'Use this' }).click()

  await page.getByLabel('A note from you (optional)').fill('Thinking of you this week.')
  await expect(page.getByTestId('preview')).toContainText('Thinking of you this week.')
  await expect(page.getByTestId('preview')).toContainText('- ')
  await page.getByRole('button', { name: 'Schedule reminder' }).click()
  await expect(page.getByText('Scheduled. Tend will remind you when it is time.')).toBeVisible()
  await expect(page.locator('section:has(#scheduled) li')).toHaveCount(1)

  // The spacing rule refuses a second message straight away.
  await page.getByRole('link', { name: 'Write your own message' }).click()
  await page.getByLabel('Your message').fill('Hello again!')
  await expect(page.getByLabel(/Now, I.ll send it straight away/)).toBeDisabled()
  await expect(page.getByText('That is too soon after another message to them.')).toBeVisible()
})

test('Surprise me opens a random passage for that person, and can pick again', async ({ page }, info) => {
  await signIn(page, testEmail(info, 'surprise'))
  await addPerson(page, { name: 'Ada', consent: 'yes', topics: ['Joy'] })
  await expect(page.getByText('Picked for what Ada cares about: joy.')).toBeVisible()

  await page.getByRole('button', { name: 'Surprise me' }).click()
  await expect(page).toHaveURL(/\/compose\?contact=[^&]+&content=[^&]+&surprise=1$/)
  await expect(page.getByText('A surprise pick for Ada.')).toBeVisible()
  const first = new URL(page.url()).searchParams.get('content')

  await page.getByRole('button', { name: 'Surprise me again' }).click()
  await expect(page).not.toHaveURL(new RegExp(`content=${first}&`))
  await expect(page).toHaveURL(/surprise=1$/)
  await expect(page.getByTestId('preview')).not.toBeEmpty()
})

test('each person can have their own Bible translation', async ({ page }, info) => {
  await signIn(page, testEmail(info, 'translation'))
  const id = await addPerson(page, { name: 'Ruth', consent: 'yes', topics: ['Comfort'] })

  // The sender's default (WEB) applies until Ruth gets her own.
  await page.goto(`/compose?contact=${id}&content=psalm-23-1-4`)
  await expect(page.getByTestId('preview')).toContainText('Psalm 23:1-4 (WEB)')

  await page.goto(`/people/${id}/edit`)
  await expect(page.getByLabel('Bible translation for them')).toHaveValue('')
  await page.getByLabel('Bible translation for them').selectOption('bsb')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Ruth' })).toBeVisible()

  await page.goto(`/compose?contact=${id}&content=psalm-23-1-4`)
  await expect(page.getByLabel('Translation')).toHaveValue('bsb')
  await expect(page.getByTestId('preview')).toContainText('Psalm 23:1-4 (BSB)')
  await page.getByLabel('Translation').selectOption('dra')
  await expect(page.getByTestId('preview')).toContainText('Psalm 22:1-4 (DRA)')
})

test('a due message shows on Today and is emailed once by the reminder run', async ({ page }, info) => {
  const address = testEmail(info, 'remind')
  await signIn(page, address)
  await addPerson(page, { name: 'Ana', consent: 'yes', topics: ['Friendship'] })
  await page.getByRole('link', { name: 'Write your own message' }).click()
  await page.getByLabel('Your message').fill('Coffee soon?')
  await page.getByLabel(/Now, I.ll send it straight away/).check()
  await page.getByRole('button', { name: 'Continue to send' }).click()
  await expect(page.getByTestId('message-body')).toContainText('Coffee soon?')

  await page.goto('/today')
  await expect(page.getByRole('link', { name: /Message Ana/ })).toBeVisible()

  await runCron(page)
  await runCron(page)
  const reminders = (await emails(address)).filter((m) => m.subject.startsWith('Time to send'))
  expect(reminders).toHaveLength(1)
  expect(reminders[0]!.subject).toBe('Time to send a message to Ana')
  expect(reminders[0]!.text).toContain('/send/')
})

test('Telegram: connect with a one-time link, get the reminder with buttons, mark it sent, then /stop', async ({ page }, info) => {
  const chat = { id: Date.now() + (info.project.name === 'phone' ? 1 : 2), type: 'private' }
  const toChat = async () => (await telegramCalls()).filter((c) => c.method === 'sendMessage' && c.body.chat_id === String(chat.id))
  await signIn(page, testEmail(info, 'telegram'))

  // Settings opens the bot with a one-time code (t.me is stubbed).
  let start: URL | undefined
  await page.route('https://t.me/**', (route) => {
    start = new URL(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Telegram (stubbed)' })
  })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Connect Telegram' }).click()
  await expect(page.getByText('Telegram (stubbed)')).toBeVisible()
  expect(start?.pathname).toBe('/tend_test_bot')
  const code = start!.searchParams.get('start')!
  expect(code).toMatch(/^[A-Za-z0-9_-]{20,64}$/)

  // A wrong secret is refused; the right one links the chat, once.
  expect((await telegramUpdate(page, { message: { chat, text: `/start ${code}` } }, 'wrong-secret')).status()).toBe(401)
  expect((await telegramUpdate(page, { message: { chat, text: `/start ${code}` } })).ok()).toBe(true)
  await expect.poll(async () => (await toChat()).at(-1)?.body.text).toContain('Connected to Tend')
  await telegramUpdate(page, { message: { chat: { ...chat, id: chat.id + 10 }, text: `/start ${code}` } })
  await page.goto('/settings')
  await expect(page.getByText('Connected. Due reminders come to Telegram')).toBeVisible()

  // A due message: the reminder carries the message and its buttons.
  await addPerson(page, { name: 'Bea', consent: 'yes', topics: ['Hope'] })
  await page.getByRole('link', { name: 'Write your own message' }).click()
  await page.getByLabel('Your message').fill('Thinking of you today, Bea.')
  await page.getByLabel(/Now, I.ll send it straight away/).check()
  await page.getByRole('button', { name: 'Continue to send' }).click()
  await expect(page).toHaveURL(/\/send\/[\w-]+$/)
  const messageId = page.url().split('/').pop()!
  // The send screen offers WhatsApp, a text message and Telegram too.
  await page.getByText('Not on Signal? Send it another way').click()
  await expect(page.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=Thinking/)
  await expect(page.getByRole('link', { name: 'Text message' })).toHaveAttribute('href', /^sms:\?&body=Thinking/)
  await expect(page.getByRole('link', { name: 'Telegram' })).toHaveAttribute('href', /^https:\/\/t\.me\/share\/url\?url=Thinking/)

  await runCron(page)
  const reminder = (await toChat()).find((c) => String(c.body.text).startsWith('Time to message Bea.'))!
  expect(reminder.body.text).toContain('Thinking of you today, Bea.')
  const keyboard = (reminder.body.reply_markup as { inline_keyboard: { text: string; url?: string; callback_data?: string }[][] }).inline_keyboard
  expect(keyboard.flat().map((b) => b.text)).toEqual(['Share', 'Open in Tend', 'I sent it', 'Snooze a day'])
  expect(keyboard[0]![0]!.url).toMatch(/^https:\/\/t\.me\/share\/url\?url=Thinking/)
  expect(keyboard[1]![0]!.callback_data).toBe(`sent:${messageId}`)

  // "I sent it" in Telegram records the send in Tend.
  const press = { callback_query: { id: 'cb1', data: `sent:${messageId}`, message: { message_id: 101, chat, text: reminder.body.text } } }
  expect((await telegramUpdate(page, press)).ok()).toBe(true)
  const calls = await telegramCalls()
  expect(calls.find((c) => c.method === 'answerCallbackQuery' && c.body.callback_query_id === 'cb1')?.body.text).toBe('Marked as sent to Bea.')
  await page.goto(`/send/${messageId}`)
  await expect(page.getByRole('button', { name: 'I sent it' })).toHaveCount(0)

  // /stop disconnects.
  await telegramUpdate(page, { message: { chat, text: '/stop' } })
  await expect.poll(async () => (await toChat()).at(-1)?.body.text).toContain('Disconnected')
  await page.goto('/settings')
  await expect(page.getByRole('button', { name: 'Connect Telegram' })).toBeVisible()
})

test('the recipient stop link stops and cancels everything', async ({ page, browser }, info) => {
  await signIn(page, testEmail(info, 'stop'))
  const id = await addPerson(page, { name: 'Jo', consent: 'yes', topics: ['Peace'] })
  await page.getByRole('link', { name: 'Write your own message' }).click()
  await page.getByLabel('Your message').fill('Hi Jo')
  await page.getByRole('button', { name: 'Schedule reminder' }).click()
  await expect(page.locator('section:has(#scheduled) li')).toHaveCount(1)
  await page.locator('section:has(#scheduled) li a').click()
  const stopUrl = (await page.getByTestId('message-body').innerText()).match(/https?:\/\/\S+\/stop\/[\w-]+/)![0]

  // The recipient, in a separate browser with no account.
  const recipient = await browser.newContext()
  const theirs = await recipient.newPage()
  await theirs.goto(stopUrl)
  await expect(theirs.getByRole('heading', { name: 'Stop these messages?' })).toBeVisible()
  await theirs.getByRole('button', { name: 'Stop these messages' }).click()
  await expect(theirs.getByRole('heading', { name: 'Done' })).toBeVisible()
  await recipient.close()

  await page.goto(`/people/${id}`)
  await expect(page.getByText('Stopped by them', { exact: true })).toBeVisible()
  await expect(page.getByText('Nothing scheduled.')).toBeVisible()
  await expect(page.getByText('They used their stop link')).toBeVisible()
})

test('people are private to their owner', async ({ page, browser }, info) => {
  await signIn(page, testEmail(info, 'owner'))
  const id = await addPerson(page, { name: 'Private Person' })
  const other = await browser.newContext()
  const otherPage = await other.newPage()
  await signIn(otherPage, testEmail(info, 'other'))
  const response = await otherPage.goto(`/people/${id}`)
  expect(response?.status()).toBe(404)
  await otherPage.goto('/people')
  await expect(otherPage.getByText('Private Person')).toHaveCount(0)
  await other.close()
})

test('pause, export and delete the account', async ({ page }, info) => {
  await signIn(page, testEmail(info, 'settings'))
  await addPerson(page, { name: 'Lee', phone: '+44 7700 900123' })

  await page.goto('/settings')
  await page.getByRole('button', { name: 'Pause Tend' }).click()
  await expect(page.getByText('Tend is paused.', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Resume Tend' }).click()
  await expect(page.getByRole('button', { name: 'Pause Tend' })).toBeVisible()

  const exported = await (await page.request.get('/api/export')).json()
  expect(exported.contacts[0].name).toBe('Lee')
  expect(exported.contacts[0].phone).toBe('+447700900123')
  expect(exported.contacts[0].stopToken).toBeUndefined()

  await page.getByLabel('Type DELETE to delete your account and everything in it').fill('DELETE')
  await page.getByRole('button', { name: 'Delete my account' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /Stay close to the people you love/ })).toBeVisible()
  await page.goto('/today')
  await expect(page).toHaveURL(/\/signin$/)
})

test('signed-out visitors are sent to sign in, and direct email sign-in posts are refused', async ({ page }) => {
  await page.goto('/people')
  await expect(page).toHaveURL(/\/signin$/)
  const response = await page.request.post('/api/auth/signin/email', { form: { email: 'x@example.test' } })
  expect(response.status()).toBe(403)
})

test('every Sign in on the home page opens the sign-in dialog, and it signs you in', async ({ page }, info) => {
  const address = testEmail(info, 'dialog')
  await page.goto('/')
  await page.getByRole('banner').getByRole('link', { name: 'Sign in' }).click()
  const dialog = page.getByRole('dialog', { name: 'Welcome to Tend' })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  await expect(dialog.getByLabel('Email')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await page.getByRole('link', { name: 'Get started, free' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Email').fill(address)
  await dialog.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page).toHaveURL(/\/signin\/check-email$/)
  await expect.poll(async () => (await emails(address)).length).toBe(1)
})

test('the sign-in page still works on its own, for links and without the dialog', async ({ page }) => {
  await page.goto('/signin')
  await expect(page.getByRole('heading', { name: 'Sign in to Tend' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('with GitHub configured, the dialog offers it and starts GitHub sign-in with the right callback', async ({ page }) => {
  let authorize: URL | undefined
  await page.route('https://github.com/**', (route) => {
    authorize = new URL(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'GitHub (stubbed)' })
  })
  await page.goto('/')
  await page.getByRole('banner').getByRole('link', { name: 'Sign in' }).click()
  const dialog = page.getByRole('dialog', { name: 'Welcome to Tend' })
  await dialog.getByRole('button', { name: 'Continue with GitHub' }).click()
  await expect(page.getByText('GitHub (stubbed)')).toBeVisible()
  expect(authorize?.pathname).toBe('/login/oauth/authorize')
  expect(authorize?.searchParams.get('client_id')).toBe('e2e-github-client-id')
  expect(authorize?.searchParams.get('scope')).toBe('read:user user:email')
  expect(authorize?.searchParams.get('redirect_uri')).toMatch(/\/api\/auth\/callback\/github$/)
})

