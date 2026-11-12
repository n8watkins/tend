/**
 * The installable app in the browser: whether Tend can be installed here and
 * how, and the install prompt itself. Client components only.
 *
 * Chrome and Android fire `beforeinstallprompt` once Tend is installable; the
 * root layout's inline script (lib/install-capture.ts) keeps that event on window
 * from the first moment, so a prompt that fires before React hydrates is not
 * lost. iOS has no prompt: there, people add Tend from the Share menu.
 */

import { useSyncExternalStore } from 'react'

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window {
    __tendInstall?: BeforeInstallPromptEvent | null
  }
  interface Navigator {
    standalone?: boolean
  }
}

/**
 * - installed: running as the installed app (or just installed);
 * - prompt: the browser offers an install prompt (Chrome, Edge, Android);
 * - ios: iPhone or iPad, where Share, then Add to Home Screen, installs it;
 * - manual: anything else (no prompt now: Firefox, or already installed in Chrome);
 * - unknown: on the server, before the browser is known.
 */
export type InstallState = 'installed' | 'prompt' | 'ios' | 'manual' | 'unknown'

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
}

export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

let justInstalled = false

function installState(): InstallState {
  if (justInstalled || isStandalone()) return 'installed'
  if (window.__tendInstall) return 'prompt'
  if (isIos()) return 'ios'
  return 'manual'
}

function subscribe(onChange: () => void) {
  const standalone = window.matchMedia('(display-mode: standalone)')
  const installed = () => {
    justInstalled = true
    onChange()
  }
  window.addEventListener('tend:install', onChange)
  window.addEventListener('appinstalled', installed)
  standalone.addEventListener('change', onChange)
  return () => {
    window.removeEventListener('tend:install', onChange)
    window.removeEventListener('appinstalled', installed)
    standalone.removeEventListener('change', onChange)
  }
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, installState, () => 'unknown')
}

/** Shows the browser's install prompt; true when the person accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = window.__tendInstall
  if (!event) return false
  window.__tendInstall = null
  await event.prompt()
  const { outcome } = await event.userChoice
  if (outcome === 'accepted') justInstalled = true
  window.dispatchEvent(new Event('tend:install'))
  return outcome === 'accepted'
}

/* The one-time install hint ------------------------------------------------- */

const HINT_KEY = 'tend:install-hint'

export function hintDismissed(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === 'done'
  } catch {
    return false
  }
}

export function dismissHint(): void {
  try {
    window.localStorage.setItem(HINT_KEY, 'done')
  } catch {
    // Private mode: the hint simply shows again next time.
  }
}

/** A phone or tablet: a touch screen as the main pointer. */
export function isMobile(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
}
