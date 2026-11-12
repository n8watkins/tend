#!/usr/bin/env node
// A stand-in for signal-cli in tests (CI never talks to Signal). It speaks the
// same JSON-RPC over stdin and stdout as `signal-cli -a <number> jsonRpc`, and
// answers `--version` and `listAccounts`.
//
// FAKE_SIGNAL_LOG: a file each send is appended to, as one JSON line
//   { recipient, message, noteToSelf, delivered }.
// FAKE_SIGNAL_MODE (or the first line of FAKE_SIGNAL_MODE_FILE, read per send):
//   ok            every send succeeds
//   challenge     Signal asks for a captcha (PROOF_REQUIRED_FAILURE); nothing is delivered
//   unregistered  the number is not on Signal
//   crash         the message is delivered, then the process dies before answering
//   hang          the message is delivered, and the answer never comes
// On start it also emits a received message (a stranger's text) as Signal
// would, so tests can check the helper drops it unread.

import { appendFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
if (args.includes('--version')) {
  console.log('signal-cli 0.13.99')
  process.exit(0)
}
if (args.includes('listAccounts')) {
  console.log('Number: +15550000001')
  process.exit(0)
}
if (!args.includes('jsonRpc')) {
  console.error('fake signal-cli: unsupported command')
  process.exit(2)
}

function mode() {
  if (process.env.FAKE_SIGNAL_MODE_FILE) {
    try {
      return readFileSync(process.env.FAKE_SIGNAL_MODE_FILE, 'utf8').trim().split('\n')[0] || 'ok'
    } catch {
      return 'ok'
    }
  }
  return process.env.FAKE_SIGNAL_MODE || 'ok'
}

function record(entry) {
  if (process.env.FAKE_SIGNAL_LOG) appendFileSync(process.env.FAKE_SIGNAL_LOG, `${JSON.stringify(entry)}\n`)
}

const write = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)

write({
  method: 'receive',
  params: {
    envelope: {
      source: '+15559998888',
      sourceName: 'A Stranger',
      timestamp: Date.now(),
      dataMessage: { timestamp: Date.now(), message: 'PRIVATE INCOMING TEXT from a stranger' },
    },
  },
})

createInterface({ input: process.stdin }).on('line', (line) => {
  const req = JSON.parse(line)
  if (req.method === 'send') {
    const recipient = req.params.noteToSelf ? 'note-to-self' : req.params.recipient?.[0]
    const m = req.params.noteToSelf ? 'ok' : mode()
    if (m === 'hang') {
      // Delivered, but the answer never comes (the helper is killed meanwhile).
      record({ recipient, message: req.params.message, noteToSelf: false, delivered: true })
      return
    }
    if (m === 'crash') {
      record({ recipient, message: req.params.message, noteToSelf: Boolean(req.params.noteToSelf), delivered: true })
      process.exit(1)
    }
    if (m === 'challenge') {
      record({ recipient, message: req.params.message, noteToSelf: false, delivered: false })
      write({ id: req.id, result: { timestamp: Date.now(), results: [{ recipientAddress: { number: recipient }, type: 'PROOF_REQUIRED_FAILURE', token: 'fake-challenge-token', retryAfterSeconds: 86400 }] } })
      return
    }
    if (m === 'unregistered') {
      record({ recipient, message: req.params.message, noteToSelf: false, delivered: false })
      write({ id: req.id, result: { timestamp: Date.now(), results: [{ recipientAddress: { number: recipient }, type: 'UNREGISTERED_FAILURE' }] } })
      return
    }
    record({ recipient, message: req.params.message, noteToSelf: Boolean(req.params.noteToSelf), delivered: true })
    write({ id: req.id, result: { timestamp: Date.now(), results: [{ recipientAddress: { number: recipient }, type: 'SUCCESS' }] } })
    return
  }
  if (req.method === 'submitRateLimitChallenge') {
    write({ id: req.id, result: {} })
    return
  }
  write({ id: req.id, error: { code: -32601, message: 'Method not implemented' } })
})
