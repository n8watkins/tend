import { auth } from '@/auth'
import { Avatar, PEOPLE, ScenePhoto, type Scene } from '@/components/landing/People'
import { HeroStage } from '@/components/landing/HeroStage'
import { Motion } from '@/components/landing/Motion'
import { PassageShowcase, type ShowcasePassage } from '@/components/landing/PassageShowcase'
import { Steps } from '@/components/landing/Steps'
import { SuggestDemo, type DemoItem, type DemoPerson } from '@/components/landing/SuggestDemo'
import { PublicHeader } from '@/components/PublicHeader'
import { SignInLink } from '@/components/SignIn'
import { SiteFooter } from '@/components/SiteFooter'
import { getItem, itemHeading, LIBRARY } from '@/lib/content'
import type { ContentItem } from '@/lib/item'
import { suggest } from '@/lib/suggest'
import { topicLabel } from '@/lib/topics'

import './landing.css'

type Scripture = Extract<ContentItem, { kind: 'scripture' }>

function scripture(id: string): Scripture {
  const item = getItem(id)
  if (!item || item.kind !== 'scripture') throw new Error(`landing: ${id} is not a scripture passage in the library`)
  return item
}

/** Library text for display: verified, with only a trailing comma or a stray closing quote trimmed. */
function clean(text: string) {
  const t = text.replace(/[,;:]\s*$/, '')
  return t.endsWith('\u201d') && !t.includes('\u201c') ? t.slice(0, -1) : t
}

// Passages for the showcase, in the order shown: a spread of topics.
const SHOWCASE = ['lamentations-3-22-23', 'john-15-13', 'romans-15-13', 'psalm-34-18', 'ephesians-4-32', 'psalm-46-1', 'jeremiah-29-11', '1-john-4-7', 'numbers-6-24-26', 'psalm-118-24']

// Epigraphs for "Why Tend": scripture on staying close to one another.
const EPIGRAPHS = ['philippians-1-3', 'proverbs-17-17', '1-thessalonians-5-11', 'galatians-6-2']

// Made-up people for the suggestions demo, with topics they care about. Their
// picks come from the real suggestion code (lib/suggest), run on the server.
const DEMO_PEOPLE = [
  { name: 'Mum', topics: ['hope', 'gratitude'] },
  { name: 'Grandpa Joe', topics: ['comfort', 'peace'] },
  { name: 'Priya', topics: ['joy', 'new-beginnings'] },
  { name: 'Sam', topics: ['courage', 'strength'] },
] as const

// Real photos (Pexels licence; credits in CREDITS.md).
const SCENES: (Scene & { caption: string })[] = [
  { photo: 'friends', alt: 'Three friends laughing together, arms around each other.', caption: 'Friends who make you laugh' },
  { photo: 'grandma-phone', alt: 'An older woman on her sofa, smiling at a message on her phone.', caption: 'Grandma, smiling at your message' },
  { photo: 'family', alt: 'A family of three generations in a big, happy hug.', caption: 'Family, near and far' },
  { photo: 'sam-phone', alt: 'A young man with glasses smiling at his phone on the train.', caption: 'Sam, the morning of the interview' },
]

function demoItem(item: ContentItem): DemoItem {
  return item.kind === 'scripture'
    ? { id: item.id, heading: `${item.reference} (WEB)`, text: clean(item.text.web), topics: item.topics.map(topicLabel) }
    : { id: item.id, heading: itemHeading(item), text: clean(item.text), topics: item.topics.map(topicLabel) }
}

const PROMISES = [
  { title: 'You send every message', body: 'Tend never logs in to Signal and never sends anything for you. Your words come from you, in your own chat.', icon: 'M4 12h11M11 6l6 6-6 6M20 5v14' },
  { title: 'Consent first', body: 'Only people who said yes get passages. Every message can carry a link to stop them, and Tend honours it at once.', icon: 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3Zm-3 9 2 2 4-4' },
  { title: 'Verified words', body: 'Bible passages in the public-domain WEB and KJV, and quotes checked word for word against their original source.', icon: 'M5 4h9a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4V4Zm4 4h5M9 12h5' },
  { title: 'Very little data', body: 'A name is all Tend needs. Phone numbers and notes are optional and encrypted, and you can export or delete everything.', icon: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6zM12 15v2' },
]

const QUESTIONS = [
  {
    q: 'Why doesn’t Tend send the messages for me?',
    a: 'Signal has no official way for apps to send messages, and its terms forbid automated messaging. Sending it yourself also means the message really is from you, in your own conversation, where you will see their reply.',
  },
  { q: 'Do the people I write to need Tend?', a: 'No. They get an ordinary Signal message from you. Tend only asks them first whether they would like the occasional verse or quote.' },
  { q: 'Is it free?', a: 'Yes. Tend is free and open source under the MIT licence, and the code is on GitHub.' },
  {
    q: 'Where do the verses and quotes come from?',
    a: 'A small library chosen by hand: Bible passages in the public-domain World English Bible and King James Version, and quotes from public-domain works such as Marcus Aurelius, Emerson and Thoreau, each checked against its source.',
  },
]

export default async function Home() {
  const session = await auth()
  const signedIn = Boolean(session?.user)
  const hero = scripture('joshua-1-9')
  const showcase: ShowcasePassage[] = SHOWCASE.map((id) => {
    const p = scripture(id)
    return { id, reference: p.reference, web: clean(p.text.web), kjv: clean(p.text.kjv), topics: p.topics, context: p.context }
  })
  const epigraphs = EPIGRAPHS.map(scripture)
  const closing = scripture('3-john-1-2')
  const now = Date.now()
  const demoPeople: DemoPerson[] = DEMO_PEOPLE.map((d) => ({
    person: PEOPLE.find((p) => p.name === d.name)!,
    topics: d.topics.map((t) => topicLabel(t).toLowerCase()),
    picks: suggest(LIBRARY, `landing-${d.name}`, d.topics.map((topic, i) => ({ topic, weight: 2 - i })), [], now, 2).map(demoItem),
  }))
  // "Surprise me" draws from the shorter passages, so the card stays a calm size.
  const surprisePool = LIBRARY.filter((i): i is Scripture => i.kind === 'scripture' && i.text.web.length <= 180).map(demoItem)
  const references = LIBRARY.filter((i): i is Scripture => i.kind === 'scripture').map((i) => i.reference)

  const primaryCta = (label: string, className = 'btn btn-primary btn-lg') =>
    signedIn ? (
      <a href="/today" className={className}>
        Open Tend
      </a>
    ) : (
      <SignInLink className={className}>{label}</SignInLink>
    )

  return (
    <div className="landing">
      <Motion />
      <PublicHeader signedIn={signedIn} landing />
      <main id="main">
        {/* Hero */}
        <section className="relative overflow-x-clip">
          <div className="hero-glow" aria-hidden="true" />
          <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 pt-8 pb-12 md:pt-14 lg:grid-cols-[1.05fr_1fr] lg:gap-6 lg:pb-20">
            <div className="hero-copy">
              <p className="eyebrow-pill">
                <span className="dot" aria-hidden="true" />
                For Signal · free and open source
              </p>
              <h1 className="font-display mt-5 text-[2.6rem] leading-[1.04] font-semibold tracking-tight text-balance sm:text-6xl lg:text-[4.1rem]">
                Stay close to the people you{' '}
                <span className="love-word">love</span>.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-muted sm:text-xl">
                Tend picks a Bible passage that fits each person, reminds you when it&rsquo;s time, and opens the Signal chat. You send it, in your own words.
              </p>
              <div className="mt-8 grid gap-3 sm:flex sm:flex-wrap">
                {primaryCta('Get started, free')}
                <a href="#how" className="btn btn-secondary btn-lg">
                  See how it works
                </a>
              </div>
              <div className="mt-8 flex items-center gap-3 text-sm text-muted">
                <span className="flex -space-x-2" aria-hidden="true">
                  {PEOPLE.slice(0, 5).map((p) => (
                    <Avatar key={p.name} person={p} className="size-8 ring-2 ring-bg" eager />
                  ))}
                </span>
                <span>No passwords. Nothing sent for you. WEB and KJV, checked word for word.</span>
              </div>
            </div>
            <HeroStage passage={clean(hero.text.web)} reference={hero.reference} />
          </div>
        </section>

        {/* Scripture marquee */}
        <div className="marquee" aria-hidden="true">
          <div className="marquee-track">
            {[0, 1].map((copy) => (
              <span key={copy} className="marquee-group">
                {references.map((r) => (
                  <span key={r} className="marquee-item">
                    {r}
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>

        {/* How it works */}
        <section id="how" className="section">
          <div className="section-head" data-reveal>
            <p className="eyebrow">How it works</p>
            <h2 className="section-title">Four small steps. One person feels remembered.</h2>
          </div>
          <Steps reference={hero.reference} topics={hero.topics} />
        </section>

        {/* Suggestions */}
        <section id="suggestions" className="section">
          <div className="section-head" data-reveal>
            <p className="eyebrow">Finding the words</p>
            <h2 className="section-title">You think of someone. Tend helps with what to say.</h2>
            <p className="mt-4 text-lg text-muted">
              Everyone you add has a few things they care about, like hope, courage or rest. Tend uses them to suggest words that fit that one person. Or tap Surprise me and let it choose.
            </p>
          </div>
          <SuggestDemo people={demoPeople} pool={surprisePool} />
        </section>

        {/* Passages */}
        <section id="passages" className="section">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div className="section-head lg:mb-0" data-reveal>
              <p className="eyebrow">From the library</p>
              <h2 className="section-title">Words worth sending.</h2>
              <p className="mt-4 text-muted">
                {LIBRARY.filter((i) => i.kind === 'scripture').length} Bible passages and {LIBRARY.filter((i) => i.kind === 'quote').length} quotes, chosen by hand across sixteen topics, from comfort and courage to grief and new beginnings. Every word is fetched from a public-domain source and checked before it ships.
              </p>
            </div>
            <div className="showcase-card" data-reveal>
              <PassageShowcase passages={showcase} />
            </div>
          </div>
        </section>

        {/* Why */}
        <section id="why" className="section">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <ul className="collage" data-reveal>
              {SCENES.map((scene, i) => (
                <li key={scene.photo} className="collage-item" style={{ '--i': i } as React.CSSProperties}>
                  <ScenePhoto scene={scene} sizes="(min-width: 1024px) 18rem, 46vw" className="collage-photo" />
                  <span className="collage-caption">{scene.caption}</span>
                </li>
              ))}
            </ul>
            <div>
              <div className="section-head" data-reveal>
                <p className="eyebrow">Why Tend</p>
                <h2 className="section-title">Love keeps in touch.</h2>
                <p className="mt-4 text-lg text-muted">
                  We rarely drift from people on purpose. Life gets full, a week becomes a season, and the message we meant to send never goes. Tend is a small, gentle habit: a nudge when it has been a while, words worth sending, and your own voice in your own chat.
                </p>
              </div>
              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {epigraphs.map((e, i) => (
                  <li key={e.id} className="epigraph" data-reveal style={{ '--i': i } as React.CSSProperties}>
                    <p className="font-display text-lg leading-snug">&ldquo;{clean(e.text.web)}&rdquo;</p>
                    <p className="mt-2 text-sm font-semibold text-accent">{e.reference} (WEB)</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Promises */}
        <section className="section">
          <div className="section-head" data-reveal>
            <p className="eyebrow">What Tend promises</p>
            <h2 className="section-title">Gentle by design.</h2>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PROMISES.map((p, i) => (
              <li key={p.title} className="promise" data-reveal style={{ '--i': i } as React.CSSProperties}>
                <span className="promise-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                    <path d={p.icon} />
                  </svg>
                </span>
                <h3 className="mt-4 font-semibold">{p.title}</h3>
                <p className="mt-1.5 text-sm text-muted">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Questions */}
        <section id="questions" className="section">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div className="section-head lg:mb-0" data-reveal>
              <p className="eyebrow">Questions</p>
              <h2 className="section-title">Good to know.</h2>
            </div>
            <div className="faq" data-reveal>
              {QUESTIONS.map((item) => (
                <details key={item.q}>
                  <summary>
                    {item.q}
                    <svg viewBox="0 0 24 24" className="faq-chev size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </summary>
                  <p>
                    {item.a}
                    {item.q === 'Is it free?' ? (
                      <>
                        {' '}
                        <a className="text-accent underline underline-offset-2" href="https://github.com/n8watkins/tend">
                          See the source.
                        </a>
                      </>
                    ) : null}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Closing */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-6">
          <div className="closing" data-reveal>
            <div className="closing-glow" aria-hidden="true" />
            <span className="flex justify-center -space-x-3" aria-hidden="true">
              {PEOPLE.map((p) => (
                <Avatar key={p.name} person={p} className="size-12 ring-4 ring-surface sm:size-14" />
              ))}
            </span>
            <h2 className="font-display mt-6 text-3xl font-semibold tracking-tight text-balance sm:text-5xl">Who comes to mind right now?</h2>
            <blockquote className="mx-auto mt-4 max-w-xl text-muted">
              <p className="font-display text-lg italic">&ldquo;{clean(closing.text.web)}&rdquo;</p>
              <footer className="mt-1 text-sm font-semibold">{closing.reference} (WEB)</footer>
            </blockquote>
            <div className="mt-8 flex justify-center">{primaryCta('Start with one person')}</div>
          </div>
        </section>
      </main>
      <SiteFooter wide />
    </div>
  )
}
