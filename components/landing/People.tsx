/**
 * Hand-built illustrated people for the landing page and the sign-in dialog:
 * flat SVG busts with happy faces. Drawn here, not downloaded, so they share
 * one style, cost nothing, and stay crisp at every size.
 */

type Hair = 'short' | 'long' | 'bun' | 'curly' | 'receding'

export type Person = {
  name: string
  topic: string
  skin: string
  hair: string
  style: Hair
  shirt: string
  bg: string
  beard?: boolean
  glasses?: boolean
}

export const PEOPLE = [
  { name: 'Mum', topic: 'Hope', skin: '#e0ac85', hair: '#3b2418', style: 'long', shirt: '#d8735f', bg: '#fde3d6' },
  { name: 'Sam', topic: 'Courage', skin: '#8d5a3b', hair: '#1a1410', style: 'curly', shirt: '#5f93c4', bg: '#dbe9f6' },
  { name: 'Grandpa Joe', topic: 'Comfort', skin: '#f2d0b5', hair: '#c9c3bb', style: 'receding', shirt: '#2f6b4f', bg: '#dcefe3', beard: true, glasses: true },
  { name: 'Priya', topic: 'Joy', skin: '#c68a62', hair: '#1d1411', style: 'bun', shirt: '#e9a23b', bg: '#fbedcf' },
  { name: 'Lee', topic: 'Friendship', skin: '#f2d0b5', hair: '#c98f45', style: 'short', shirt: '#7a5cc0', bg: '#ece4f8' },
  { name: 'Auntie Ada', topic: 'Gratitude', skin: '#5c3a26', hair: '#0f0b09', style: 'bun', shirt: '#3c9a8f', bg: '#d9f0ec', glasses: true },
] as const satisfies readonly Person[]

const FEATURE = '#3a2a22'

function HairBack({ p }: { p: Person }) {
  if (p.style !== 'long') return null
  return <path d="M38 50C36 30 48 25 60 25C74 25 85 32 83 52C84 70 86 84 89 94C80 98 73 93 72 86H48C47 93 40 98 31 94C35 82 37 68 38 50Z" fill={p.hair} />
}

function HairFront({ p }: { p: Person }) {
  switch (p.style) {
    case 'short':
      return <path d="M39 53C36 35 47 27 60 27C74 27 84 35 81 53C78 44 71 39 62 40C53 41 45 44 39 53Z" fill={p.hair} />
    case 'long':
      return <path d="M40 51C41 34 51 29 61 30C71 31 80 37 80 51C74 42 64 38 56 40C49 42 44 46 40 51Z" fill={p.hair} />
    case 'bun':
      return (
        <>
          <circle cx="60" cy="25" r="9.5" fill={p.hair} />
          <path d="M40 51C39 36 49 31 60 31C71 31 81 36 80 51C75 42 67 39 60 39C53 39 45 42 40 51Z" fill={p.hair} />
        </>
      )
    case 'curly':
      return (
        <g fill={p.hair}>
          <circle cx="44" cy="44" r="9" />
          <circle cx="50" cy="35" r="10" />
          <circle cx="60" cy="31" r="10.5" />
          <circle cx="70" cy="35" r="10" />
          <circle cx="76" cy="44" r="9" />
          <circle cx="41" cy="53" r="5.5" />
          <circle cx="79" cy="53" r="5.5" />
        </g>
      )
    case 'receding':
      return (
        <g fill={p.hair}>
          <path d="M40 54C39 42 43 37 49 35C46 41 44 47 42 55Z" />
          <path d="M80 54C81 42 77 37 71 35C74 41 76 47 78 55Z" />
        </g>
      )
  }
}

/** One person, as a round avatar. Decorative: the page names them in text. */
export function Avatar({ person: p, className = 'size-12' }: { person: Person; className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={`shrink-0 rounded-full ${className}`} aria-hidden="true" focusable="false">
      <rect width="120" height="120" fill={p.bg} />
      <HairBack p={p} />
      <path d="M53 66h14v20H53z" fill={p.skin} />
      <path d="M17 124C17 99 35 85 60 85C85 85 103 99 103 124Z" fill={p.shirt} />
      <path d="M50 85Q60 99 70 85Z" fill={p.skin} />
      <circle cx="40.5" cy="57" r="4.5" fill={p.skin} />
      <circle cx="79.5" cy="57" r="4.5" fill={p.skin} />
      <ellipse cx="60" cy="55" rx="19.5" ry="21.5" fill={p.skin} />
      {p.beard ? <path d="M41 57C42 75 50 81 60 81C70 81 78 75 79 57C75 65 70 67 60 67C50 67 45 65 41 57Z" fill={p.hair} /> : null}
      <HairFront p={p} />
      <circle cx="48" cy="63" r="3.6" fill="#e5735f" opacity=".32" />
      <circle cx="72" cy="63" r="3.6" fill="#e5735f" opacity=".32" />
      <g fill="none" stroke={FEATURE} strokeWidth="2.3" strokeLinecap="round">
        <path d="M49 56q4-4.5 8 0M63 56q4-4.5 8 0" />
        {p.glasses ? (
          <g strokeWidth="1.8" opacity=".85">
            <circle cx="53" cy="56" r="6" />
            <circle cx="67" cy="56" r="6" />
            <path d="M59 56h2" />
          </g>
        ) : null}
        <path d="M53 64q7 7.5 14 0" stroke={p.beard ? '#fbf3ea' : FEATURE} />
      </g>
    </svg>
  )
}
