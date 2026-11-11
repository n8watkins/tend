// A stand-in for the Telegram Bot API in end-to-end tests (TELEGRAM_API_BASE,
// test environment only). Every call is appended to .e2e/telegram.jsonl as
// { method, body } for the tests to read; replies look like Telegram's.
import { appendFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

const port = Number(process.env.TELEGRAM_MOCK_PORT || 7843)
const dir = join(process.cwd(), '.e2e')
mkdirSync(dir, { recursive: true })
const log = join(dir, 'telegram.jsonl')
let messageId = 100

createServer((req, res) => {
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
