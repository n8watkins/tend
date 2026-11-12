#!/usr/bin/env node
// tend-helper: sends the Signal messages you approve in Tend, from your own
// Signal, on your own computer (docs/SIGNAL-HELPER.md). It wraps signal-cli,
// linked to your account as a secondary device, and talks to Tend only
// through outbound HTTPS with a device token.

import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { Revoked, TendApi } from '../lib/api.mjs'
import { DEFAULT_URL, journalFile, paths, readConfig, readState, readToken, validTendUrl, writeConfig, writeState, writeToken } from '../lib/config.mjs'
import { doctor, masked } from '../lib/doctor.mjs'
import { Journal } from '../lib/journal.mjs'
import { log, setLogSink } from '../lib/log.mjs'
import { Runner, stopSwitch } from '../lib/runner.mjs'
import { apply, plan, serviceActive, setService, uninstallPlan, windowsLocalAppData } from '../lib/service.mjs'
import { listAccounts, SignalCli, signalCliVersion } from '../lib/signal-cli.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const VERSION = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version
const SCRIPT = fileURLToPath(import.meta.url)

const HELP = `tend-helper ${VERSION}: sends the Signal messages you approve in Tend.

  tend-helper pair <code>         Pair with Tend (get the code in Settings, Signal helper)
      --url <url>                 Your Tend (default ${DEFAULT_URL})
      --account <+number>         The signal-cli account, if there is more than one
      --signal-cli <path>         signal-cli's full path (default: found on PATH)
      --signal-cli-config <dir>   signal-cli's data folder, if not the default
  tend-helper doctor [--send-test]  Check everything; --send-test sends a Note to Self
  tend-helper run [--once]        Poll Tend and send what you approved (the service runs this)
  tend-helper install-service [--dry-run]    Run it in the background, from logon
  tend-helper uninstall-service [--dry-run]
  tend-helper captcha <token>     After Signal asked for a captcha (signalcaptchas.org)
  tend-helper resume              Allow sending again on this computer
  tend-helper status              What this helper knows, briefly
`

function fail(text, code = 1) {
  console.error(text)
  process.exit(code)
}

function findOnPath(name) {
  for (const dir of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    for (const ext of process.platform === 'win32' ? ['.exe', '.bat', '.cmd', ''] : ['']) {
      const candidate = join(dir, name + ext)
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch {
        // not here
      }
    }
  }
  return null
}

async function pair(args) {
  const code = args.positionals[1]
  if (!code) fail('Usage: tend-helper pair <code>')
  const config = readConfig()
  const url = validTendUrl(args.values.url ?? config.url ?? DEFAULT_URL)
  if (!url) fail('The Tend address must start with https:// (http:// only for localhost).')
  const signalCli = args.values['signal-cli'] ?? config.signalCli ?? findOnPath('signal-cli')
  const signalCliConfig = args.values['signal-cli-config'] ?? config.signalCliConfig
  let account = args.values.account ?? config.account ?? null
  if (account && !/^\+[1-9]\d{6,14}$/.test(account)) fail('Give the account as an international number, like +15551234567.')
  if (!account && signalCli) {
    const accounts = await listAccounts(signalCli, signalCliConfig)
    if (accounts.length === 1) account = accounts[0]
    else if (accounts.length > 1) fail('signal-cli has several accounts here. Choose one with --account +15551234567.')
  }
  const token = await TendApi.pair(url, code, `tend-helper on ${hostname()}`.slice(0, 60), VERSION).catch((error) => fail(error.message))
  writeToken(token)
  writeConfig({ ...config, url, account: account ?? undefined, signalCli: signalCli ?? undefined, signalCliConfig: signalCliConfig ?? undefined })
  console.log(`Paired with ${url}.`)
  if (!signalCli) console.log('signal-cli was not found on PATH. Install it, then run: tend-helper pair <new code> --signal-cli /path/to/signal-cli')
  else if (!account) console.log('No linked Signal account yet. Link signal-cli (docs/SIGNAL-HELPER.md 7.2), then run tend-helper doctor.')
  else console.log(`Using signal-cli at ${signalCli}, account ${masked(account)}.`)
  console.log('Next: tend-helper doctor --send-test, then tend-helper install-service.')
}

/** On native Windows there is no journald: the log goes to a file next to the journal, rotated at 1 MB. */
function fileLog() {
  const file = join(paths().state, 'helper.log')
  mkdirSync(dirname(file), { recursive: true })
  setLogSink((line) => {
    try {
      if (statSync(file).size > 1_000_000) renameSync(file, `${file}.1`)
    } catch {
      // no file yet
    }
    appendFileSync(file, `${line}\n`, { mode: 0o600 })
  })
}

async function run(args) {
  if (process.platform === 'win32') fileLog()
  const config = readConfig()
  const token = readToken()
  if (!config.url || !token) {
    log('not_paired')
    fail('Not paired. Run: tend-helper pair <code>', 3)
  }
  const binary = config.signalCli || 'signal-cli'
  let account = config.account
  if (!account) {
    const accounts = await listAccounts(binary, config.signalCliConfig)
    if (accounts.length !== 1) {
      log('no_account', { count: accounts.length })
      fail('No single linked Signal account. Run tend-helper doctor.')
    }
    account = accounts[0]
  }
  const api = new TendApi({ url: config.url, token, version: VERSION, signalCliVersion: await signalCliVersion(binary) })
  const runner = new Runner({
    api,
    openSignal: () => new SignalCli({ binary, account, configDir: config.signalCliConfig }),
    journal: new Journal(journalFile()),
    state: { read: () => readState(), write: (s) => writeState(s) },
    version: VERSION,
  })
  if (args.values.once) {
    try {
      const status = await runner.cycle()
      console.log(status)
    } catch (error) {
      if (!(error instanceof Revoked)) throw error
      log('revoked')
      console.error('This helper was removed in Tend. Pair again to use it: tend-helper pair <code>')
      process.exitCode = 3
    } finally {
      await runner.close()
    }
    return
  }
  const stop = stopSwitch()
  process.on('SIGTERM', () => stop.trigger())
  process.on('SIGINT', () => stop.trigger())
  const code = await runner.loop(stop)
  await runner.close()
  process.exit(code)
}

async function captcha(args) {
  const raw = args.positionals[1]
  if (!raw) fail('Usage: tend-helper captcha <token from signalcaptchas.org>')
  const state = readState()
  if (!state.challengeToken) fail('No captcha is waiting. If sending is stopped for another reason, run tend-helper doctor.')
  const config = readConfig()
  const binary = config.signalCli || 'signal-cli'
  const account = config.account ?? (await listAccounts(binary, config.signalCliConfig))[0]
  if (!account) fail('No linked Signal account. Run tend-helper doctor.')
  const wasRunning = serviceActive()
  if (wasRunning) setService('stop')
  const signal = new SignalCli({ binary, account, configDir: config.signalCliConfig })
  try {
    await signal.submitRateLimitChallenge(state.challengeToken, raw.replace(/^signalcaptcha:\/\//, ''))
    writeState({ ...state, halted: false, haltReason: null, challengeToken: null, haltedAt: null })
    console.log('Signal accepted the captcha. Now resume sending in Tend: Settings, Signal helper, Resume sending.')
  } catch (error) {
    console.error(`Signal did not accept it (${error?.code ?? 'error'}). Solve a new captcha and try again.`)
    process.exitCode = 1
  } finally {
    await signal.close()
    if (wasRunning) setService('start')
  }
}

function resume() {
  const state = readState()
  writeState({ ...state, halted: false, haltReason: null, haltedAt: null })
  console.log(state.halted ? 'Sending is allowed again on this computer. Also resume it in Tend: Settings, Signal helper.' : 'Sending was not stopped here.')
}

function status() {
  const config = readConfig()
  const state = readState()
  const journal = new Journal(journalFile())
  console.log(`tend-helper ${VERSION}`)
  console.log(`Tend:        ${config.url ?? 'not paired'}${readToken() ? '' : ' (no token)'}`)
  console.log(`signal-cli:  ${config.signalCli ?? 'signal-cli on PATH'}, account ${masked(config.account)}`)
  console.log(`Sending:     ${state.halted ? `stopped (${state.haltReason})` : 'allowed'}`)
  console.log(`Unsettled:   ${journal.pending().length}`)
  console.log(`Last 24 h:   ${journal.startedSince(Date.now() - 24 * 60 * 60 * 1000)} send(s)`)
}

let args
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      account: { type: 'string' },
      'signal-cli': { type: 'string' },
      'signal-cli-config': { type: 'string' },
      'send-test': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      once: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
} catch (error) {
  fail(`${error.message}\n\n${HELP}`)
}

const command = args.values.version ? 'version' : args.values.help ? 'help' : args.positionals[0]
switch (command) {
  case 'pair':
    await pair(args)
    break
  case 'doctor':
    process.exitCode = (await doctor({ version: VERSION, sendTest: Boolean(args.values['send-test']) })) ? 0 : 1
    break
  case 'run':
    await run(args)
    break
  case 'install-service':
  case 'uninstall-service': {
    const localAppData = process.env.WSL_DISTRO_NAME ? windowsLocalAppData() : null
    const steps = command === 'install-service' ? plan({ script: SCRIPT, localAppData }) : uninstallPlan({ localAppData })
    const ok = apply(steps, { dryRun: Boolean(args.values['dry-run']) })
    if (!args.values['dry-run']) console.log(ok ? 'Done.' : 'Some steps failed (see above).')
    process.exitCode = ok ? 0 : 1
    break
  }
  case 'captcha':
    await captcha(args)
    break
  case 'resume':
    resume()
    break
  case 'status':
    status()
    break
  case 'version':
    console.log(VERSION)
    break
  default:
    console.log(HELP)
    if (command && command !== 'help') process.exitCode = 1
}
