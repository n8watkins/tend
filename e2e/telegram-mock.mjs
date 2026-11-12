// A stand-in for the Telegram Bot API in end-to-end tests (TELEGRAM_API_BASE,
// test environment only). Every call is appended to .e2e/telegram.jsonl as
// { method, body } for the tests to read; replies look like Telegram's.
//
// It is also the push service for Web Push (PUSH_TEST_BASE = <this>/push):
// each POST /push/<id> is appended to .e2e/push.jsonl as { id, headers, body }
// (body in base64url), answered 201, or 410 Gone when the id starts "gone".
import { appendFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

const port = Number(process.env.TELEGRAM_MOCK_PORT || 7843)
const dir = join(process.cwd(), '.e2e')
mkdirSync(dir, { recursive: true })
const log = join(dir, 'telegram.jsonl')
const pushLog = join(dir, 'push.jsonl')
let messageId = 100

const PUSH_HEADERS = ['authorization', 'content-encoding', 'content-type', 'ttl', 'urgency', 'topic']

function push(req, res, id) {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const headers = Object.fromEntries(PUSH_HEADERS.map((name) => [name, req.headers[name] ?? null]))
    appendFileSync(pushLog, `${JSON.stringify({ id, headers, body: Buffer.concat(chunks).toString('base64url') })}\n`)
    res.writeHead(id.startsWith('gone') ? 410 : 201).end()
  })
}

// Google OAuth and People API for the contact import (GOOGLE_API_BASE = this
// server). The consent screen approves at once; calls go to .e2e/google.jsonl.
const googleLog = join(dir, 'google.jsonl')
const GOOGLE_PEOPLE = {
  connections: [
    {
      names: [{ displayName: 'Priya Shah', metadata: { primary: true } }],
      phoneNumbers: [
        { value: '020 7946 0000', type: 'home' },
        { value: '07700 900456', canonicalForm: '+447700900456', type: 'mobile' },
      ],
      emailAddresses: [{ value: 'priya@example.com', metadata: { primary: true } }],
      birthdays: [{ date: { month: 5, day: 9 }, metadata: { primary: true } }],
    },
    { names: [{ displayName: 'Tom Becker' }], events: [{ type: 'anniversary', date: { year: 2015, month: 8, day: 22 } }] },
    { emailAddresses: [{ value: 'no-name@example.com' }] },
  ],
}

function google(req, res, url) {
  appendFileSync(googleLog, `${JSON.stringify({ method: req.method, path: url.pathname, authorization: req.headers.authorization ?? null })}\n`)
  if (url.pathname === '/google/auth') {
    const back = new URL(url.searchParams.get('redirect_uri'))
    back.searchParams.set('code', 'mock-code')
    back.searchParams.set('state', url.searchParams.get('state') ?? '')
    res.writeHead(302, { location: back.toString() }).end()
  } else if (url.pathname === '/google/token') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({ access_token: 'mock-access-token', token_type: 'Bearer', expires_in: 3599, scope: 'https://www.googleapis.com/auth/contacts.readonly' }),
    )
  } else if (url.pathname === '/google/people') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(GOOGLE_PEOPLE))
  } else res.writeHead(200).end()
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname.startsWith('/google/')) {
    req.resume()
    req.on('end', () => google(req, res, url))
    return
  }
  const pushMatch = req.url?.match(/^\/push\/([\w-]+)$/)
  if (req.method === 'POST' && pushMatch) {
    push(req, res, pushMatch[1])
    return
  }
  const match = req.url?.match(/^\/bot[^/]+\/(\w+)$/)
  if (req.method !== 'POST' || !match) {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('telegram mock')
    return
  }
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    const method = match[1]
    const body = raw ? JSON.parse(raw) : {}
    appendFileSync(log, `${JSON.stringify({ method, body })}\n`)
    const result =
      method === 'getMe'
        ? { id: 1, is_bot: true, first_name: 'Tend', username: 'tend_test_bot' }
        : method === 'sendMessage'
          ? { message_id: ++messageId, chat: { id: body.chat_id }, text: body.text }
          : true
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, result }))
  })
}).listen(port)
