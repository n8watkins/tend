// `tend-helper install-service` and `uninstall-service` (docs/SIGNAL-HELPER.md 7.4).
//
// Linux and WSL: a systemd user unit (Restart=on-failure; exit code 3, a
// revoked token, is not restarted), plus `loginctl enable-linger` so it runs
// without a login shell.
//
// WSL: Windows stops the distro when no Windows process uses it, so a small
// script starts `wsl.exe -d <distro> --exec sleep infinity` in a hidden
// window at every Windows logon. It is started from the user's own Run key
// (HKCU\...\Run), because a Task Scheduler logon task needs administrator
// rights; the script runs with the JScript engine named explicitly
// (wscript //E:JScript), so a changed .js file association cannot break it.
//
// Native Windows: the same Run key starts the helper itself in a hidden window.
//
// Every step is printed first; --dry-run prints them and changes nothing.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join, win32 } from 'node:path'

export const UNIT_NAME = 'tend-helper.service'
export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
export const RUN_VALUE = 'TendHelper'
const SCRIPT_NAME = 'tend-helper-autostart.js'

/** A JScript line for WScript.Shell.Run: the command in a hidden window, not waited for. */
export function autostartScript(command) {
  return [
    '// Started at Windows logon by tend-helper install-service (HKCU Run key).',
    `new ActiveXObject('WScript.Shell').Run(${JSON.stringify(command)}, 0, false)`,
    '',
  ].join('\r\n')
}

/** %LOCALAPPDATA% as Windows and as WSL paths, asked from Windows itself. */
export function windowsLocalAppData() {
  try {
    const win = execFileSync('cmd.exe', ['/d', '/c', 'echo %LOCALAPPDATA%'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], cwd: '/' }).trim()
    if (!/^[A-Za-z]:\\/.test(win)) return null
    const unix = execFileSync('wslpath', ['-u', win], { encoding: 'utf8' }).trim()
    return { win, unix }
  } catch {
    return null
  }
}

/** @returns {Command[]} */
function runKeyCommands(scriptWin) {
  const launch = `wscript.exe //B //E:JScript "${scriptWin}"`
  return [
    ['reg.exe', ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', launch, '/f']],
    ['wscript.exe', ['//B', '//E:JScript', scriptWin]],
  ]
}

export function unitFile(node, script) {
  return [
    '[Unit]',
    'Description=Tend helper: sends the Signal messages you approve in Tend',
    'Wants=network-online.target',
    'After=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${quote(node)} ${quote(script)} run`,
    'Restart=on-failure',
    'RestartSec=30',
    // 3: the token was revoked ("Remove helper" in Tend). Pair again to start.
    'RestartPreventExitStatus=3',
    'NoNewPrivileges=yes',
    'PrivateTmp=yes',
    'UMask=0077',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n')
}

function quote(value) {
  return /\s/.test(value) ? `"${value}"` : value
}

export function unitPath(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user', UNIT_NAME)
}

/** @typedef {[string, string[]]} Command */
/** @typedef {{ files: { path: string, text: string }[], commands: Command[], remove?: string[], after?: Command[] }} Steps */
/** @typedef {{ node?: string, script?: string, env?: Record<string, string | undefined>, platform?: string, localAppData?: { win: string, unix: string } | null }} PlanOptions */

/**
 * The steps for this computer: files to write and commands to run.
 * `localAppData` is Windows' %LOCALAPPDATA% ({ win, unix }), needed on WSL and Windows.
 * @param {PlanOptions} [options]
 * @returns {Steps}
 */
export function plan({ node = process.execPath, script = '', env = process.env, platform = process.platform, localAppData = null } = {}) {
  if (platform === 'win32') {
    const dir = env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    const file = win32.join(dir, 'tend-helper', SCRIPT_NAME)
    return {
      files: [{ path: file, text: autostartScript(`"${node}" "${script}" run`) }],
      commands: runKeyCommands(file),
    }
  }
  const files = [{ path: unitPath(env), text: unitFile(node, script) }]
  /** @type {Command[]} */
  const commands = [
    ['systemctl', ['--user', 'daemon-reload']],
    ['systemctl', ['--user', 'enable', '--now', UNIT_NAME]],
    ['loginctl', ['enable-linger', userInfo().username]],
  ]
  if (env.WSL_DISTRO_NAME) {
    if (!localAppData) throw new Error('Could not find %LOCALAPPDATA% from WSL (is Windows interop on?)')
    const fileWin = win32.join(localAppData.win, 'tend-helper', SCRIPT_NAME)
    files.push({ path: join(localAppData.unix, 'tend-helper', SCRIPT_NAME), text: autostartScript(`wsl.exe -d "${env.WSL_DISTRO_NAME}" --exec sleep infinity`) })
    commands.push(...runKeyCommands(fileWin))
  }
  return { files, commands }
}

/**
 * @param {PlanOptions} [options]
 * @returns {Steps}
 */
export function uninstallPlan({ env = process.env, platform = process.platform, localAppData = null } = {}) {
  /** @type {Command} */
  const deleteRunKey = ['reg.exe', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f']]
  if (platform === 'win32') {
    const dir = env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    return { files: [], commands: [deleteRunKey], remove: [win32.join(dir, 'tend-helper', SCRIPT_NAME)] }
  }
  /** @type {Command[]} */
  const commands = [['systemctl', ['--user', 'disable', '--now', UNIT_NAME]]]
  const remove = [unitPath(env)]
  if (env.WSL_DISTRO_NAME) {
    commands.push(deleteRunKey)
    if (localAppData) remove.push(join(localAppData.unix, 'tend-helper', SCRIPT_NAME))
  }
  return { files: [], commands, remove, after: [['systemctl', ['--user', 'daemon-reload']]] }
}

function show([cmd, args]) {
  return [cmd, ...args.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a))].join(' ')
}

/** Prints, then (unless dryRun) does each step. Returns false if a command failed. */
export function apply(steps, { dryRun = false, print = console.log } = {}) {
  let ok = true
  for (const file of steps.files ?? []) {
    print(`write ${file.path}`)
    if (!dryRun) {
      mkdirSync(join(file.path, '..'), { recursive: true })
      writeFileSync(file.path, file.text, { mode: 0o644 })
    }
  }
  for (const step of [...(steps.commands ?? [])]) {
    print(`run   ${show(step)}`)
    if (!dryRun) ok = run(step, print) && ok
  }
  for (const path of steps.remove ?? []) {
    print(`remove ${path}`)
    if (!dryRun && existsSync(path)) rmSync(path)
  }
  for (const step of steps.after ?? []) {
    print(`run   ${show(step)}`)
    if (!dryRun) ok = run(step, print) && ok
  }
  return ok
}

function run([cmd, args], print) {
  try {
    execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    return true
  } catch (error) {
    print(`      failed: ${String(error.stderr ?? error.message).trim().split('\n')[0]}`)
    return false
  }
}

/** Whether the systemd user service is running now (Linux and WSL). */
export function serviceActive() {
  if (process.platform === 'win32') return false
  try {
    return execFileSync('systemctl', ['--user', 'is-active', UNIT_NAME], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'active'
  } catch {
    return false
  }
}

export function setService(action) {
  if (process.platform === 'win32') return false
  try {
    execFileSync('systemctl', ['--user', action, UNIT_NAME], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
