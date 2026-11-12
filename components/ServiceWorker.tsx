'use client'

import { useEffect } from 'react'

/**
 * Registers the service worker (public/sw.js) in production builds. The build
 * id in its URL makes every deploy install a new worker, which takes over at
 * once and clears the previous version's cache (see public/sw.js).
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    const version = encodeURIComponent(process.env.NEXT_PUBLIC_BUILD_ID || 'dev')
    navigator.serviceWorker.register(`/sw.js?v=${version}`, { scope: '/', updateViaCache: 'none' }).catch(() => {
      // Without it Tend still works; it just cannot open offline or show notifications.
    })
  }, [])
  return null
}
