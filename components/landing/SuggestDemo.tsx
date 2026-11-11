'use client'

import { useState } from 'react'

import { Avatar, type Person } from './People'

export type DemoItem = { id: string; heading: string; text: string; topics: string[] }
export type DemoPerson = { person: Person; topics: string[]; picks: DemoItem[] }

/**
 * The two ways Tend finds words, shown with the real library and the real
 * suggestion code (run on the server for made-up people): suggestions that
 * fit what someone cares about, and "Surprise me", a random passage.
 */
export function SuggestDemo({ people, pool }: { people: DemoPerson[]; pool: DemoItem[] }) {
  const [who, setWho] = useState(0)
  const [surprise, setSurprise] = useState(0)
  const current = people[who]!
  const pick = pool[surprise]!

  const next = () =>
    setSurprise((i) => {
      if (pool.length < 2) return i
      let n = i
      while (n === i) n = Math.floor(Math.random() * pool.length)
      return n
    })

  return (
    <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
      <div className="suggest-panel" data-reveal>
        <p className="eyebrow">Suggested for them</p>
        <h3 className="mt-2 text-xl font-semibold">Words that fit what they care about</h3>
        <p className="mt-2 text-muted">
          Choose a few topics for each person. Tend suggests passages and quotes that match, and never one they have had in the last six months.
        </p>
        <div role="group" aria-label="Choose a person" className="mt-5 flex flex-wrap gap-2">
          {people.map((p, i) => (
            <button key={p.person.name} type="button" className="who-chip" aria-pressed={i === who} onClick={() => setWho(i)}>
              <Avatar person={p.person} className="size-7" />
              {p.person.name}
            </button>
          ))}
        </div>
        <p className="mt-4 text-sm text-muted" aria-live="polite">
          {current.person.name} cares about{' '}
          {current.topics.map((t, i) => (
            <span key={t}>
              {i ? (i === current.topics.length - 1 ? ' and ' : ', ') : ''}
              <b className="text-ink">{t}</b>
            </span>
          ))}
          .
        </p>
        <ul className="mt-3 grid gap-3">
          {current.picks.map((item) => (
            <li key={item.id} className="suggest-item">
              <p className="text-sm font-semibold">{item.heading}</p>
              <p className="font-display mt-1 line-clamp-3 leading-snug">&ldquo;{item.text}&rdquo;</p>
              <span className="mt-2 flex flex-wrap gap-1.5">
                {item.topics.map((t) => (
                  <span key={t} className={`badge ${current.topics.includes(t.toLowerCase()) ? 'badge-good' : ''}`}>
                    {t}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="suggest-panel surprise-panel" data-reveal>
        <p className="eyebrow">Or leave it to chance</p>
        <h3 className="mt-2 text-xl font-semibold">Surprise me</h3>
        <p className="mt-2 text-muted">Not sure what to send? One tap picks a passage at random. It still skips anything they have had in the last six months.</p>
        <figure className="surprise-card mt-5" aria-live="polite">
          <blockquote key={pick.id} className="surprise-text font-display text-lg leading-snug sm:text-xl">
            &ldquo;{pick.text}&rdquo;
          </blockquote>
          <figcaption className="mt-3 text-sm font-semibold">{pick.heading}</figcaption>
        </figure>
        <button type="button" className="btn btn-primary mt-5" onClick={next}>
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7h3.5a5 5 0 0 1 4 2l3 4a5 5 0 0 0 4 2H21M18 12l3 3-3 3M3 17h3.5a5 5 0 0 0 3-1M14.5 8a5 5 0 0 1 3-1H21M18 4l3 3-3 3" />
          </svg>
          Surprise me
        </button>
      </div>
    </div>
  )
}
