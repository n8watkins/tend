import { Avatar, PEOPLE } from './People'

/**
 * The hero illustration: Tend's suggestion card flies into Sam's Signal chat,
 * Sam replies, and the send is marked done. Pure CSS on a 10 second loop that
 * runs only while on screen (`data-loop`); without motion it shows the end
 * state, a finished, happy exchange.
 */
export function HeroStage({ passage, reference }: { passage: string; reference: string }) {
  const [mum, sam, joe, priya] = PEOPLE
  return (
    <div className="hero-stage" data-loop aria-hidden="true">
      <div className="hero-halo" />

      <div className="hero-float hero-float-a">
        <Avatar person={mum} className="size-14 ring-4 ring-surface" />
        <span className="hero-pill">
          <b>{mum.name}</b> · {mum.topic}
        </span>
      </div>
      <div className="hero-float hero-float-b">
        <Avatar person={joe} className="size-16 ring-4 ring-surface" />
        <span className="hero-pill">
          <b>{joe.name}</b> · {joe.topic}
        </span>
      </div>
      <div className="hero-float hero-float-c">
        <Avatar person={priya} className="size-12 ring-4 ring-surface" />
        <span className="hero-pill">
          <b>{priya.name}</b> · {priya.topic}
        </span>
      </div>

      <div className="phone">
        <div className="phone-screen">
          <div className="phone-bar">
            <svg viewBox="0 0 24 24" className="size-4 opacity-70" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 6-6 6 6 6" />
            </svg>
            <Avatar person={sam} className="size-8" />
            <div className="leading-tight">
              <p className="text-[0.8rem] font-semibold">{sam.name}</p>
              <p className="text-[0.65rem] opacity-60">Signal</p>
            </div>
          </div>
          <div className="phone-thread">
            <p className="bubble bubble-in">Big interview tomorrow. Bit nervous!</p>
            <div className="bubble bubble-out msg-out">
              <p>Thinking of you today, Sam.</p>
              <p className="mt-1.5 font-display italic">&ldquo;{passage}&rdquo;</p>
              <p className="mt-1 text-[0.7rem] font-semibold">{reference} (WEB)</p>
            </div>
            <div className="grid justify-items-start [&>*]:[grid-area:1/1]">
              <span className="typing msg-typing">
                <i />
                <i />
                <i />
              </span>
              <p className="bubble bubble-in msg-reply">
                Needed that today. Thank you
                <svg viewBox="0 0 24 24" className="ml-1 inline size-3.5 align-[-2px] text-rose" fill="currentColor">
                  <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.5 3 5 6.4 5c2.1 0 3.6 1.2 4.6 2.6l1 1.3 1-1.3C14 6.2 15.5 5 17.6 5 21 5 23.1 8.5 21.6 11.8 19.5 16.4 12 21 12 21Z" />
                </svg>
              </p>
            </div>
          </div>
          <div className="phone-toast msg-toast">
            <span className="grid size-6 place-items-center rounded-full bg-accent text-accent-ink">
              <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 12 5 5 9-10" />
              </svg>
            </span>
            <span>
              <b>Marked as sent.</b> Next for Sam in about 2 weeks.
            </span>
          </div>
        </div>
      </div>

      <div className="suggest-card msg-card">
        <div className="flex items-center gap-2.5">
          <Avatar person={sam} className="size-9" />
          <div className="leading-tight">
            <p className="text-[0.7rem] font-semibold tracking-wide text-accent uppercase">Time for Sam</p>
            <p className="text-sm font-semibold">
              {reference} · {sam.topic}
            </p>
          </div>
        </div>
        <span className="suggest-btn msg-press">Open in Signal</span>
      </div>

      <svg className="hero-heart hero-heart-1" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.5 3 5 6.4 5c2.1 0 3.6 1.2 4.6 2.6l1 1.3 1-1.3C14 6.2 15.5 5 17.6 5 21 5 23.1 8.5 21.6 11.8 19.5 16.4 12 21 12 21Z" />
      </svg>
      <svg className="hero-heart hero-heart-2" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.5 3 5 6.4 5c2.1 0 3.6 1.2 4.6 2.6l1 1.3 1-1.3C14 6.2 15.5 5 17.6 5 21 5 23.1 8.5 21.6 11.8 19.5 16.4 12 21 12 21Z" />
      </svg>
    </div>
  )
}
