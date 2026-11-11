import type { Metadata } from 'next'

import { PublicHeader } from '@/components/PublicHeader'
import { SiteFooter } from '@/components/SiteFooter'

export const metadata: Metadata = { title: 'Privacy' }

export default function PrivacyPage() {
  return (
    <>
      <PublicHeader />
      <main id="main" className="prose-page mx-auto w-full max-w-2xl px-4 py-8">
        <h1 className="text-3xl font-bold">Privacy</h1>
        <p className="text-muted">Last updated 10 November 2026</p>
        <p>Tend is a small, free, open-source app run by Nathan Watkins (n8builds.dev). This page says plainly what it keeps and why.</p>

        <h2>What Tend stores</h2>
        <ul>
          <li>Your account: your email address, and your GitHub name and picture if you sign in with GitHub.</li>
          <li>The people you add: a name, and only if you choose to add them, a phone number and private notes. Phone numbers and notes are encrypted before they are saved.</li>
          <li>Their consent state, the topics you picked, their timing rules, the messages you scheduled, sent or skipped, and changes to their consent.</li>
          <li>Your settings: time zone, preferred Bible translation and whether you want email reminders.</li>
          <li>Short-lived counters (hashed, not readable) that limit how many sign-in emails can be sent, to stop abuse.</li>
        </ul>

        <h2>What Tend does not do</h2>
        <ul>
          <li>It never connects to Signal, never reads your Signal contacts or messages, and never sends anything for you.</li>
          <li>It does not use analytics, advertising or tracking, and it does not sell or share your data.</li>
          <li>It does not send anyone&rsquo;s details to an AI service.</li>
        </ul>

        <h2>The people you add</h2>
        <p>
          They never signed up to Tend, so please add only what you need: a name is enough. Each person gets a private stop link you can include in messages; if they use it, Tend stops reminding you to message them, and the page they see never shows your email or their details.
        </p>

        <h2>Where it lives</h2>
        <p>
          Tend runs on Cloudflare Workers. Data is stored in a Turso (libSQL) database in the United States. Sign-in and reminder emails are sent through a shared mail relay on Cloudflare Email Service. Cloudflare Turnstile may check the sign-in form for bots.
        </p>

        <h2>Your control</h2>
        <ul>
          <li>Export everything as a file from Settings.</li>
          <li>Delete any person, and all of their history, from their page.</li>
          <li>Delete your account from Settings: everything is removed immediately.</li>
        </ul>

        <h2>Security</h2>
        <p>
          Encryption keys are held only by the server, so encryption protects against a leaked database copy, not against a compromise of the server itself. Report a security problem as described in the project&rsquo;s{' '}
          <a href="https://github.com/n8watkins/tend/blob/main/SECURITY.md">security policy</a>.
        </p>

        <h2>Contact</h2>
        <p>
          Questions: open an issue on <a href="https://github.com/n8watkins/tend/issues">GitHub</a>.
        </p>
      </main>
      <SiteFooter />
    </>
  )
}
