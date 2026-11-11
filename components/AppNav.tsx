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
  return pathname.startsWith(href)
}

/** Top links on wide screens, a bottom tab bar on phones. */
export function AppNav() {
  const pathname = usePathname()
  return (
    <>
      <nav aria-label="Main" className="hidden md:block">
        <ul className="flex gap-1">
          {ITEMS.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive(pathname, href) ? 'page' : undefined}
                className="btn btn-ghost btn-sm aria-[current=page]:bg-surface-2"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {ITEMS.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href)
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium no-underline ${active ? 'text-accent' : 'text-muted'}`}
                >
                  <Icon className="size-6" />
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
