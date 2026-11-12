// `tend-helper doctor` (docs/SIGNAL-HELPER.md 7.4 and 7.5): checks Node,
// signal-cli (found, its version and age), the linked account, where its
// keys live, the device token and Tend, the clock, and the service. With
// --send-test it also sends "Tend helper is connected." to your own Note to
// Self, the one message it may send without an approval.
//
// It prints to the terminal for the person running it; numbers are shown
// only by their last two digits.

import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { TendApi, Revoked, Unreachable } from './api.mjs'
import { readConfig, readState, readToken } from './config.mjs'
import { serviceActive } from './service.mjs'
import { listAccounts, SignalCli, signalCliVersion } from './signal-cli.mjs'

const DAY = 24 * 60 * 60 * 1000
export const SIGNAL_CLI_MAX_AGE_DAYS = 60

export const masked = (number) => (number ? `…${String(number).slice(-2)}` : 'none')

/** The release date of a signal-cli version from GitHub, or null when it cannot be found. */
async function releaseDate(version, fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(`https://api.github.com/repos/AsamK/signal-cli/releases/tags/v${version}`, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return null
    /** @type {any} */
    const data = await response.json()
    return data.published_at ? Date.parse(data.published_at) : null
  } catch {
    return null
  }
}

/** @param {{ version: string, sendTest?: boolean, print?: (line: string) => void, env?: NodeJS.ProcessEnv }} options */
export async function doctor({ version, sendTest = false, print = console.log, env = process.env }) {
  let failed = 0
  const ok = (text) => print(`  ok    ${text}`)
  const warn = (text) => print(`  warn  ${text}`)
  const fail = (text) => {
    failed++
    print(`  FAIL  ${text}`)
  }
  const config = readConfig(env)
  print(`tend-helper ${version}`)

  const major = Number(process.versions.node.split('.')[0])
  if (major >= 22) ok(`Node ${process.versions.node}`)
  else fail(`Node ${process.versions.node}: tend-helper needs Node 22 or later`)

  const binary = config.signalCli || 'signal-cli'
  const cliVersion = await signalCliVersion(binary)
  if (!cliVersion) fail(`signal-cli not found (${binary}). Install it (docs/SIGNAL-HELPER.md 7.1), or run: tend-helper pair <code> --signal-cli /path/to/signal-cli`)
  else {
    ok(`signal-cli ${cliVersion}`)
    const released = await releaseDate(cliVersion)
    if (released === null) warn('could not check how old this signal-cli is (no network to GitHub?)')
    else if (Date.now() - released > SIGNAL_CLI_MAX_AGE_DAYS * DAY) {
      warn(`signal-cli ${cliVersion} is ${Math.floor((Date.now() - released) / DAY)} days old. Signal stops accepting old clients: update it.`)
    } else ok(`signal-cli ${cliVersion} is ${Math.floor((Date.now() - released) / DAY)} days old`)
  }

  const accounts = cliVersion ? await listAccounts(binary, config.signalCliConfig) : []
  const account = config.account ?? (accounts.length === 1 ? accounts[0] : null)
  if (!account) fail(accounts.length > 1 ? 'several signal-cli accounts: choose one with tend-helper pair <code> --account +1...' : 'no linked Signal account: link signal-cli first (docs/SIGNAL-HELPER.md 7.2)')
  else if (!accounts.includes(account)) fail(`account ${masked(account)} is not in signal-cli on this computer`)
  else ok(`linked account ${masked(account)}`)

  const dataDir = config.signalCliConfig || join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'signal-cli')
  try {
    const stat = statSync(dataDir)
    if (dataDir.startsWith('/mnt/')) fail(`signal-cli's keys are on a Windows drive (${dataDir}); keep them inside WSL`)
    else if (process.platform !== 'win32' && stat.mode & 0o077) warn(`others can read ${dataDir}: run chmod -R go-rwx ${dataDir}`)
    else ok(`keys in ${dataDir}, private to you`)
  } catch {
    if (cliVersion) warn(`signal-cli's data folder not found at ${dataDir}`)
  }

  const token = readToken(env)
  if (!config.url || !token) fail('not paired: get a code in Tend (Settings, Signal helper) and run tend-helper pair <code>')
  else {
    const api = new TendApi({ url: config.url, token, version, signalCliVersion: cliVersion })
    const before = Date.now()
    try {
      const jobs = await api.jobs()
      ok(`paired with ${config.url}`)
      const skew = Math.abs(jobs.serverTime - (before + Date.now()) / 2)
      if (skew > 60_000) fail(`this computer's clock is ${Math.round(skew / 1000)} seconds off; fix the time`)
      else ok('clock is right')
      if (jobs.halted) warn(`Tend has stopped sending (${jobs.halted}): resume in Settings when it is solved`)
      if (jobs.paused) warn('Tend is paused')
    } catch (error) {
      if (error instanceof Revoked) fail('this helper was removed in Tend: pair again')
      else if (error instanceof Unreachable) fail(`cannot reach ${config.url}`)
      else fail('unexpected answer from Tend')
    }
  }

  const state = readState(env)
  if (state.halted) warn(`sending is stopped here (${state.haltReason}). After solving it: tend-helper captcha <token> (for a captcha) or tend-helper resume`)

  const running = serviceActive()
  if (process.platform !== 'win32') (running ? ok : warn)(running ? 'the service is running' : 'the service is not running: tend-helper install-service')

  if (sendTest) {
    if (running) warn('skipped the test message: stop the service first (systemctl --user stop tend-helper), then run doctor --send-test')
    else if (!cliVersion || !account) fail('cannot send the test message without signal-cli and an account')
    else {
      const signal = new SignalCli({ binary, account, configDir: config.signalCliConfig })
      try {
        const result = await signal.noteToSelf('Tend helper is connected.')
        if (Number.isSafeInteger(result?.timestamp)) ok('sent "Tend helper is connected." to your Note to Self: check Signal on your phone')
        else fail('the test message may not have gone out: check Note to Self in Signal')
      } catch (error) {
        fail(`the test message failed: ${error?.code ?? 'signal-cli error'}`)
      } finally {
        await signal.close()
      }
    }
  }
  print(failed ? `\n${failed} problem(s) to fix.` : '\nAll good.')
  return failed === 0
}
