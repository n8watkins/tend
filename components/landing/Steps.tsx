import { Avatar, PEOPLE } from './People'

/**
 * "How it works", told as four small animated scenes. Each scene loops gently
 * while on screen and rests on a clear still frame under reduced motion.
 */
export function Steps({ reference, topics }: { reference: string; topics: string[] }) {
  const [mum, sam, joe, priya, lee] = PEOPLE
  return (
    <ol className="steps">
      <li className="step" data-reveal style={{ '--i': 0 } as React.CSSProperties}>
        <div className="step-scene scene-pick" data-loop aria-hidden="true">
          {[mum, sam, joe, priya].map((p, i) => (
            <span key={p.name} className="pick-person" style={{ '--n': i } as React.CSSProperties}>
              <Avatar person={p} className="size-12" />
              <span className="text-[0.7rem] font-semibold">{p.name.split(' ').at(-1)}</span>
            </span>
          ))}
        </div>
        <p className="step-num">01</p>
        <h3 className="step-title">Pick someone you love</h3>
        <p className="step-body">Just a name is enough. Choose what matters to them, like hope, courage or friendship, and how often feels right.</p>
      </li>

      <li className="step" data-reveal style={{ '--i': 1 } as React.CSSProperties}>
        <div className="step-scene scene-suggest" data-loop aria-hidden="true">
          <div className="mini-card">
            <div className="flex items-center gap-2">
              <Avatar person={sam} className="size-7" />
              <span className="text-xs font-semibold">For Sam</span>
            </div>
            <span className="mini-line w-[92%]" />
            <span className="mini-line w-[78%]" />
            <span className="mini-line w-[60%]" />
            <div className="mt-2 flex items-center gap-1.5">
              <span className="text-[0.7rem] font-semibold">{reference}</span>
              {topics.slice(0, 1).map((t) => (
                <span key={t} className="badge badge-good px-1.5 py-0 text-[0.62rem] capitalize">
                  {t}
                </span>
              ))}
            </div>
            <span className="mini-sparkle" />
          </div>
        </div>
        <p className="step-num">02</p>
        <h3 className="step-title">Tend suggests a passage</h3>
        <p className="step-body">A verified Bible passage or quote that fits them and that you haven&rsquo;t sent before, with a nudge by email when it&rsquo;s a good time.</p>
      </li>

      <li className="step" data-reveal style={{ '--i': 2 } as React.CSSProperties}>
        <div className="step-scene scene-send" data-loop aria-hidden="true">
          <div className="send-chat">
            <span className="send-in" />
            <span className="send-out" />
          </div>
          <span className="send-plane">
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
              <path d="M3.4 20.4 21 12 3.4 3.6l.1 6.5L15 12l-11.5 1.9z" />
            </svg>
          </span>
        </div>
        <p className="step-num">03</p>
        <h3 className="step-title">Send it on Signal</h3>
        <p className="step-body">Add a line of your own, copy, and Tend opens your chat with them in Signal. The message comes from you, in your own conversation.</p>
      </li>

      <li className="step" data-reveal style={{ '--i': 3 } as React.CSSProperties}>
        <div className="step-scene scene-done" data-loop aria-hidden="true">
          <Avatar person={lee} className="size-11" />
          <span className="done-btn">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 5 5 9-10" />
            </svg>
            I sent it
          </span>
          {[0, 1, 2, 3, 4].map((n) => (
            <svg key={n} className="done-heart" style={{ '--n': n } as React.CSSProperties} viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.5 3 5 6.4 5c2.1 0 3.6 1.2 4.6 2.6l1 1.3 1-1.3C14 6.2 15.5 5 17.6 5 21 5 23.1 8.5 21.6 11.8 19.5 16.4 12 21 12 21Z" />
            </svg>
          ))}
        </div>
        <p className="step-num">04</p>
        <h3 className="step-title">Tap &ldquo;I sent it&rdquo;</h3>
        <p className="step-body">Tend remembers what went to whom, never repeats itself, and waits the right while before the next nudge.</p>
      </li>
    </ol>
  )
}

/** The people you love around you, joined by gently flowing threads. */
export function Circle() {
  const you = PEOPLE[4]
  const others = PEOPLE.filter((p) => p !== you)
  // Five people evenly round a circle, starting at the top.
  const spots = others.map((p, i) => {
    const angle = (-90 + (360 / others.length) * i) * (Math.PI / 180)
    return { p, x: 50 + 38 * Math.cos(angle), y: 50 + 38 * Math.sin(angle) }
  })
  return (
    <div className="circle" data-loop aria-hidden="true">
      <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <circle cx="50" cy="50" r="38" fill="none" className="circle-ring" />
        {spots.map(({ p, x, y }, i) => (
          <line key={p.name} x1="50" y1="50" x2={x} y2={y} className="circle-thread" style={{ '--n': i } as React.CSSProperties} />
        ))}
      </svg>
      {spots.map(({ p, x, y }, i) => (
        <span key={p.name} className="circle-person" style={{ left: `${x}%`, top: `${y}%`, '--n': i } as React.CSSProperties}>
          <Avatar person={p} className="size-[4.25rem] ring-4 ring-surface sm:size-20" />
          <span className="hero-pill">{p.name}</span>
        </span>
      ))}
      <span className="circle-you">
        <Avatar person={you} className="size-24 ring-4 ring-surface sm:size-28" />
        <span className="hero-pill">
          <b>You</b>
        </span>
      </span>
    </div>
  )
}
