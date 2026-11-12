// signal-cli as a child process speaking JSON-RPC over stdin and stdout
// (`signal-cli -a <number> jsonRpc`). Nothing listens on a port, so nothing on
// the network can ask it to send.
//
// While it runs, signal-cli also receives (a linked device must, to stay in
// sync). Every received message arrives here as a "receive" notification and
// is dropped unread: only a count is kept. Phase 1 reads no commands.

import { execFile, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

export class SignalCliError extends Error {
  constructor(code, message, data) {
    super(message)
    this.code = code
    this.data = data
  }
}

/** The child went away (or never answered) while a request was open: whether it acted is not known. */
export class SignalCliGone extends Error {}

/** @param {{ account?: string, configDir?: string }} options */
function baseArgs({ account, configDir }) {
  return [...(configDir ? ['--config', configDir] : []), ...(account ? ['-a', account] : [])]
}

export class SignalCli {
  /** @param {{ binary: string, account: string, configDir?: string, timeoutMs?: number }} options */
  constructor(options) {
    this.options = options
    this.nextId = 1
    this.pending = new Map()
    this.received = 0
    this.exited = null
    this.child = spawn(options.binary, [...baseArgs(options), 'jsonRpc'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
    this.child.on('error', (/** @type {NodeJS.ErrnoException} */ error) => this.fail(new SignalCliGone(`signal-cli could not start: ${error.code ?? 'error'}`)))
    this.child.on('exit', (code) => {
      this.exited = code ?? -1
      this.fail(new SignalCliGone('signal-cli exited'))
    })
    this.child.stdin.on('error', () => {})
    createInterface({ input: this.child.stdout }).on('line', (line) => this.onLine(line))
  }

  fail(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(error)
    }
    this.pending.clear()
  }

  onLine(line) {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg && msg.method === 'receive') {
      // Received Signal traffic: never stored, logged or forwarded.
      this.received++
      return
    }
    const waiter = msg && msg.id !== undefined ? this.pending.get(msg.id) : undefined
    if (!waiter) return
    this.pending.delete(msg.id)
    clearTimeout(waiter.timer)
    if (msg.error) waiter.reject(new SignalCliError(msg.error.code, String(msg.error.message ?? ''), msg.error.data))
    else waiter.resolve(msg.result)
  }

  request(method, params = {}, timeoutMs = this.options.timeoutMs ?? 60_000) {
    if (this.exited !== null) return Promise.reject(new SignalCliGone('signal-cli is not running'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new SignalCliGone('signal-cli did not answer in time'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  /** One plain 1:1 message: no attachments, no quotes, no mentions. */
  send(recipient, message) {
    return this.request('send', { recipient: [recipient], message })
  }

  noteToSelf(message) {
    return this.request('send', { noteToSelf: true, message })
  }

  submitRateLimitChallenge(challenge, captcha) {
    return this.request('submitRateLimitChallenge', { challenge, captcha })
  }

  async close() {
    if (this.exited !== null) return
    this.child.stdin.end()
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill('SIGTERM')
        resolve()
      }, 5000)
      this.child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}

/**
 * What a send's answer means. signal-cli answers with one result per
 * recipient ("SUCCESS", "PROOF_REQUIRED_FAILURE" with a challenge token,
 * "RATE_LIMIT_FAILURE", "UNREGISTERED_FAILURE", "IDENTITY_FAILURE",
 * "NETWORK_FAILURE"), or an error. Anything that is not a clear answer is
 * "unknown": the helper never guesses that a message did not go out.
 */
export function classifySend(result, error) {
  if (error instanceof SignalCliGone || (!result && !error)) return { outcome: 'unknown' }
  if (error) {
    const text = `${error.message ?? ''} ${JSON.stringify(error.data ?? '')}`
    const nested = error.data?.response?.results
    if (Array.isArray(nested) && nested.length) return classifySend(error.data.response, null)
    if (/proof.?required|captcha|challenge/i.test(text)) return { outcome: 'failed', reason: 'challenge', challenge: findToken(error.data) }
    if (/rate.?limit/i.test(text)) return { outcome: 'failed', reason: 'rate_limit' }
    if (/unregistered|not registered/i.test(text)) return { outcome: 'failed', reason: 'unregistered' }
    if (/untrusted|identity/i.test(text)) return { outcome: 'failed', reason: 'identity' }
    if (/authorization failed|not linked|deauthori[sz]ed|403/i.test(text)) return { outcome: 'failed', reason: 'unlinked' }
    return { outcome: 'failed', reason: 'signal_cli' }
  }
  const first = Array.isArray(result.results) ? result.results[0] : null
  const type = String(first?.type ?? '')
  if (type === 'SUCCESS') return { outcome: 'sent', signalTimestamp: Number.isSafeInteger(result.timestamp) ? result.timestamp : null }
  if (type === 'PROOF_REQUIRED_FAILURE') return { outcome: 'failed', reason: 'challenge', challenge: typeof first.token === 'string' ? first.token : null }
  if (type === 'RATE_LIMIT_FAILURE') return { outcome: 'failed', reason: 'rate_limit' }
  if (type === 'UNREGISTERED_FAILURE') return { outcome: 'failed', reason: 'unregistered' }
  if (type === 'IDENTITY_FAILURE') return { outcome: 'failed', reason: 'identity' }
  // A network failure mid-send may or may not have reached Signal.
  return { outcome: 'unknown' }
}

function findToken(data) {
  const token = data?.response?.results?.[0]?.token ?? data?.token
  return typeof token === 'string' ? token : null
}

/** `signal-cli --version`: "0.13.22", or null when it cannot run. */
export function signalCliVersion(binary) {
  return new Promise((resolve) => {
    execFile(binary, ['--version'], { timeout: 30_000, windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null)
      const match = /(\d+\.\d+\.\d+)/.exec(String(stdout))
      resolve(match ? match[1] : null)
    })
  })
}

/** The accounts signal-cli has on this computer (`signal-cli listAccounts`). */
export function listAccounts(binary, configDir) {
  return new Promise((resolve) => {
    execFile(binary, [...baseArgs({ configDir }), 'listAccounts'], { timeout: 60_000, windowsHide: true }, (error, stdout) => {
      if (error) return resolve([])
      resolve([...String(stdout).matchAll(/\+[1-9]\d{6,14}/g)].map((m) => m[0]))
    })
  })
}
