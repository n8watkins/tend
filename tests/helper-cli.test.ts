/**
 * tend-helper itself (helper/), against a fake signal-cli (helper/test/
 * fake-signal-cli.mjs, the same JSON-RPC) and a small fake Tend: sends once,
 * a crash between send and report leads to "unknown" and no resend, a
 * captcha stops all sending, received messages never reach logs or Tend,
 * late approvals are refused, and the hard cap holds when Tend misbehaves.
 * CI never talks to Signal.
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { Revoked, TendApi } from '../helper/lib/api.mjs'
import { readState, writeConfig, writeState, writeToken } from '../helper/lib/config.mjs'
import { Journal } from '../helper/lib/journal.mjs'
import { setLogSink } from '../helper/lib/log.mjs'
import { bodyHash, HARD_DAILY_MAX, MIN_GAP_MS, Runner } from '../helper/lib/runner.mjs'
import { plan, uninstallPlan, unitFile } from '../helper/lib/service.mjs'
import { classifySend, SignalCli, SignalCliGone } from '../helper/lib/signal-cli.mjs'

const FAKE_SIGNAL = join(process.cwd(), 'helper', 'test', 'fake-signal-cli.mjs')
const BIN = join(process.cwd(), 'helper', 'bin', 'tend-helper.mjs')
const RECIPIENT = '+15557654321'
const BODY = 'Grace and peace to you, Bartholomew.'
const TOKEN = `tdh_${'a'.repeat(43)}`
const MINUTE = 60_000
const HOUR = 60 * MINUTE

/* A fake Tend ---------------------------------------------------------------- */

interface FakeJob {
  id: string
  approvedAt: number
  sendBy: number
  recipient: string
  body: string
  claimId?: string
  offered: boolean
}

class FakeTend {
  server!: Server
  url = ''
  jobs = new Map<string, FakeJob>()
  results: { id: string; body: Record<string, unknown> }[] = []
  events: string[] = []
  requests: string[] = []
  claims = 0
  revoked = false
  paused = false
  /** Keep offering claimed jobs, and a new one after each claim, like a broken server. */
  misbehave = false
  clock = () => Date.now()

  async start() {
    this.server = createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        this.requests.push(`${req.method} ${req.url} ${raw}`)
        const send = (status: number, data: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data))
        if (req.headers.authorization !== `Bearer ${TOKEN}` || this.revoked) return send(401, { error: 'unauthorized' })
        const now = this.clock()
        if (req.method === 'GET' && req.url === '/api/helper/jobs') {
          const jobs = [...this.jobs.values()].filter((j) => j.offered).map(({ id, approvedAt, sendBy }) => ({ id, approvedAt, sendBy }))
          return send(200, { serverTime: now, minHelperVersion: '0.1.0', pollSeconds: 30, paused: this.paused, halted: null, caps: { dailyMax: 20 }, jobs })
        }
        const claim = req.url?.match(/^\/api\/helper\/jobs\/([\w-]+)\/claim$/)
        if (req.method === 'POST' && claim) {
          const job = this.jobs.get(claim[1]!)
          if (!job || (!job.offered && !this.misbehave)) return send(409, { error: 'already_claimed' })
          this.claims++
          job.claimId = crypto.randomUUID()
          if (!this.misbehave) job.offered = false
          else this.add(`job-${this.claims}`, now)
          return send(200, { id: job.id, claimId: job.claimId, recipient: job.recipient, body: job.body, bodyHash: bodyHash(job.body), leaseUntil: now + 10 * MINUTE, approvedAt: job.approvedAt, sendBy: job.sendBy })
        }
        const result = req.url?.match(/^\/api\/helper\/jobs\/([\w-]+)\/result$/)
        if (req.method === 'POST' && result) {
          const body = JSON.parse(raw)
          this.results.push({ id: result[1]!, body })
          return send(this.jobs.get(result[1]!)?.claimId === body.claimId ? 200 : 409, { sendState: body.outcome })
        }
        if (req.method === 'POST' && req.url === '/api/helper/events') {
          this.events.push(JSON.parse(raw).kind)
          return send(200, { ok: true })
        }
        send(404, { error: 'not_found' })
      })
    })
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    const address = this.server.address() as { port: number }
    this.url = `http://127.0.0.1:${address.port}`
    return this
  }

  add(id: string, approvedAt = this.clock(), extra: Partial<FakeJob> = {}) {
    this.jobs.set(id, { id, approvedAt, sendBy: approvedAt + 2 * HOUR, recipient: RECIPIENT, body: BODY, offered: true, ...extra })
  }

  stop() {
    return new Promise<void>((resolve) => this.server.close(() => resolve()))
  }
}

/* Setup ------------------------------------------------------------------------ */

let tend: FakeTend
let home: string
let signalLog: string
let modeFile: string
const logLines: string[] = []
let restoreSink: (line: string) => void

function env(extra: Record<string, string> = {}) {
  return { ...process.env, TEND_HELPER_HOME: home, FAKE_SIGNAL_LOG: signalLog, FAKE_SIGNAL_MODE_FILE: modeFile, ...extra }
}

function mode(value: string) {
  writeFileSync(modeFile, value)
}

function sent(): { recipient: string; message: string; delivered: boolean }[] {
  if (!existsSync(signalLog)) return []
  return readFileSync(signalLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

function runner(now?: () => number) {
  const e = env()
  process.env.FAKE_SIGNAL_LOG = e.FAKE_SIGNAL_LOG
  process.env.FAKE_SIGNAL_MODE_FILE = e.FAKE_SIGNAL_MODE_FILE
  return new Runner({
    api: new TendApi({ url: tend.url, token: TOKEN, version: '0.1.0' }),
    openSignal: () => new SignalCli({ binary: FAKE_SIGNAL, account: '+15550000001' }),
    journal: new Journal(join(home, 'state', 'journal.jsonl')),
    state: { read: () => readState(e), write: (s: object) => writeState(s, e) },
    version: '0.1.0',
    now,
  })
}

beforeAll(async () => {
  tend = await new FakeTend().start()
})

afterAll(async () => {
  await tend.stop()
})

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'tend-helper-test-'))
  signalLog = join(home, 'signal.jsonl')
  modeFile = join(home, 'mode')
  mode('ok')
  tend.jobs.clear()
  tend.results = []
  tend.events = []
  tend.requests = []
  tend.claims = 0
  tend.revoked = false
  tend.paused = false
  tend.misbehave = false
  tend.clock = () => Date.now()
  logLines.length = 0
  restoreSink = setLogSink((line: string) => void logLines.push(line))
})

afterEach(() => {
  setLogSink(restoreSink)
  rmSync(home, { recursive: true, force: true })
})

function expectCleanLogs() {
  const all = [...logLines, ...tend.requests].join('\n')
  expect(all).not.toContain(RECIPIENT)
  expect(all).not.toContain('7654321')
  expect(all).not.toContain('Bartholomew')
  expect(all).not.toContain('PRIVATE INCOMING')
  expect(all).not.toContain('15559998888')
}

/* Tests ------------------------------------------------------------------------- */

describe('tend-helper', () => {
  it('claims an approved message, sends it once and reports it', async () => {
    tend.add('m1')
    const r = runner()
    try {
      expect(await r.cycle()).toBe('sent')
      expect(await r.cycle()).toBe('idle')
    } finally {
      await r.close()
    }
    expect(sent()).toEqual([{ recipient: RECIPIENT, message: BODY, noteToSelf: false, delivered: true }])
    expect(tend.results).toHaveLength(1)
    expect(tend.results[0]!.body).toMatchObject({ claimId: tend.jobs.get('m1')!.claimId, outcome: 'sent' })
    expect(typeof tend.results[0]!.body.signalTimestamp).toBe('number')
    expectCleanLogs()
  })

  it('a crash between send and report leads to "unknown" and never a second send', async () => {
    tend.add('m2')
    writeConfig({ url: tend.url, account: '+15550000001', signalCli: FAKE_SIGNAL }, env())
    writeToken(TOKEN, env())
    mode('hang')
    // The real CLI, killed while signal-cli has delivered but not answered.
    const child = spawn(process.execPath, [BIN, 'run', '--once'], { env: env(), stdio: 'ignore' })
    await expect.poll(() => sent().length, { timeout: 15_000 }).toBe(1)
    child.kill('SIGKILL')
    await new Promise((resolve) => child.once('exit', resolve))
    expect(tend.results).toEqual([])
    const journal = readFileSync(join(home, 'state', 'journal.jsonl'), 'utf8')
    expect(journal).toContain('"t":"started"')
    expect(journal).not.toContain('"t":"done"')

    // Restarted: reports unknown for that claim, and sends nothing.
    mode('ok')
    tend.jobs.get('m2')!.offered = true
    const output = await new Promise<string>((resolve) => execFile(process.execPath, [BIN, 'run', '--once'], { env: env() }, (_e, stdout) => resolve(stdout)))
    expect(tend.results.map((r) => r.body)).toEqual([{ claimId: tend.jobs.get('m2')!.claimId, outcome: 'unknown', signalTimestamp: null }])
    expect(output).toMatch(/"event":"reported".*"outcome":"unknown"/)
    expect(tend.claims).toBe(1)
    expect(sent()).toHaveLength(1)
    expect(output).not.toMatch(/7654321|Bartholomew|PRIVATE/)
    // Later too, past the gap: Tend offering it again still sends nothing.
    const later = runner(() => Date.now() + MIN_GAP_MS + MINUTE)
    try {
      expect(await later.cycle()).toBe('nothing_to_start')
    } finally {
      await later.close()
    }
    expect(tend.claims).toBe(1)
    expect(sent()).toHaveLength(1)
  }, 30_000)

  it('signal-cli dying mid-send is "unknown", not "failed"', async () => {
    tend.add('m3')
    mode('crash')
    const r = runner()
    try {
      expect(await r.cycle()).toBe('unknown')
    } finally {
      await r.close()
    }
    expect(sent()).toHaveLength(1)
    expect(tend.results[0]!.body).toMatchObject({ outcome: 'unknown' })
    // Tend offering it again (a broken server) still does not send it twice.
    tend.jobs.get('m3')!.offered = true
    const again = runner(() => Date.now() + MIN_GAP_MS + MINUTE)
    try {
      expect(await again.cycle()).toBe('nothing_to_start')
    } finally {
      await again.close()
    }
    expect(sent()).toHaveLength(1)
    expectCleanLogs()
  })

  it('a captcha stops all sending until resumed, and solving it is left to the user', async () => {
    tend.add('m4')
    mode('challenge')
    const r = runner()
    try {
      expect(await r.cycle()).toBe('failed')
      expect(tend.events).toEqual(['challenge'])
      expect(tend.results[0]!.body).toMatchObject({ outcome: 'failed', reason: 'challenge' })
      expect(readState(env())).toMatchObject({ halted: true, haltReason: 'challenge', challengeToken: 'fake-challenge-token' })

      mode('ok')
      tend.add('m5', Date.now() - 1)
      expect(await r.cycle()).toBe('halted')
      expect(tend.claims).toBe(1)
      expect(sent().filter((s) => s.delivered)).toHaveLength(0)
    } finally {
      await r.close()
    }
    // `tend-helper resume` clears it here (Tend has its own Resume in Settings).
    await new Promise((resolve) => execFile(process.execPath, [BIN, 'resume'], { env: env() }, resolve))
    expect(readState(env()).halted).toBe(false)
    const after = runner(() => Date.now() + MIN_GAP_MS)
    try {
      expect(await after.cycle()).toBe('sent')
    } finally {
      await after.close()
    }
    expectCleanLogs()
  })

  it('refuses approvals that are too late, and waits while Tend is paused', async () => {
    tend.add('late', Date.now() - 3 * HOUR, { sendBy: Date.now() + HOUR })
    tend.add('expired', Date.now() - MINUTE, { sendBy: Date.now() - 1 })
    const r = runner()
    try {
      expect(await r.cycle()).toBe('nothing_to_start')
      tend.add('fine')
      tend.paused = true
      expect(await r.cycle()).toBe('paused')
    } finally {
      await r.close()
    }
    expect(tend.claims).toBe(0)
    expect(sent()).toEqual([])
  })

  it('holds its own hard cap and gap even when Tend keeps handing out jobs', async () => {
    tend.misbehave = true
    let now = Date.now()
    tend.clock = () => now
    tend.add('flood-0', now)
    const r = runner(() => now)
    const outcomes: string[] = []
    try {
      outcomes.push(await r.cycle())
      // Straight away: the gap holds.
      outcomes.push(await r.cycle())
      for (let i = 0; i < 30; i++) {
        now += MIN_GAP_MS + 1000
        outcomes.push(await r.cycle())
      }
    } finally {
      await r.close()
    }
    expect(outcomes[1]).toBe('waiting')
    expect(outcomes.filter((o) => o === 'sent')).toHaveLength(HARD_DAILY_MAX)
    expect(outcomes.at(-1)).toBe('local_cap')
    expect(sent()).toHaveLength(HARD_DAILY_MAX)
  }, 60_000)

  it('refuses a claim whose text does not match its hash, or whose recipient is not a number', async () => {
    tend.add('bad', Date.now(), { recipient: 'someone@example.com' })
    const r = runner()
    try {
      expect(await r.cycle()).toBe('failed')
    } finally {
      await r.close()
    }
    expect(sent()).toEqual([])
    expect(tend.results[0]!.body).toMatchObject({ outcome: 'failed', reason: 'other' })
  })

  it('stops when the token is revoked (exit code 3, not restarted by systemd)', async () => {
    tend.revoked = true
    const r = runner()
    await expect(r.cycle()).rejects.toBeInstanceOf(Revoked)
    const code = await r.loop({ stopped: false, sleep: async () => {} } as never)
    expect(code).toBe(3)
    await r.close()
  })

  it('pairs with a code and keeps the token private (mode 600)', async () => {
    const pairServer = createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        const body = JSON.parse(raw)
        res.writeHead(body.code === 'ABCD-EFGH' ? 200 : 401, { 'content-type': 'application/json' }).end(JSON.stringify(body.code === 'ABCD-EFGH' ? { token: TOKEN } : { error: 'invalid_code' }))
      })
    })
    await new Promise<void>((resolve) => pairServer.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(pairServer.address() as { port: number }).port}`
    const run = (args: string[]) =>
      new Promise<{ code: number; out: string }>((resolve) =>
        execFile(process.execPath, [BIN, ...args], { env: env() }, (error, stdout, stderr) => resolve({ code: error ? Number(error.code) : 0, out: stdout + stderr })),
      )
    try {
      expect((await run(['pair', 'WRONG-CODE', '--url', url, '--signal-cli', FAKE_SIGNAL])).code).toBe(1)
      const ok = await run(['pair', 'ABCD-EFGH', '--url', url, '--signal-cli', FAKE_SIGNAL])
      expect(ok.out).toContain(`Paired with ${url}`)
      expect(ok.out).toContain('account …01')
      expect(readFileSync(join(home, 'config', 'token'), 'utf8').trim()).toBe(TOKEN)
      if (process.platform !== 'win32') {
        const { statSync } = await import('node:fs')
        expect(statSync(join(home, 'config', 'token')).mode & 0o777).toBe(0o600)
        expect(statSync(join(home, 'config')).mode & 0o777).toBe(0o700)
      }
      expect((await run(['pair', 'ABCD-EFGH', '--url', 'http://example.com'])).out).toContain('https://')
    } finally {
      await new Promise((resolve) => pairServer.close(resolve))
    }
  }, 30_000)
})

describe('signal-cli answers', () => {
  it('are classified without ever guessing that a message did not go out', () => {
    expect(classifySend({ timestamp: 5, results: [{ type: 'SUCCESS' }] }, null)).toEqual({ outcome: 'sent', signalTimestamp: 5 })
    expect(classifySend({ results: [{ type: 'PROOF_REQUIRED_FAILURE', token: 't' }] }, null)).toEqual({ outcome: 'failed', reason: 'challenge', challenge: 't' })
    expect(classifySend({ results: [{ type: 'UNREGISTERED_FAILURE' }] }, null)).toMatchObject({ outcome: 'failed', reason: 'unregistered' })
    expect(classifySend({ results: [{ type: 'NETWORK_FAILURE' }] }, null)).toEqual({ outcome: 'unknown' })
    expect(classifySend(null, new SignalCliGone('exited'))).toEqual({ outcome: 'unknown' })
    expect(classifySend(null, null)).toEqual({ outcome: 'unknown' })
    expect(classifySend(null, Object.assign(new Error('CAPTCHA proof required for sending'), { data: null }))).toMatchObject({ reason: 'challenge' })
  })
})

describe('install-service', () => {
  it('writes a systemd user unit that restarts on failure but not after a revoked token', () => {
    const unit = unitFile('/usr/bin/node', '/home/me/tend/helper/bin/tend-helper.mjs')
    expect(unit).toContain('ExecStart=/usr/bin/node /home/me/tend/helper/bin/tend-helper.mjs run')
    expect(unit).toContain('Restart=on-failure')
    expect(unit).toContain('RestartPreventExitStatus=3')
    expect(unit).toContain('WantedBy=default.target')
  })

  it('on WSL, also keeps the distro running from Windows logon, with no administrator rights', () => {
    const steps = plan({
      node: '/usr/bin/node',
      script: '/x/tend-helper.mjs',
      env: { WSL_DISTRO_NAME: 'Ubuntu-24.04', XDG_CONFIG_HOME: '/home/me/.config' },
      platform: 'linux',
      localAppData: { win: 'C:\\Users\\me\\AppData\\Local', unix: '/mnt/c/Users/me/AppData/Local' },
    })
    expect(steps.files.map((f) => f.path)).toEqual(['/home/me/.config/systemd/user/tend-helper.service', '/mnt/c/Users/me/AppData/Local/tend-helper/tend-helper-autostart.js'])
    expect(steps.files[1]!.text).toContain(`.Run("wsl.exe -d \\"Ubuntu-24.04\\" --exec sleep infinity", 0, false)`)
    const commands = steps.commands.map(([cmd, args]) => [cmd, ...args].join(' '))
    expect(commands).toContain('systemctl --user enable --now tend-helper.service')
    expect(commands.some((c) => c.startsWith('loginctl enable-linger'))).toBe(true)
    expect(commands).toContain(
      'reg.exe add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v TendHelper /t REG_SZ /d wscript.exe //B //E:JScript "C:\\Users\\me\\AppData\\Local\\tend-helper\\tend-helper-autostart.js" /f',
    )
    expect(commands.some((c) => c.includes('schtasks'))).toBe(false)
    const undo = uninstallPlan({ env: { WSL_DISTRO_NAME: 'Ubuntu-24.04', XDG_CONFIG_HOME: '/home/me/.config' }, platform: 'linux', localAppData: { win: 'C:\\x', unix: '/mnt/c/x' } })
    expect(undo.commands.map(([cmd, args]) => [cmd, ...args].join(' '))).toEqual([
      'systemctl --user disable --now tend-helper.service',
      'reg.exe delete HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v TendHelper /f',
    ])
  })

  it('--dry-run changes nothing', async () => {
    const out = await new Promise<string>((resolve) =>
      execFile(process.execPath, [BIN, 'install-service', '--dry-run'], { env: { ...env(), WSL_DISTRO_NAME: '', XDG_CONFIG_HOME: join(home, 'xdg') } }, (_e, stdout) => resolve(stdout)),
    )
    expect(out).toContain('systemctl --user enable --now tend-helper.service')
    expect(existsSync(join(home, 'xdg'))).toBe(false)
  })
})
