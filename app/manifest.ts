import type { MetadataRoute } from 'next'

/**
 * The web app manifest (/manifest.webmanifest), which makes Tend installable
 * on phones and desktops. Colours come from app/globals.css; the icons are
 * rendered by scripts/render-icons.mjs. It opens on Today, which sends anyone
 * signed out to sign in.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Tend',
    short_name: 'Tend',
    description: 'Thoughtful messages for the people you care about, sent by you on Signal.',
    start_url: '/today',
    scope: '/',
    display: 'standalone',
    theme_color: '#2f6b4f',
    background_color: '#f7f5f0',
    lang: 'en',
    dir: 'ltr',
    categories: ['lifestyle', 'social'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Today', url: '/today', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'People', url: '/people', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  }
}
