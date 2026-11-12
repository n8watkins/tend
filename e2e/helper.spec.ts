import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { base64UrlDecode } from '../lib/webpush'
import { decryptPush, newSubscriptionKeys, type ReceiverKeys } from '../tests/webpush-receiver'
import { addPerson, controlled, fakePushService, PUSH_BASE, pushes, runCron, signIn, testEmail } from './helpers'

/**
 * The Signal helper end to end (docs/SIGNAL-HELPER.md, phase 1): the real
 * app, the real tend-helper CLI, and a fake signal-cli (helper/test/
 * fake-signal-cli.mjs). Nothing here talks to Signal.
 */

test.use({ timezoneId: 'UTC' })

const BIN = join(process.cwd(), 'helper', 'bin', 'tend-helper.mjs')
const FAKE_SIGNAL = join(process.cwd(), 'helper', 'test', 'fake-signal-cli.mjs')
const BASE_URL = `http://localhost:${Number(process.env.E2E_PORT || 7842)}`

/** An account on the helper's allowlist (SIGNAL_HELPER_USERS in playwright.config.ts). */
function helperEmail(info: TestInfo, label: string) {
  return `${label}-${info.project.name}-${Date.now()}@helper.example.test`
}

/** A tend-helper with its own home folder and fake signal-cli. */
function fakeHelper(info: TestInfo, label: string) {
  const home = join(process.cwd(), '.e2e', 'helpers', `${label}-${info.project.name}-${Date.now()}`)
  mkdirSync(home, { recursive: true })
  const signalLog = join(home, 'signal.jsonl')
  const env = { ...process.env, TEND_HELPER_HOME: home, FAKE_SIGNAL_LOG: signalLog, FAKE_SIGNAL_MODE: 'ok' }
  const cli = (...args: string[]) =>
    new Promise<{ code: number; out: string }>((resolve) =>
      execFile(process.execPath, [BIN, ...args], { env, timeout: 30_000 }, (error, stdout, stderr) =>
        resolve({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` }),
      ),
    )
  return {
    pair: (code: string) => cli('pair', code, '--url', BASE_URL, '--signal-cli', FAKE_SIGNAL),
    runOnce: () => cli('run', '--once'),
    sent: (): { recipient: string; message: string; delivered: boolean }[] =>
      existsSync(signalLog)
        ? readFileSync(signalLog, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l))
        : [],
    token: () => readFileSync(join(home, 'config', 'token'), 'utf8').trim(),
  }
}

/** Turns the helper on in Settings (with the risk box), gets a pairing code and pairs the fake helper. */
async function setUpHelper(page: Page, helper: ReturnType<typeof fakeHelper>) {
  await page.goto('/settings')
  const section = page.getByRole('region', { name: 'Signal helper' })
  await expect(section.getByText('Your number, your risk')).toBeVisible()
  await section.getByRole('button', { name: 'Turn on the Signal helper' }).click()
  await expect(page.getByText('Tick the box to confirm you understand the risk.')).toBeVisible()
  await section.getByLabel(/I understand this uses an unofficial Signal client/).check()
  await section.getByRole('button', { name: 'Turn on the Signal helper' }).click()
  await expect(page.getByText('The Signal helper is on. Pair your helper below.')).toBeVisible()

  await section.getByRole('button', { name: 'Get a pairing code' }).click()
  const code = (await section.getByTestId('pair-code').textContent())!.trim()
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  await expect(section.getByText(`tend-helper pair ${code}`)).toBeVisible()
  const paired = await helper.pair(code)
  expect(paired.out).toContain(`Paired with ${BASE_URL}`)
  // A code works once.
  expect((await helper.pair(code)).code).not.toBe(0)

  await expect((await helper.runOnce()).out).toContain('idle')
  await page.reload()
  await expect(section.getByText('Helper online')).toBeVisible()
  await expect(section.getByText('0 of 10 sent today')).toBeVisible()
}

async function dueMessage(page: Page, name: string, phone = '+1 555 010 2030') {
  const contactId = await addPerson(page, { name, phone, consent: 'yes', topics: ['Hope'] })
  await page.getByRole('link', { name: 'Write your own message' }).click()
  await page.getByLabel('Your message').fill(`Thinking of you, ${name}.`)
  await page.getByLabel(/Now, I.ll send it straight away/).check()
  await page.getByRole('button', { name: 'Continue to send' }).click()
  await expect(page).toHaveURL(/\/send\/[\w-]+$/)
  return { messageId: page.url().split('/').pop()!, contactId }
}

async function withPush(page: Page, info: TestInfo, label: string) {
  const device = `${label}-${info.project.name}-${Date.now()}`
  const keys = await newSubscriptionKeys()
  await fakePushService(page, `${PUSH_BASE}/${device}`, keys)
  return { device, keys }
}

async function turnOnNotifications(page: Page) {
  await controlled(page)
  await page.goto('/settings')
  await page.getByRole('switch', { name: /Phone notifications/ }).click()
  await expect(page.getByText('Notifications are on for this device.')).toBeVisible()
}

/** Axe WCAG A and AA checks, as e2e/a11y.spec.ts runs on the other pages. */
async function axe(page: Page, path: string) {
  await page.goto(path)
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(results.violations.map((v) => `${path}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join('; ')}`)).toEqual([])
}

async function decrypted(device: string, keys: ReceiverKeys) {
  return Promise.all((await pushes(device)).map(async (p) => JSON.parse(await decryptPush(base64UrlDecode(p.body), keys))))
}

test('approve from the notification: one push with Send and Skip, one Signal message, "Sent by your helper"', async ({ page }, info) => {
  const { device, keys } = await withPush(page, info, 'approve-push')
  await signIn(page, helperEmail(info, 'push'))
  await turnOnNotifications(page)
  const helper = fakeHelper(info, 'push')
  await setUpHelper(page, helper)

  const { messageId } = await dueMessage(page, 'Hana')
  // The send screen offers the helper next to every manual path.
  await expect(page.getByRole('link', { name: 'Send with my helper' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy message' })).toBeVisible()

  const run = await runCron(page)
  expect(run.approvals).toBeGreaterThanOrEqual(1)
  await runCron(page)
  const payloads = await decrypted(device, keys)
  const asks = payloads.filter((p) => p.title === 'Send to Hana?')
  expect(asks).toHaveLength(1)
  // The first 120 characters, on one line (the stop link follows the note).
  expect(asks[0].body).toMatch(/^Thinking of you, Hana\. Rather not get these\? /)
  expect(asks[0].body.length).toBeLessThanOrEqual(120)
  expect(asks[0]).toMatchObject({
    url: `/approve/${messageId}`,
    actions: [
      { action: 'send', title: 'Send' },
      { action: 'skip', title: 'Skip' },
    ],
  })
  // Its own topic, so it never replaces another message's request.
  const raw = (await pushes(device)).at(-1)!
  expect(raw.headers.topic).toMatch(/^ap[0-9a-f]{30}$/)

  // Today and the queue show it.
  await axe(page, '/approvals')
  await axe(page, `/approve/${messageId}`)
  await axe(page, '/settings')
  await page.goto('/today')
  await expect(page.getByRole('link', { name: /1 message needs your approval/ })).toBeVisible()
  await page.getByRole('link', { name: /1 message needs your approval/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Approvals' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Hana: Personal message/ })).toBeVisible()

  // What the service worker does when Send is tapped: post the action with the push's token.
  const token = asks[0].approval.token as string
  expect((await page.request.post(`/api/approvals/${messageId}`, { data: { action: 'send', token: `${token.slice(0, -2)}xx` } })).status()).toBe(401)
  const tapped = await page.request.post(`/api/approvals/${messageId}`, { data: { action: 'send', token } })
  expect(tapped.status()).toBe(200)
  expect(await tapped.json()).toEqual({ ok: true, text: 'Approved. Your helper will send it to Hana shortly.' })

  // The helper sends it exactly once.
  expect((await helper.runOnce()).out).toContain('sent')
  expect(helper.sent()).toEqual([{ recipient: '+15550102030', message: expect.stringMatching(/^Thinking of you, Hana\.\n\nRather not get these\? http/), noteToSelf: false, delivered: true }])
  expect((await helper.runOnce()).out).toContain('idle')
  expect(helper.sent()).toHaveLength(1)
  // A second tap after it went out changes nothing.
  expect((await page.request.post(`/api/approvals/${messageId}`, { data: { action: 'send', token } })).status()).toBe(409)

  await page.goto('/history')
  await expect(page.getByRole('link', { name: /Hana: Personal message/ }).getByText('Sent by your helper')).toBeVisible()
  await page.goto(`/approve/${messageId}`)
  await expect(page.getByText('Sent by your helper').first()).toBeVisible()
  await axe(page, `/approve/${messageId}`)
  await axe(page, '/history')
  const sentPushes = (await decrypted(device, keys)).filter((p) => p.title === 'Sent to Hana')
  expect(sentPushes).toHaveLength(1)
})

test('approve on the page (iPhone), then consent changes or Tend pauses: nothing is sent', async ({ page }, info) => {
  await signIn(page, helperEmail(info, 'page'))
  const helper = fakeHelper(info, 'page')
  await setUpHelper(page, helper)

  // Approve on /approve/<id>, then they use their stop link before the helper polls.
  const first = await dueMessage(page, 'Ines')
  await page.goto(`/approve/${first.messageId}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Send to Ines?' })).toBeVisible()
  await expect(page.getByTestId('message-body')).toContainText('Thinking of you, Ines.')
  await expect(page.getByTestId('message-body')).toContainText('Rather not get these?')
  await page.getByRole('button', { name: 'Send with my helper' }).click()
  await expect(page.getByText('Approved. Your helper sends it within a minute or so.')).toBeVisible()
  await page.goto(`/people/${first.contactId}`)
  await page.getByRole('button', { name: 'They asked me to stop' }).click()
  await expect(page.getByText('Messages to Ines are stopped.')).toBeVisible()
  expect((await helper.runOnce()).out).toMatch(/idle|refused/)
  expect(helper.sent()).toEqual([])

  // Approve another, then pause Tend: the helper waits and sends nothing.
  const second = await dueMessage(page, 'Jonas', '+1 555 010 4040')
  await page.goto(`/approve/${second.messageId}`)
  await page.getByRole('button', { name: 'Send with my helper' }).click()
  await expect(page.getByText('Approved. Your helper sends it within a minute or so.')).toBeVisible()
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Pause Tend' }).click()
  expect((await helper.runOnce()).out).toContain('paused')
  expect(helper.sent()).toEqual([])
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Resume Tend' }).click()
  expect((await helper.runOnce()).out).toContain('sent')
  expect(helper.sent().map((s) => s.recipient)).toEqual(['+15550104040'])
})

test('PC off: an approval nobody claims goes back to the manual path with one notice, and is never sent late', async ({ page }, info) => {
  const { device, keys } = await withPush(page, info, 'offline')
  await signIn(page, helperEmail(info, 'offline'))
  await turnOnNotifications(page)
  const helper = fakeHelper(info, 'offline')
  await setUpHelper(page, helper)

  const { messageId } = await dueMessage(page, 'Kofi')
  await page.goto(`/approve/${messageId}`)
  await page.getByRole('button', { name: 'Send with my helper' }).click()
  await expect(page.getByText(/If your PC is off, it comes back to you at/)).toBeVisible()

  // Three hours later the helper never came: the approval lapses, once.
  const later = Date.now() + 3 * 60 * 60 * 1000
  expect((await runCron(page, later)).helper.expired).toBeGreaterThanOrEqual(1)
  await runCron(page, later + 60_000)
  const notices = (await decrypted(device, keys)).filter((p) => p.title === 'Not sent to Kofi')
  expect(notices).toEqual([{ title: 'Not sent to Kofi', body: 'Your PC was off. Send it yourself or reschedule.', url: `/send/${messageId}`, tag: `tend-approval-${messageId}` }])

  // Still ready to send by hand; the helper coming back sends nothing.
  await page.goto(`/send/${messageId}`)
  await expect(page.getByText('Ready to send')).toBeVisible()
  expect((await helper.runOnce()).out).toContain('idle')
  expect(helper.sent()).toEqual([])
})

test('Remove helper stops it at once; a device token opens nothing else', async ({ page, request }, info) => {
  await signIn(page, helperEmail(info, 'remove'))
  const helper = fakeHelper(info, 'remove')
  await setUpHelper(page, helper)
  const token = helper.token()

  // The device token is for /api/helper/* only.
  const bearer = { authorization: `Bearer ${token}` }
  expect((await request.get('/api/helper/jobs', { headers: bearer })).status()).toBe(200)
  expect((await request.get('/api/export', { headers: bearer })).status()).toBe(401)
  const today = await request.get('/today', { headers: bearer, maxRedirects: 0 })
  expect(today.status()).toBeGreaterThanOrEqual(300)
  expect(today.headers().location ?? '').toContain('/signin')
  // A signed-in session is not a device token.
  expect((await page.request.get('/api/helper/jobs')).status()).toBe(401)

  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Remove helper' }).click()
  await expect(page.getByText('Helper removed. It can no longer fetch or send anything.')).toBeVisible()
  expect((await request.get('/api/helper/jobs', { headers: bearer })).status()).toBe(401)
  const stopped = await helper.runOnce()
  expect(stopped.out).toMatch(/removed in Tend/)
})

test('the helper is private: other accounts never see it', async ({ page, request }, info) => {
  await signIn(page, testEmail(info, 'not-helper'))
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Pause everything' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Signal helper' })).toHaveCount(0)
  expect((await page.goto('/approvals'))!.status()).toBe(404)
  // Pairing with any code is refused, as is any helper route without a token.
  expect((await request.post('/api/helper/pair', { data: { code: 'ABCD-EFGH' } })).status()).toBe(401)
  expect((await request.get('/api/helper/jobs')).status()).toBe(401)
})
