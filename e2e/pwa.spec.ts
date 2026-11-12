import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { base64UrlDecode } from '../lib/webpush'
import { decryptPush, newSubscriptionKeys, subscriptionJson, type ReceiverKeys } from '../tests/webpush-receiver'
import { addPerson, runCron, signIn, testEmail } from './helpers'

test.use({ timezoneId: 'UTC' })

/** Waits until the service worker is active and controls the page. */
async function controlled(page: Page) {
  await page.goto('/')
  const scriptURL = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL)
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  return scriptURL!
}

test('the web app manifest makes Tend installable, with its icons', async ({ page, request }) => {
  const response = await request.get('/manifest.webmanifest')
  expect(response.ok()).toBe(true)
  expect(response.headers()['content-type']).toContain('application/manifest+json')
  const manifest = await response.json()
  expect(manifest).toMatchObject({
    name: 'Tend',
    short_name: 'Tend',
    start_url: '/today',
    scope: '/',
    display: 'standalone',
    theme_color: '#2f6b4f',
    background_color: '#f7f5f0',
  })
  const icons = manifest.icons as { src: string; sizes: string; purpose: string }[]
  expect(icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(['192x192 any', '512x512 any', '512x512 maskable'])
  for (const icon of [...icons, { src: '/apple-icon.png', sizes: '180x180' }, { src: '/icons/badge-96.png', sizes: '96x96' }]) {
    const png = await request.get(icon.src)
    expect(png.headers()['content-type'], icon.src).toBe('image/png')
    const bytes = await png.body()
    // The PNG header's width and height.
    expect(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.src).toBe(icon.sizes)
  }

  await page.goto('/')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', /\/apple-icon\.png/)
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')

  // Chrome's own installability check (what Lighthouse used to report).
  await controlled(page)
  const cdp = await page.context().newCDPSession(page)
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
  expect(installabilityErrors).toEqual([])
  const { errors } = await cdp.send('Page.getAppManifest')
  expect(errors).toEqual([])
})

test('the service worker registers for the whole site, versioned by the build', async ({ page }) => {
  const scriptURL = await controlled(page)
  expect(scriptURL).toMatch(/\/sw\.js\?v=[\w-]+$/)
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
  expect(new URL(scope).pathname).toBe('/')
  const version = new URL(scriptURL).searchParams.get('v')
  await expect.poll(() => page.evaluate(() => caches.keys())).toContain(`tend-shell-${version}`)
})

test('offline, pages show the offline screen, and no page is ever cached', async ({ page, context }, info) => {
  await signIn(page, testEmail(info, 'offline'))
  await addPerson(page, { name: 'Odette', consent: 'yes' })
  await controlled(page)
  await page.goto('/today')

  await context.setOffline(true)
  await page.goto('/people')
  await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible()
  await expect(page.getByText('Odette')).toHaveCount(0)
  await context.setOffline(false)
  await page.getByRole('link', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible()

  // Only the offline page, icons and hashed build files are kept: nothing with user data.
  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(new URL(request.url).pathname)
    return urls
  })
  expect(cached).toContain('/offline.html')
  expect(cached.filter((path) => !/^\/(offline\.html|icons\/[\w-]+\.png|_next\/static\/.+)$/.test(path))).toEqual([])
})

/* Phone notifications -------------------------------------------------------- */

const PUSH_LOG = join(process.cwd(), '.e2e', 'push.jsonl')
// PUSH_TEST_BASE in playwright.config.ts: the push service part of e2e/telegram-mock.mjs.
const PUSH_BASE = `http://localhost:${Number(process.env.E2E_TELEGRAM_PORT || 7843)}/push`

async function pushes(id: string): Promise<{ id: string; headers: Record<string, string>; body: string }[]> {
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

/**
 * Headless Chromium has no push service, so the browser's subscribe() is
 * replaced by one that returns a subscription at the local push mock with
 * keys the test holds. Everything else (permission, Settings, the server
 * action, the reminder run, encryption) is the real thing.
 */
async function fakePushService(page: Page, endpoint: string, keys: ReceiverKeys) {
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

async function dueMessage(page: Page, name: string) {
  await addPerson(page, { name, consent: 'yes', topics: ['Hope'] })
  await page.getByRole('link', { name: 'Write your own message' }).click()
  await page.getByLabel('Your message').fill(`Thinking of you, ${name}.`)
  await page.getByLabel(/Now, I.ll send it straight away/).check()
  await page.getByRole('button', { name: 'Continue to send' }).click()
  await expect(page).toHaveURL(/\/send\/[\w-]+$/)
  return page.url().split('/').pop()!
}

test('phone notifications: turn on in Settings, get the reminder pushed with a link to the message', async ({ page }, info) => {
  const device = `dev-${info.project.name}-${Date.now()}`
  const keys = await newSubscriptionKeys()
  await fakePushService(page, `${PUSH_BASE}/${device}`, keys)
  await signIn(page, testEmail(info, 'push'))
  await controlled(page)

  await page.goto('/settings')
  const toggle = page.getByRole('switch', { name: /Phone notifications/ })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(page.getByText('Notifications are on for this device.')).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await page.reload()
  await expect(page.getByRole('switch', { name: /Phone notifications/ })).toHaveAttribute('aria-checked', 'true')

  // A test notification goes to this device.
  await page.getByRole('button', { name: 'Send a test notification' }).click()
  await expect(page.getByText('Sent. It should arrive in a few seconds.')).toBeVisible()
  await expect.poll(async () => (await pushes(device)).length).toBe(1)

  // The reminder run pushes the due message once, encrypted for this device and signed with Tend's VAPID key.
  const messageId = await dueMessage(page, 'Pia')
  const run = await runCron(page)
  expect(run.pushed).toBeGreaterThanOrEqual(1)
  await runCron(page)
  const sent = await pushes(device)
  expect(sent).toHaveLength(2)
  const reminder = sent[1]!
  expect(reminder.headers).toMatchObject({ 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '43200', urgency: 'normal', topic: 'tend-reminder' })
  const [, jwt, k] = reminder.headers.authorization!.match(/^vapid t=([\w.-]+), k=([\w-]+)$/)!
  const [h, c, s] = jwt!.split('.')
  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(c!)))
  expect(claims.aud).toBe(new URL(PUSH_BASE).origin)
  const key = await crypto.subtle.importKey('raw', base64UrlDecode(k!), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, base64UrlDecode(s!), new TextEncoder().encode(`${h}.${c}`))).toBe(true)
  const payload = JSON.parse(await decryptPush(base64UrlDecode(reminder.body), keys))
  expect(payload).toEqual({ title: 'Time to message Pia', body: 'Your message is ready. Open it, copy it, and send it on Signal.', url: `/send/${messageId}`, tag: 'tend-reminder' })

  // Off removes this device; the next reminder is not pushed.
  await page.goto('/settings')
  await page.getByRole('switch', { name: /Phone notifications/ }).click()
  await expect(page.getByRole('switch', { name: /Phone notifications/ })).toHaveAttribute('aria-checked', 'false')
  await dueMessage(page, 'Quinn')
  await runCron(page)
  expect(await pushes(device)).toHaveLength(2)
})

test('phone notifications: a subscription the push service says is gone (410) is deleted', async ({ page }, info) => {
  const device = `gone-${info.project.name}-${Date.now()}`
  await fakePushService(page, `${PUSH_BASE}/${device}`, await newSubscriptionKeys())
  await signIn(page, testEmail(info, 'push-gone'))
  await controlled(page)
  await page.goto('/settings')
  await page.getByRole('switch', { name: /Phone notifications/ }).click()
  await expect(page.getByRole('switch', { name: /Phone notifications/ })).toHaveAttribute('aria-checked', 'true')

  await dueMessage(page, 'Rafa')
  await runCron(page)
  expect(await pushes(device)).toHaveLength(1)
  // Gone: Settings shows it off, and the next run does not try it again.
  await page.goto('/settings')
  await expect(page.getByRole('switch', { name: /Phone notifications/ })).toHaveAttribute('aria-checked', 'false')
  await dueMessage(page, 'Sol')
  await runCron(page)
  expect(await pushes(device)).toHaveLength(1)
})

test('install: Settings explains how, and the one-time hint shows on iPhone', async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone', 'the hint is for phones')
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    timezoneId: 'UTC',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  })
  const page = await context.newPage()
  await signIn(page, testEmail(info, 'install'))
  const hint = page.getByRole('complementary', { name: 'Install Tend' })
  await expect(hint).toContainText('Add to Home Screen')
  // Still there on the next page, until dismissed; then never again.
  await page.getByRole('link', { name: 'People' }).last().click()
  await expect(hint).toBeVisible()
  await hint.getByRole('button', { name: 'Dismiss' }).click()
  await expect(hint).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible()
  await expect(hint).toHaveCount(0)

  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Install Tend' })).toBeVisible()
  await expect(page.getByText('Scroll down and tap Add to Home Screen')).toBeVisible()
  await expect(page.getByText('notifications work only once Tend is on your Home Screen')).toBeVisible()
  await expect(page.getByRole('switch', { name: /Phone notifications/ })).toBeDisabled()
  await context.close()
})
