import type { Metadata } from 'next'

import { PublicHeader } from '@/components/PublicHeader'
import { SiteFooter } from '@/components/SiteFooter'

export const metadata: Metadata = { title: 'Terms' }

export default function TermsPage() {
  return (
    <>
      <PublicHeader />
      <main id="main" className="prose-page mx-auto w-full max-w-2xl px-4 py-8">
        <h1 className="text-3xl font-bold">Terms</h1>
        <p className="text-muted">Last updated 10 November 2026</p>
        <p>By using Tend you agree to these short terms.</p>

        <h2>Use it kindly</h2>
        <ul>
          <li>Use Tend only for people you know personally, and only send content to people who said they would like it.</li>
          <li>Stop when someone asks you to, whether they tell you or use their stop link.</li>
          <li>Do not use Tend for marketing, bulk messages, or anything that breaks Signal&rsquo;s terms or the law.</li>
        </ul>

        <h2>You send the messages</h2>
        <p>Tend suggests and reminds; you choose what to send and send it yourself. You are responsible for the messages you send.</p>

        <h2>Not affiliated with Signal</h2>
        <p>Tend is an independent project for Signal users. Signal is a trademark of Signal Messenger, LLC, which does not make or endorse Tend.</p>

        <h2>The service</h2>
        <p>
          Tend is free and provided as is, without warranties. It may change, have limits (for example on reminder emails), or stop. We may suspend accounts that abuse it. You can delete your account at any time.
        </p>

        <h2>Content</h2>
        <p>
          Bible passages are from the World English Bible and the King James Version, and quotes are from public-domain works. The source code is open source under the{' '}
          <a href="https://github.com/n8watkins/tend/blob/main/LICENSE">MIT licence</a>.
        </p>

        <h2>Changes</h2>
        <p>If these terms change in a way that matters, the date above changes and the app will say so.</p>
      </main>
      <SiteFooter />
    </>
  )
}
