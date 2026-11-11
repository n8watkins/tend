'use client'

import { useEffect } from 'react'

/** Keeps the browser's time zone in a cookie, the default for new settings and contacts. */
export function TimezoneCookie() {
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (tz) document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`
    } catch {
      // No time zone support: the server falls back to UTC.
    }
  }, [])
  return null
}
