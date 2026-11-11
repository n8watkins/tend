import type { Metadata } from 'next'
import Link from 'next/link'

import { Empty, PageTitle } from '@/components/ui'
import { citation, itemReadingUrl, itemText, LIBRARY } from '@/lib/content'
import { getContact } from '@/lib/server/data'
import { getSettings, requireUser } from '@/lib/server/session'
import { isTopic, TOPICS, topicLabel } from '@/lib/topics'

export const metadata: Metadata = { title: 'Library' }

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string; kind?: string; contact?: string }>
}) {
  const user = await requireUser()
  const params = await searchParams
  const settings = await getSettings(user.id)
  const contact = params.contact ? await getContact(user.id, params.contact) : null
  const topic = params.topic && isTopic(params.topic) ? params.topic : undefined
  const kind = params.kind === 'scripture' || params.kind === 'quote' ? params.kind : undefined
  const items = LIBRARY.filter((i) => (!topic || i.topics.includes(topic)) && (!kind || i.kind === kind))
  const canUse = contact?.consent === 'yes'

  const href = (next: { topic?: string; kind?: string }) => {
    const q = new URLSearchParams()
    const t = 'topic' in next ? next.topic : topic
    const k = 'kind' in next ? next.kind : kind
    if (t) q.set('topic', t)
    if (k) q.set('kind', k)
    if (contact) q.set('contact', contact.id)
    const s = q.toString()
    return s ? `/library?${s}` : '/library'
  }

  return (
    <>
      <PageTitle
        title="Library"
        subtitle={
          contact
            ? canUse
              ? `Choosing something for ${contact.name}.`
              : `${contact.name} has not said yes to messages yet.`
            : `${LIBRARY.length} passages and quotes, each checked against its public-domain source.`
        }
      />
      <nav aria-label="Filter by kind" className="mb-3 flex flex-wrap gap-2">
        {[
          { value: undefined, label: 'Everything' },
          { value: 'scripture', label: 'Bible passages' },
          { value: 'quote', label: 'Quotes' },
        ].map((k) => (
          <Link key={k.label} prefetch={false} href={href({ kind: k.value })} className="chip" aria-current={kind === k.value ? 'true' : undefined}>
            {k.label}
          </Link>
        ))}
      </nav>
      <nav aria-label="Filter by topic" className="mb-6 flex flex-wrap gap-2">
        <Link href={href({ topic: undefined })} prefetch={false} className="chip" aria-current={!topic ? 'true' : undefined}>
          All topics
        </Link>
        {TOPICS.map((t) => (
          <Link key={t.slug} prefetch={false} href={href({ topic: t.slug })} className="chip" aria-current={topic === t.slug ? 'true' : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      {items.length ? (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id} className="card">
              <p className="passage">{itemText(item, settings.translation)}</p>
              <p className="mt-2 text-sm font-semibold">- {citation(item, settings.translation)}</p>
              <p className="hint mt-2">{item.context}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap gap-1">
                  {item.topics.map((t) => (
                    <span key={t} className="badge">
                      {topicLabel(t)}
                    </span>
                  ))}
                </span>
                <span className="flex flex-wrap gap-2">
                  <a href={itemReadingUrl(item, settings.translation)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                    Read in context
                  </a>
                  {canUse ? (
                    <Link href={`/compose?contact=${contact.id}&content=${item.id}`} className="btn btn-primary btn-sm">
                      Use for {contact.name.split(' ')[0]}
                    </Link>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Nothing matches those filters.</Empty>
      )}
      <p className="hint mt-8">
        Bible passages: World English Bible (public domain) and King James Version (public domain outside the UK). Want to add something?{' '}
        <a href="https://github.com/n8watkins/tend/blob/main/CONTRIBUTING.md" className="underline underline-offset-2">
          Suggest it on GitHub
        </a>
        .
      </p>
    </>
  )
}
