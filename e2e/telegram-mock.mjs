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

createServer((req, res) => {
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
