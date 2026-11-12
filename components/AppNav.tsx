'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { BookIcon, GearIcon, HistoryIcon, PeopleIcon, SunIcon } from './icons'

const ITEMS = [
  { href: '/today', label: 'Today', Icon: SunIcon },
  { href: '/people', label: 'People', Icon: PeopleIcon },
  { href: '/library', label: 'Library', Icon: BookIcon },
  { href: '/history', label: 'History', Icon: HistoryIcon },
  { href: '/settings', label: 'Settings', Icon: GearIcon },
]

function isActive(pathname: string, href: string) {
  if (href === '/people') return pathname.startsWith('/people') || pathname.startsWith('/compose') || pathname.startsWith('/send')
  if (href === '/today') return pathname.startsWith('/today') || pathname.startsWith('/approve')
  return pathname.startsWith(href)
}

/** Top links on wide screens, a bottom tab bar on phones. */
export function AppNav() {
  const pathname = usePathname()
  return (
    <>
      <nav aria-label="Main" className="hidden md:block">
        <ul className="flex gap-1">
          {ITEMS.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link href={href} aria-current={isActive(pathname, href) ? 'page' : undefined} className="app-nav-link">
                <Icon className="size-[1.1rem]" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav
        aria-label="Main"
        className="app-tabbar fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {ITEMS.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href)
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className="app-tab"
                >
                  <span className="app-tab-icon">
                    <Icon className="size-[1.35rem]" />
                  </span>
                  {label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}
