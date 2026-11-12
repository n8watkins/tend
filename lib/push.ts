/**
 * Web Push helpers shared by the server and its tests: which push services a
 * subscription may point at, the reminder notification's text, and a short
 * device label. lib/server/push.ts sends; public/sw.js shows.
 */

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
}

export function reminderPush(items: PushItem[]): PushPayload {
  const first = items[0]!
  if (items.length === 1) {
    return {
      title: first.kind === 'consent_request' ? `Time to ask ${first.contactName}` : `Time to message ${first.contactName}`,
      body: 'Your message is ready. Open it, copy it, and send it on Signal.',
      url: `/send/${first.id}`,
      tag: 'tend-reminder',
    }
  }
  const names = items.map((m) => m.contactName)
  const listed = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return {
    title: `${items.length} messages are ready to send`,
    body: `For ${listed}. Open Tend to send them on Signal.`,
    url: '/today',
    tag: 'tend-reminder',
  }
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
