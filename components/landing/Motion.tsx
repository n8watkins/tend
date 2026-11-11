'use client'

import { useEffect } from 'react'

/**
 * Scroll motion for the landing page, as progressive enhancement:
 * - `[data-reveal]` elements fade and rise in the first time they scroll into
 *   view. Without JavaScript they are simply visible; anything already on
 *   screen when this runs is marked shown first, so nothing flickers.
 * - `[data-loop]` elements get `.is-playing` only while on screen, so their
 *   looping CSS animations pause when off screen (battery on phones).
 * The CSS turns all of it off under prefers-reduced-motion.
 */
export function Motion() {
  useEffect(() => {
    const root = document.documentElement
    const reveals = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    const inView = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return r.top < window.innerHeight && r.bottom > 0
    }
    for (const el of reveals) if (inView(el)) el.classList.add('is-in')
    root.classList.add('reveal-armed')

    const revealer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          revealer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    )
    for (const el of reveals) if (!el.classList.contains('is-in')) revealer.observe(el)

    const looper = new IntersectionObserver((entries) => {
      for (const entry of entries) entry.target.classList.toggle('is-playing', entry.isIntersecting)
    })
    for (const el of document.querySelectorAll('[data-loop]')) looper.observe(el)

    return () => {
      revealer.disconnect()
      looper.disconnect()
      root.classList.remove('reveal-armed')
    }
  }, [])
  return null
}
