/* Tend's service worker (docs/SPEC.md section 15). Kept small on purpose.
 *
 * - The app shell (the offline page, icons) is cached per version. The
 *   version is the build id in the script URL (/sw.js?v=<build>), so every
 *   deploy installs a new worker, which takes over at once and deletes the
 *   previous version's shell.
 * - Built files under /_next/static/ have content hashes in their names and
 *   never change, so they are served from the cache first.
 * - Pages and the API always go to the network and are never cached: they
 *   carry the user's people and messages. A page that cannot load offline
 *   gets the offline page instead.
 * - Push: shows a reminder notification; tapping it opens the message.
 */

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev'
const SHELL = `tend-shell-${VERSION}`
const STATIC = 'tend-static'
const STATIC_MAX_ENTRIES = 200
const OFFLINE_URL = '/offline.html'
const SHELL_URLS = [OFFLINE_URL, '/icons/icon-192.png', '/icons/badge-96.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name.startsWith('tend-shell-') && name !== SHELL).map((name) => caches.delete(name)))
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(navigate(event))
    return
  }
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request))
  }
  // Everything else (API calls, page data, images) goes to the network as usual.
})

/** Pages: always the network (never cached); the offline page when there is none. */
async function navigate(event) {
  try {
    const preloaded = await event.preloadResponse
    if (preloaded) return preloaded
    return await fetch(event.request)
  } catch {
    const offline = await caches.match(OFFLINE_URL, { cacheName: SHELL })
    return offline || (await caches.match(OFFLINE_URL)) || Response.error()
  }
}

/** Hashed build files: the cache, else the network (and keep a copy). */
async function cacheFirst(request) {
  const cache = await caches.open(STATIC)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone())
    trim(cache)
  }
  return response
}

/** Keeps the static cache from growing without end across deploys: oldest entries go first. */
async function trim(cache) {
  const keys = await cache.keys()
  for (const key of keys.slice(0, Math.max(0, keys.length - STATIC_MAX_ENTRIES))) await cache.delete(key)
}

/* Push reminders (lib/server/push.ts sends them) --------------------------- */

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Tend'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : 'A message is ready to send.',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: typeof data.tag === 'string' ? data.tag : 'tend-reminder',
      renotify: true,
      data: { url: typeof data.url === 'string' ? data.url : '/today' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Only ever opens a page of Tend itself.
  const target = new URL(event.notification.data?.url || '/today', self.location.origin)
  const url = target.origin === self.location.origin ? target.href : new URL('/today', self.location.origin).href
  event.waitUntil(
    (async () => {
      // Reuse an open Tend window (the installed app's, usually); else open one.
      const [client] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (client) {
        const navigated = await client.navigate(url).catch(() => null)
        if (navigated) {
          await navigated.focus()
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
