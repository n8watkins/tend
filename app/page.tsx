import Link from 'next/link'

import { auth } from '@/auth'
import { PublicHeader } from '@/components/PublicHeader'
import { SiteFooter } from '@/components/SiteFooter'

const STEPS = [
  {
    title: 'Add the people you care about',
    body: 'Just a name is enough. Pick a few things that matter to them, like hope, courage or friendship, and how often is right.',
  },
  {
    title: 'Ask them first',
    body: 'Tend drafts a short, friendly note asking if they would like the occasional verse or quote. Nothing else goes to anyone who has not said yes.',
  },
  {
    title: 'Get a nudge, then send it yourself',
    body: 'When it is a good time, Tend reminds you with a suggestion that fits them. Copy it, open the chat in Signal, send, and tap "I sent it".',
  },
]

const PRINCIPLES = [
  { title: 'You send every message', body: 'Tend never logs in to Signal and never sends anything for you. Your messages come from you, in your own chat.' },
  { title: 'Consent first', body: 'Only people who said yes get messages. Every message can carry a link they can use to stop them, and Tend honours it at once.' },
  { title: 'Verified words', body: 'Passages come from public-domain Bibles (WEB and KJV) and quotes are checked word for word against their original source.' },
  { title: 'Very little data', body: 'A name is all Tend needs. Phone numbers and notes are optional and encrypted, and you can export or delete everything.' },
]

export default async function Home() {
  const session = await auth()
  const signedIn = Boolean(session?.user)
  return (
    <>
      <PublicHeader signedIn={signedIn} />
      <main id="main" className="mx-auto w-full max-w-3xl px-4">
        <section className="grid items-center gap-10 py-8 md:grid-cols-[1.1fr_1fr] md:py-14">
          <div>
            <p className="mb-3 text-sm font-semibold tracking-wide text-accent uppercase">For Signal</p>
            <h1 className="text-4xl leading-tight font-bold text-balance md:text-5xl">Stay close to the people you care about.</h1>
            <p className="mt-4 text-lg text-muted">
              Tend suggests a Bible verse or quote that fits each person, reminds you when it is a good time, and remembers what you sent. You send every message yourself, on Signal.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href={signedIn ? '/today' : '/signin'} className="btn btn-primary">
                {signedIn ? 'Open Tend' : 'Get started, free'}
              </Link>
              <a href="#how" className="btn btn-secondary">
                How it works
              </a>
            </div>
          </div>
          <figure className="card mx-auto w-full max-w-sm shadow-sm" aria-label="An example message">
            <p className="text-xs font-semibold text-muted">Reminder for today</p>
            <p className="mt-1 font-semibold">Time to send something to Sam</p>
            <div className="mt-4 rounded-2xl rounded-bl-md bg-accent-soft p-4 text-accent-soft-ink">
              <p className="text-sm">Thinking of you this week.</p>
              <p className="passage mt-3">Don&rsquo;t you be afraid, for I am with you. Don&rsquo;t be dismayed, for I am your God. I will strengthen you.</p>
              <p className="mt-2 text-sm font-semibold">- Isaiah 41:10 (WEB)</p>
            </div>
            <figcaption className="mt-3 text-xs text-muted">Chosen for Sam because they care about courage and strength.</figcaption>
          </figure>
        </section>

        <section id="how" className="scroll-mt-6 py-8">
          <h2 className="text-2xl font-bold">How it works</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="card">
                <span className="grid size-8 place-items-center rounded-full bg-accent text-sm font-bold text-accent-ink" aria-hidden="true">
                  {i + 1}
                </span>
                <h3 className="mt-3 font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="py-8">
          <h2 className="text-2xl font-bold">What Tend promises</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {PRINCIPLES.map((p) => (
              <li key={p.title} className="card">
                <h3 className="font-semibold">{p.title}</h3>
                <p className="mt-1 text-sm text-muted">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="py-8">
          <h2 className="text-2xl font-bold">Questions</h2>
          <dl className="mt-6 space-y-5">
            <div>
              <dt className="font-semibold">Why doesn&rsquo;t Tend send the messages for me?</dt>
              <dd className="mt-1 text-muted">
                Signal has no official way for apps to send messages, and its terms forbid automated messaging. Sending it yourself also means the message really is from you, in your own conversation, where you will see their reply.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Is it free?</dt>
              <dd className="mt-1 text-muted">
                Yes. Tend is free and open source under the MIT licence. The code is on{' '}
                <a className="text-accent underline underline-offset-2" href="https://github.com/n8watkins/tend">
                  GitHub
                </a>
                .
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Where do the verses and quotes come from?</dt>
              <dd className="mt-1 text-muted">
                A small library chosen by hand: Bible passages in the public-domain World English Bible and King James Version, and quotes from public-domain works such as Marcus Aurelius, Emerson and Thoreau, each checked against its source.
              </dd>
            </div>
          </dl>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
