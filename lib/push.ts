/**
 * Web Push helpers shared by the server and its tests: which push services a
 * subscription may point at, the reminder notification's text, and a short
 * device label. lib/server/push.ts sends; public/sw.js shows.
 */

import { nudgeTitle, type NudgeLine } from './occasions'

/** Hosts of the browsers' push services. Anything else is refused, so the server only ever posts there. */
const PUSH_HOSTS = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']

/**
 * True for an https endpoint at a known push service. In the end-to-end
 * suite (APP_ENV=test), also the local push mock given by PUSH_TEST_BASE.
 */
export function allowedEndpoint(endpoint: string, env: Record<string, string | undefined> = process.env): boolean {
  if (endpoint.length > 1024) return false
  if (env.APP_ENV === 'test' && env.PUSH_TEST_BASE && endpoint.startsWith(`${env.PUSH_TEST_BASE}/`)) return true
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false
  return PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
}

export interface PushItem {
  id: string
  contactName: string
  kind: string
}

export interface PushPayload {
  title: string
  body: string
  /** The page a tap opens: the send screen for one message, Today for several. */
  url: string
  tag: string
  /** Buttons on the notification (Chrome and Edge show them; Safari and Firefox do not). */
  actions?: { action: 'send' | 'skip'; title: string }[]
  /** For the buttons: the message and a token that lets them act on it without a signed-in tab. */
  approval?: { id: string; token: string }
}

/** Notification bodies are short on phones; the approve page shows the whole message. */
export const APPROVAL_PREVIEW_CHARS = 120

function preview(text: string, max = APPROVAL_PREVIEW_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/** "Send to Sam?" with Send and Skip (docs/SIGNAL-HELPER.md 3.1). */
export function approvalPush(item: { id: string; contactName: string; body: string; token: string; helperOffline: boolean }): PushPayload {
  return {
    title: `Send to ${item.contactName}?`,
    body: item.helperOffline ? `${preview(item.body)}\nYour helper is offline; you can still send it yourself.` : preview(item.body),
    url: `/approve/${item.id}`,
    tag: `tend-approval-${item.id}`,
    actions: [
      { action: 'send', title: 'Send' },
      { action: 'skip', title: 'Skip' },
    ],
    approval: { id: item.id, token: item.token },
  }
}

/** What the helper did, or why it could not (no buttons). */
export function helperNoticePush(
  kind: 'sent' | 'unknown' | 'failed' | 'expired' | 'challenge',
  item: { id: string; contactName: string } | null,
): PushPayload {
  const name = item?.contactName ?? 'them'
  const url = item ? `/approve/${item.id}` : '/settings#helper'
  const tag = item ? `tend-approval-${item.id}` : 'tend-helper'
  switch (kind) {
    case 'sent':
      return { title: `Sent to ${name}`, body: 'Your helper sent it on Signal.', url, tag }
    case 'unknown':
      return { title: `Not sure it reached ${name}`, body: `Check your Signal chat with ${name}, then tell Tend whether it was sent.`, url, tag }
    case 'failed':
      return { title: `Not sent to ${name}`, body: 'Your helper could not send it. Send it yourself, or try again.', url, tag }
    case 'expired':
      return { title: `Not sent to ${name}`, body: 'Your PC was off. Send it yourself or reschedule.', url: item ? `/send/${item.id}` : '/today', tag }
    case 'challenge':
      return { title: 'Your helper stopped sending', body: 'Signal asked for a captcha. Nothing will be sent until you solve it and resume.', url, tag }
  }
}

/**
 * The Web Push Topic header (at most 32 URL-safe characters): a newer push
 * with the same topic replaces one not yet delivered. Each approval has its
 * own, so one message's request never replaces another's.
 */
export function pushTopic(payload: PushPayload): string {
  if (payload.approval) return `ap${payload.approval.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 30)}`
  return payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'tend'
}

const NUDGE_BODY: Record<NudgeLine['kind'], string> = {
  birthday: 'Open Tend for a blessing to send, or write your own.',
  anniversary: 'Open Tend for something to send them, or write your own.',
  cadence: 'It has been a while. Open Tend for something to send.',
}

/** The notification for a run's due messages and birthday, anniversary and keep-in-touch reminders. */
export function reminderPush(items: PushItem[], nudges: NudgeLine[] = []): PushPayload {
  if (nudges.length) {
    if (!items.length && nudges.length === 1) {
      const n = nudges[0]!
      return { title: nudgeTitle(n), body: NUDGE_BODY[n.kind], url: n.path, tag: 'tend-reminder' }
    }
    const names = [...new Set([...items.map((m) => m.contactName), ...nudges.map((n) => n.contactName)])]
    const total = items.length + nudges.length
    return {
      title: `${total} reminders from Tend`,
      body: `For ${listNames(names)}. Open Tend to see them.`,
      url: '/today',
      tag: 'tend-reminder',
    }
  }
  const first = items[0]!
  if (items.length === 1) {
    return {
      title: first.kind === 'consent_request' ? `Time to ask ${first.contactName}` : `Time to message ${first.contactName}`,
      body: 'Your message is ready. Open it, copy it, and send it on Signal.',
      url: `/send/${first.id}`,
      tag: 'tend-reminder',
    }
  }
  return {
    title: `${items.length} messages are ready to send`,
    body: `For ${listNames(items.map((m) => m.contactName))}. Open Tend to send them on Signal.`,
    url: '/today',
    tag: 'tend-reminder',
  }
}

/** "Ana", "Ana and Ben", "Ana, Ben and Cy", "Ana, Ben, Cy and 2 more". */
function listNames(names: string[]): string {
  if (names.length === 1) return names[0]!
  if (names.length > 3) return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** "Chrome on Android", "Safari on iPhone"...: enough to tell devices apart in Settings. */
export function deviceLabel(userAgent: string): string {
  const ua = userAgent || ''
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : null
  const browser = /EdgA?\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser\//.test(ua)
      ? 'Samsung Internet'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null
  if (browser && os) return `${browser} on ${os}`
  return browser ?? os ?? 'A browser'
}
