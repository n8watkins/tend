'use client'

import { useEffect, useState } from 'react'

import { topicLabel } from '@/lib/topics'

export type ShowcasePassage = {
  id: string
  reference: string
  web: string
  kjv: string
  topics: string[]
  context: string
}

const INTERVAL = 7000

/**
 * Real passages from the library, cycling with a soft cross-fade. Every slide
 * sits in the same grid cell, so the box is always as tall as the longest one
 * and nothing below it moves. Autoplay is off under reduced motion, pauses on
 * hover and focus, and has a pause button (WCAG 2.2.2).
 */
export function PassageShowcase({ passages }: { passages: ShowcasePassage[] }) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [held, setHeld] = useState(false)
  const [version, setVersion] = useState<'web' | 'kjv'>('web')
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const running = playing && !held && !reduced
  useEffect(() => {
    if (!running) return
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % passages.length), INTERVAL)
    return () => window.clearTimeout(timer)
  }, [running, index, passages.length])

  const go = (step: number) => setIndex((i) => (i + step + passages.length) % passages.length)
  const current = passages[index]

  return (
    <div
      className="showcase"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      data-running={running ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Translation" className="seg">
          {(['web', 'kjv'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={version === v} onClick={() => setVersion(v)}>
              {v.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted tabular-nums" aria-hidden="true">
          {String(index + 1).padStart(2, '0')} / {String(passages.length).padStart(2, '0')}
        </p>
      </div>

      <div className="showcase-stage mt-6" role="group" aria-roledescription="carousel" aria-label="Passages from the library">
        {passages.map((p, i) => (
          <figure key={p.id} className="showcase-slide" data-active={i === index} aria-hidden={i !== index}>
            <blockquote className="font-display text-[1.45rem] leading-snug font-normal text-balance sm:text-[1.9rem] md:text-[2.15rem]">
              <span className="showcase-mark" aria-hidden="true">
                &ldquo;
              </span>
              {version === 'web' ? p.web : p.kjv}
            </blockquote>
            <figcaption className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="font-semibold">
                {p.reference} <span className="text-muted">({version.toUpperCase()})</span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                {p.topics.map((t) => (
                  <span key={t} className="badge badge-good">
                    {topicLabel(t)}
                  </span>
                ))}
              </span>
              <span className="basis-full text-sm text-muted">{p.context}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-2">
        <button type="button" className="btn btn-secondary btn-sm size-10 px-0" onClick={() => go(-1)} aria-label="Previous passage">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 6-6 6 6 6" />
          </svg>
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm size-10 px-0"
          onClick={() => setPlaying((v) => !v)}
          aria-label={playing ? 'Pause the passages' : 'Play the passages'}
          disabled={reduced}
          hidden={reduced}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
              <path d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5Z" />
            </svg>
          )}
        </button>
        <button type="button" className="btn btn-secondary btn-sm size-10 px-0" onClick={() => go(1)} aria-label="Next passage">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
        <div className="ml-2 flex flex-1 gap-1.5" aria-hidden="true">
          {passages.map((p, i) => (
            <span key={p.id} className="showcase-tick" data-state={i < index ? 'done' : i === index ? 'now' : 'next'} style={{ '--dur': `${INTERVAL}ms` } as React.CSSProperties} />
          ))}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {running || !current ? '' : current.reference}
      </p>
    </div>
  )
}
