import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { subscriptionJson, type ReceiverKeys } from '../tests/webpush-receiver'

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
  await expect(page).toHaveURL(/\/signin\/check-email$/)
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

/** Runs the reminder run; `now` (test mode only) runs it as if at that time. */
export async function runCron(page: Page, now?: number) {
  const response = await page.request.post(`/api/cron/reminders${now ? `?now=${now}` : ''}`, { headers: { authorization: 'Bearer e2e-cron-secret' } })
  expect(response.ok()).toBe(true)
  return response.json()
}

/* Phone notifications (Web Push) -------------------------------------------- */

const PUSH_LOG = join(process.cwd(), '.e2e', 'push.jsonl')
// PUSH_TEST_BASE in playwright.config.ts: the push service part of e2e/telegram-mock.mjs.
export const PUSH_BASE = `http://localhost:${Number(process.env.E2E_TELEGRAM_PORT || 7843)}/push`

/** What the push mock received for one device. */
export async function pushes(id: string): Promise<{ id: string; headers: Record<string, string>; body: string }[]> {
  try {
    return (await readFile(PUSH_LOG, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((p) => p.id === id)
  } catch {
    return []
  }
}

/** Waits until the service worker is active and controls the page. */
export async function controlled(page: Page) {
  await page.goto('/')
  const scriptURL = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL)
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  return scriptURL!
}

/**
 * Headless Chromium has no push service, so the browser's subscribe() is
 * replaced by one that returns a subscription at the local push mock with
 * keys the test holds. Everything else (permission, Settings, the server
 * action, the reminder run, encryption) is the real thing.
 */
export async function fakePushService(page: Page, endpoint: string, keys: ReceiverKeys) {
  await page.context().grantPermissions(['notifications'])
  await page.addInitScript((json) => {
    // Kept across page loads, as the browser keeps a real subscription.
    const KEY = 'e2e:push-subscribed'
    const subscription = {
      endpoint: json.endpoint,
      expirationTime: null,
      toJSON: () => json,
      unsubscribe: async () => (localStorage.removeItem(KEY), true),
    } as unknown as PushSubscription
    PushManager.prototype.subscribe = async function () {
      localStorage.setItem(KEY, '1')
      return subscription
    }
    PushManager.prototype.getSubscription = async function () {
      return localStorage.getItem(KEY) ? subscription : null
    }
  }, subscriptionJson(endpoint, keys))
}

const TELEGRAM_LOG = join(process.cwd(), '.e2e', 'telegram.jsonl')

/** Calls the app made to the mocked Telegram Bot API (e2e/telegram-mock.mjs). */
export async function telegramCalls(): Promise<{ method: string; body: Record<string, unknown> }[]> {
  try {
    return (await readFile(TELEGRAM_LOG, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

/** Delivers an update to the app's webhook, as Telegram would. */
export async function telegramUpdate(page: Page, update: unknown, secret = 'e2e-telegram-webhook-secret') {
  return page.request.post('/api/telegram', { data: update, headers: { 'x-telegram-bot-api-secret-token': secret } })
}
