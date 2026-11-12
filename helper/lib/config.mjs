// Where tend-helper keeps its settings, device token and journal, and how it
// reads and writes them. Every file is private to the user (mode 600, in
// folders of mode 700). On native Windows the token is also protected with
// DPAPI for the current user (./dpapi.mjs).
//
//   Linux and WSL:  ~/.config/tend-helper/{config.json,token}
//                   ~/.local/state/tend-helper/{journal.jsonl,state.json}
//   Windows:        %APPDATA%\tend-helper\...   %LOCALAPPDATA%\tend-helper\...
//   Tests:          TEND_HELPER_HOME=<dir> puts both under that folder.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { protect, unprotect } from './dpapi.mjs'

const windows = process.platform === 'win32'

export function paths(env = process.env) {
  if (env.TEND_HELPER_HOME) {
    return { config: join(env.TEND_HELPER_HOME, 'config'), state: join(env.TEND_HELPER_HOME, 'state') }
  }
  if (windows) {
    return {
      config: join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'tend-helper'),
      state: join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'tend-helper'),
    }
  }
  return {
    config: join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'tend-helper'),
    state: join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'tend-helper'),
  }
}

function privateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (!windows) chmodSync(dir, 0o700)
}

/** Writes a file only the user can read, atomically (a temporary file, then rename). */
export function writePrivate(file, text) {
  privateDir(dirname(file))
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, text, { mode: 0o600 })
  if (!windows) chmodSync(temp, 0o600)
  renameSync(temp, file)
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** { url, account, signalCli, signalCliConfig }: where Tend is, and which signal-cli and account to use. */
export function readConfig(env = process.env) {
  return readJsonFile(join(paths(env).config, 'config.json'), {})
}

export function writeConfig(config, env = process.env) {
  writePrivate(join(paths(env).config, 'config.json'), `${JSON.stringify(config, null, 2)}\n`)
}

export function readToken(env = process.env) {
  const file = join(paths(env).config, 'token')
  if (!existsSync(file)) return null
  const stored = readFileSync(file, 'utf8').trim()
  const token = windows && !env.TEND_HELPER_HOME ? unprotect(stored) : stored
  return /^tdh_[A-Za-z0-9_-]{43}$/.test(token ?? '') ? token : null
}

export function writeToken(token, env = process.env) {
  const stored = windows && !env.TEND_HELPER_HOME ? protect(token) : token
  writePrivate(join(paths(env).config, 'token'), `${stored}\n`)
}

/** Local state the helper keeps between runs: halted (after a captcha) and the challenge token. */
export function readState(env = process.env) {
  return readJsonFile(join(paths(env).state, 'state.json'), {})
}

export function writeState(state, env = process.env) {
  writePrivate(join(paths(env).state, 'state.json'), `${JSON.stringify(state, null, 2)}\n`)
}

export function journalFile(env = process.env) {
  return join(paths(env).state, 'journal.jsonl')
}

/** Tend's address: https only, except localhost (development and tests). */
export function validTendUrl(value) {
  try {
    const url = new URL(value)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.username || url.password || url.search || url.hash) return null
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null
    return url.origin
  } catch {
    return null
  }
}

export const DEFAULT_URL = 'https://tend.n8builds.dev'
