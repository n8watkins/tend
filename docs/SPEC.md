# Tend: specification

Tend helps you keep in touch with the people you care about by sending them something worth reading, now and then, on Signal.
It suggests a verified Bible passage or a public-domain quote that fits what the person cares about, lets you write it in your own words, reminds you when it is time, and remembers what you sent so you never repeat yourself or overdo it.
You send every message yourself, from your own Signal.

- Live: https://tend.n8builds.dev
- Repo: https://github.com/n8watkins/tend (MIT)
- Background and the reasoning behind every decision here: [PRD-REVIEW.md](PRD-REVIEW.md); the original PRD: [PRD.md](PRD.md).

Tend is not affiliated with Signal; it is a companion app "for Signal".

## 1. Principles

1. **You send.** Tend never sends anything on Signal and never holds Signal keys or sessions.
2. **Consent first.** Content goes only to people who said yes; anyone can stop with one tap.
3. **Verified words only.** Every passage and quote in the library is checked word for word against a public-domain source.
4. **Little data.** A contact needs only a name; phone numbers and notes are optional and encrypted.
5. **Free to run.** Workers, Turso free tier and the account's included email; no per-user cost.

## 2. Scope

### MVP (milestone 1)

- Sign in with an email link (sent through the shared mailroom) or GitHub (when configured; linked to the same account by the GitHub account's verified email), Turnstile on the email form (production refuses email sign-in when it is not configured).
- Contacts with consent state, Signal status, topics with weights, time zone, contact window, frequency rules, optional phone and notes.
- A curated content library of about 65 verified items across 16 topics.
- Suggestions per contact, ranked by topic fit and freshness.
- Compose and review: the exact outgoing text, with an optional personal note, citation, reading link and stop link.
- Scheduling with reminders: pick a time (or "next good time"), get an in-app "Due now" item and an email at that time.
- Send screen: copy, open the Signal chat, share (where supported), mark sent, skip, reschedule.
- History per contact and overall; frequency caps and quiet hours enforced on the server.
- Recipient stop page, global pause, data export, account deletion.
- Privacy and terms pages, n8builds share card, a light theme only, phone-first layout.

### Later milestones

- M2: CSV import and export of contacts; "Invite to Signal" text with the native SMS composer link; Signal usernames.
- M3 (shipped): Telegram reminders through the official Bot API (see below); Web Push reminders and the installable app (section 15).
- M4: Opt-in AI suggestions that send only topic labels (never names, notes or numbers) to a model, still returning only library items.
- M5: Community content contributions (articles, videos) with a review queue.

### Telegram reminders (shipped)

- On only when the Worker has `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`; the cron registers the webhook (`/api/telegram`, with the secret token) and the bot's commands whenever they change.
- Settings, "Connect Telegram": a one-time code (15 minutes, stored hashed) opens `t.me/<bot>?start=<code>`; pressing Start links that private chat to the account. One chat per account, one account per chat. `/stop` in the chat, or Disconnect in Settings, unlinks it.
- Each due message gets its own Telegram message with the prepared text and buttons: Share (`t.me/share/url`), Open in Tend, and callback buttons "I sent it" and "Snooze a day" that update Tend. Email and Telegram are separate choices.
- Caps (lib/limits.ts): 20 bot messages a day per user and 300 site-wide; replies to chats linked to nobody have their own caps (3 a day per chat, 50 overall). If a cap or its counter is unavailable, nothing is sent.
- The send screen also offers free share links for WhatsApp (`wa.me/?text=`), a text message (`sms:?&body=`) and Telegram, beside Signal. No paid WhatsApp Business API.

### Not planned

- Any automated sending to Signal, including a self-hosted bridge (PRD-REVIEW.md, Pass 2, point 2).
- Bulk or group messaging, contact scraping, read receipts, autonomous replies.

## 3. Architecture

```
browser ──HTTPS──> Cloudflare Worker "tend" (tend.n8builds.dev)
                    ├─ Next.js 16 App Router via OpenNext (pages, server actions, /api)
                    ├─ scheduled(): Cron Trigger "*/15 * * * *" -> reminder code, called directly (worker/cron.ts)
                    ├─ MAILROOM: service binding to the shared mailroom
                    └─ Turso (libSQL) over HTTPS via Drizzle
```

- **Runtime:** Next.js 16 (App Router, React 19, server actions) built by `@opennextjs/cloudflare` into one Worker.
  `worker/index.ts` wraps the OpenNext handler and adds `scheduled()`.
- **Database:** Turso database `tend` in group `default`, Drizzle ORM, SQL migrations in `db/migrations` applied by `scripts/migrate.mjs`.
- **Auth:** Auth.js v5, database sessions, Drizzle adapter.
- **Email:** every message goes through the shared mailroom service binding `MAILROOM` (entrypoint `Mailroom`, app `tend`), which counts it against the account-wide Cloudflare Email cap. Its caps for Tend: 30 a day, 150 a month, 8 per recipient a day. A refused send (over a cap, suppressed) is a failure and is not retried; reminders hand the claim back when the refusal is a cap that resets. Tests and local dev have no binding: test mode writes to an outbox directory instead. Tend keeps its own site-wide daily caps low (10 sign-in, 10 reminders); the e2e server raises them through env overrides, never the defaults.
- **Styling:** Tailwind CSS v4, system font stack, CSS variables for one light theme.
- **Validation:** zod on every server action and route input.

## 4. Data model

All timestamps are epoch milliseconds (UTC).
Every application row carries `userId`, and every query filters by the signed-in user's id.

### Auth.js tables

`user`, `account`, `session`, `verificationToken`: the standard Drizzle adapter schema for SQLite.

### `user_settings`

| Column | Type | Notes |
| --- | --- | --- |
| userId | text PK, FK user, cascade | |
| timezone | text | IANA zone, default from the browser at first visit, else `UTC` |
| emailReminders | integer bool | default true |
| pausedAt | integer null | global pause: no reminders, no scheduling while set |
| translation | text | `web` (default) or another code from `TRANSLATIONS` (docs/TRANSLATIONS.md): preferred scripture translation |
| createdAt | integer | |

### `contact`

| Column | Type | Notes |
| --- | --- | --- |
| id | text PK (uuid) | |
| userId | text FK user, cascade | |
| name | text | 1 to 80 characters, required |
| phoneEnc | text null | AES-GCM ciphertext of the E.164 number |
| notesEnc | text null | AES-GCM ciphertext, at most 1,000 characters plain |
| timezone | text | IANA zone, default the user's |
| signalStatus | text | `unknown`, `on_signal`, `invited`, `not_on_signal` |
| consent | text | `not_asked`, `asked`, `yes`, `no`, `stopped` |
| consentUpdatedAt | integer | |
| stoppedByRecipient | integer bool | true when `stopped` came from the stop page |
| minDaysBetween | integer | default 7, range 1 to 90 |
| maxPer30Days | integer | default 4, range 1 to 10 |
| windowStart | integer | minutes after local midnight, default 540 (09:00) |
| windowEnd | integer | default 1200 (20:00); must be after windowStart |
| allowedDays | integer | bitmask, bit 0 = Sunday; default 127 (every day) |
| translation | text null | their own Bible translation; null uses the sender's default |
| birthday | text null | `YYYY-MM-DD`, or `--MM-DD` without a year (as vCard writes it); a date in their time zone |
| anniversary | text null | same format |
| occasionLeadDays | integer | default 3; one of 0, 1, 2, 3, 7, 14: the first reminder that many days ahead, and one on the day |
| cadenceDays | integer null | keep in touch every this many days (1 to 365); null is off |
| lastInTouchAt | integer null | a catch-up you recorded outside Tend ("We were in touch today", or a date on the form) |
| stopToken | text unique | 32 random bytes, base64url |
| archivedAt | integer null | |
| createdAt, updatedAt | integer | |

### `contact_topic`

`(contactId, topic)` primary key, `weight` 1 to 3.
`topic` is one of the fixed topic slugs (section 7).

### `message`

| Column | Type | Notes |
| --- | --- | --- |
| id | text PK | |
| userId | text FK | |
| contactId | text FK contact, cascade | |
| kind | text | `content`, `consent_request`, `personal` |
| contentId | text null | library item id for `content` |
| body | text | the exact text to send, at most 2,000 characters |
| status | text | `scheduled`, `sent`, `skipped`, `canceled` |
| scheduledFor | integer | when the reminder is due |
| remindedAt | integer null | when the reminder email went out |
| sentAt | integer null | when the user marked it sent |
| createdAt, updatedAt | integer | |

Indexes: `(status, scheduledFor)` for the cron, `(contactId, sentAt)` for caps and history, `(userId, status)` for the dashboard.

### `consent_event`

`id, userId, contactId, from, to, by ('you' | 'recipient'), at`: an append-only log of consent changes, shown in contact history.

### `nudge`

`(contactId, key)` primary key, `userId`, `at`: birthday, anniversary and keep-in-touch reminders already sent, keyed like `birthday:2026-11-14:ahead`, `birthday:2026-11-14:day` or `cadence:2026-11-20`, so none is sent twice.
Rows older than 400 days are pruned by the cron.

### `rate_limit`

`key` text PK, `count` integer, `resetAt` integer: fixed-window counters for sign-in emails (per address hash, per IP hash, site-wide) and reminder emails (per user, site-wide).

### `push_subscription`

`id, userId (cascade), endpoint (unique), p256dh, auth, device, createdAt, lastPushedAt`: one row per browser or installed app with phone notifications on (section 15).

## 5. Screens and routes

Phone-first: a single column up to 640px, a bottom tab bar on phones (Today, People, Library, History) and a top bar on wider screens.
Every page is light only (whatever the system setting), meets WCAG 2.2 AA contrast, has visible focus rings, and is usable by keyboard.

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | public | What Tend is, how it works in three steps, sign-in button ("Open Tend" when signed in) |
| `/signin` | public | Email form (with Turnstile) and GitHub button when configured |
| `/signin/check-email` | public | "Check your email" |
| `/today` | user | Pause banner; Due now; Due to reach out (keep-in-touch cadences that have come due); Birthdays and anniversaries (next 14 days); Upcoming (next 14 days); people who could use a message (consent yes, nothing in the last `minDaysBetween` days and nothing scheduled) |
| `/people` | user | Contact list with search, consent badges, next scheduled |
| `/people/new` | user | Create contact |
| `/people/[id]` | user | Consent panel, keeping in touch (last in touch, next due, birthday, anniversary, "We were in touch today"), picks for an occasion within 14 days, suggestions, scheduled, history, consent log, edit and delete |
| `/people/[id]/edit` | user | Edit contact |
| `/compose` | user | `?contact=&content=&kind=&occasion=`: compose, preview, schedule; with an occasion, the greeting is written and their day itself is the suggested time |
| `/send/[messageId]` | user | The send screen |
| `/library` | user | Browse and filter the library by topic and kind |
| `/history` | user | All sent, skipped and canceled messages |
| `/settings` | user | Time zone, translation, email reminders, pause all, export, delete account, sign out |
| `/stop/[token]` | public | Recipient's stop page (GET shows a button, POST stops) |
| `/privacy`, `/terms` | public | Short, plain policies |
| `/api/auth/[...nextauth]` | public | Auth.js |
| `/api/export` | user | JSON download of everything the user owns, decrypted |
| `/api/cron/reminders` | cron secret | The reminder run |
| `/opengraph-image` | public | Share card |

Mutations are server actions; each one re-reads the session, validates with zod and checks ownership.

## 6. Delivery design: the send screen

The send screen shows the exact message in a read-only box and, in order:

1. **Share to Signal** (only when `navigator.share` exists, which covers Android and iOS): shares the text; the user picks Signal and the person.
2. **Copy message**: copies the text and shows "Copied".
3. **Open chat with <name>** (only when a phone number is stored): `https://signal.me/#p/<E.164>`, opened in a new tab; on a phone it opens Signal, on a desktop it opens Signal Desktop through the signal.me page.
4. **I sent it**: marks the message sent (`sentAt = now`). The person has already sent it, so only consent is re-checked: it refuses if the contact is now at `no` or `stopped`. Marking a consent request sent moves the contact from `not_asked` to `asked`.
5. **Skip** and **Reschedule**.

Signal links cannot carry text (PRD-REVIEW.md, 3c), so copy plus open is the universal path.
The body is plain text; the reading link and stop link are on their own lines so Signal renders them as links.

### Message format

```
<optional personal note>

"<exact text>"
- <reference> (<translation>)        e.g. - Psalm 23:1 (WEB)
                                     or   - Marcus Aurelius, Meditations 4.3 (tr. George Long)

<optional question>
Read more: <reading link>             (optional)
Stop these messages: https://tend.n8builds.dev/stop/<token>   (optional, on by default for a contact's first three messages)
```

A consent request:

```
Hi <name>, I'd like to send you an occasional Bible verse or quote I think you'd like, maybe once a <week|fortnight|month>, on Signal. Would that be OK? No pressure at all, and you can say stop anytime.
```

## 7. Content pipeline

### Topics

16 fixed slugs: `comfort`, `hope`, `peace`, `courage`, `strength`, `gratitude`, `joy`, `love`, `friendship`, `forgiveness`, `patience`, `wisdom`, `purpose`, `rest`, `grief`, `new-beginnings`.

### Item shape (`content/library.json`)

```ts
type ContentItem = {
  id: string                 // stable slug, e.g. "psalm-23-1-4"
  kind: 'scripture' | 'quote'
  reference: string          // "Psalm 23:1-4" or "Meditations 4.3"
  text: Record<Translation, string> | string  // scripture has every translation, quotes one text
  author?: string            // quotes
  work?: string              // quotes
  translator?: string        // quotes, e.g. "George Long (1862)"
  license: 'public-domain'
  sourceUrl: string          // where the exact text was checked
  readingUrl: string         // a page to read more in context
  context: string            // one or two sentences, written by us
  topics: TopicSlug[]        // 1 to 4
}
```

### Verification

- `scripts/build-library.mjs` reads `content/scripture-refs.json` (id, reference, chapter, topics, context) and fetches each passage from bible-api.com in every translation in `TRANSLATIONS`, 2.2 seconds apart (under its 15 per 30 seconds limit), normalising whitespace only.
  Reading links point to the chapter in the same translation, on Bible Gateway where it has it and on ebible.org otherwise.
- The same script downloads each quote's Project Gutenberg plain text (`content/quotes.json`) and fails unless the exact quote (whitespace normalised) is present, then writes `content/library.json`.
  With `--check` it writes nothing and fails if the committed library differs from its sources; the Content workflow runs that on every pull request that touches `content/`.
- A unit test checks the committed library: unique ids, valid topics, non-empty text, `license` is `public-domain`, HTTPS URLs, at least two items per topic.
- New content arrives by pull request and must pass the script; CONTRIBUTING.md explains how.

### Suggestions

For a contact, score each library item:

```
score = sum(weight of the contact's topics the item has) * 10
      + 3 if item.kind differs from the kind of the last message sent to them
      - excluded if sent to this contact in the last 180 days or already scheduled for them
```

Ties break by a stable hash of `(contactId, itemId, ISO week)`, so suggestions vary week to week without being random on every load.
The top five are shown; "Browse library" shows the rest.
A contact with no topics gets the most broadly tagged items.

"Surprise me" (on the contact page) picks one item at random from the whole library, whatever their topics, with the same exclusions: nothing sent to them in the last 180 days and nothing already scheduled for them.
It opens the pick in compose, where "Surprise me again" picks another (not the same one, when there is a choice).

## 8. Scheduling and reminders

### Choosing a time

`nextGoodTime(contact, now)`:

1. Start at the later of `now + 10 minutes` and `lastSentOrScheduled + minDaysBetween`.
2. Move to the first allowed day (in the contact's time zone) whose window has not ended.
3. Pick a minute uniformly inside the window (from the start, or from now if the window is open), rounded to 15 minutes.
4. If the 30-day cap would be exceeded, move to the day after the oldest message in the window leaves it.

The compose screen offers "Next good time" (the default, shows the result), "Now" and a custom date and time; a custom time is validated against the same rules and refused with a clear reason.

### Rules enforced on the server

At schedule time (and consent only, at mark-sent time):

- Consent: `content` and `personal` need `yes`; `consent_request` needs `not_asked` or `asked`; nothing for `no` or `stopped`.
- `minDaysBetween` since the last sent or scheduled message to this contact (consent requests are exempt from content spacing but limited to one open at a time).
- `maxPer30Days` over sent plus scheduled within any 30-day window around the time.
- Window and allowed days in the contact's time zone (scheduling only; "I sent it" outside the window is allowed: the user sent it).
- Global pause: no scheduling while paused.
- Per-user cap: 20 scheduled messages at once; 500 contacts.

### The cron

Cron Trigger `*/15 * * * *` calls the reminder code directly (worker/cron.ts), without a request through Next.js. `POST /api/cron/reminders` with `Authorization: Bearer $CRON_SECRET` runs the same code by hand.
The run:

1. Selects messages with `status = 'scheduled'`, `scheduledFor <= now`, `remindedAt IS NULL`, whose user has a reminder channel (email, phone notifications or Telegram) and no `pausedAt`, and whose contact still allows sending.
2. Groups them by user; for each user (up to 100 users a run):
   - claims the rows with `UPDATE message SET remindedAt = now WHERE id IN (...) AND remindedAt IS NULL` and continues only with the rows it claimed, so overlapping runs cannot email twice;
   - spends from the per-user daily cap (6) and the site-wide daily cap (`REMINDER_EMAILS_DAILY`, default 10);
   - sends one email: "Time to send a message to Sam" (or "3 messages are due"), each with a link to its send screen;
   - sends one phone notification to each device with notifications on, within its own caps (section 15).
3. A message whose contact has become `no` or `stopped` is set to `canceled` instead.

Due messages show in "Due now" whether or not an email was sent; messages more than 7 days overdue move to "Missed" with Reschedule and Skip.

### Occasions and keeping in touch

The rules are pure functions in `lib/occasions.ts`; `lib/server/nudges.ts` loads the data and the cron sends.

- **Dates.** A birthday or anniversary is a month and day with an optional year, in the person's own time zone: it is "today" when it is that day where they live. 29 February falls on 28 February in common years.
- **Occasion reminders.** One from `occasionLeadDays` before (a run that missed the first day sends it the next), and one on the day, each only while their contact window is open (their allowed weekdays do not apply: a birthday falls when it falls).
- **Keep in touch.** Last in touch is the later of the last message marked sent and `lastInTouchAt`. The next due time is `cadenceDays` after that (or after the contact was added, if never), moved to the first slot their window, allowed days, spacing and 30-day cap allow (`nextGoodTime` from that moment, earliest slot). The reminder goes once that time has passed, while their window is open on an allowed day, keyed by the due date.
- **Who gets reminded.** Only for a person at consent `yes`, not archived, with nothing already scheduled for them, while the user is not paused. Today and the person page still show the dates for everyone, with a note when they have not said yes.
- **Delivery.** Each run's reminders are claimed in `nudge` (insert, do nothing on conflict) and travel with the due messages: one email, one phone notification, and one Telegram message each (with an "Open in Tend" button), within the same caps. If nothing delivers and a later run could, the claims are handed back.
- **Suggestions.** A reminder opens the person page, which shows picks for the occasion (`OCCASION_PICKS`: blessings such as Numbers 6:24-26 for a birthday, passages on love and companionship for an anniversary; never one sent in the last 180 days or scheduled) and "Write your own wishes". Compose starts the note with "Happy birthday, Sam!" and offers the start of their window on the day itself when their rules allow it.

## 9. Consent flow

1. New contact starts at `not_asked`.
   The contact page shows "Ask first" with a drafted consent request (a `consent_request` message) to send through the normal send screen.
2. After sending it, the contact is `asked`.
3. The user records the answer: Yes (to `yes`) or No (to `no`).
   Only `yes` unlocks suggestions and content messages.
4. The user can mark "They asked me to stop" (to `stopped`, by you) at any time; every scheduled message is canceled.
5. The recipient can open their stop link: GET shows "Stop messages from <first name of sender>?" with one button; POST sets `stopped`, `stoppedByRecipient = true`, cancels scheduled messages, and shows "Done. Tend will no longer remind them to send you these messages, and they will see that you asked to stop."
   The page never shows the sender's email or the recipient's details, is `noindex`, and has no preview image.
6. A contact stopped by the recipient can be set back to `yes` only after the user ticks "They told me they want messages again"; the consent log keeps both events.

## 10. Security and privacy

- **Sessions:** Auth.js database sessions, `__Secure-` cookies, `SameSite=Lax`, 30-day expiry.
- **Isolation:** every query is scoped by `userId`; a helper `requireUser()` returns the id or redirects; contact and message lookups use `(id, userId)`.
- **Encryption:** `lib/crypto.ts` encrypts `phone` and `notes` with AES-256-GCM via WebCrypto; key derived with HKDF-SHA-256 from the `DATA_ENCRYPTION_KEY` secret (a random string of 32 or more characters); each value is `v1.<iv>.<ciphertext>`; a key version prefix allows rotation.
- **Headers:** CSP with per-request nonce (scripts from self and `challenges.cloudflare.com` only), `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS, `Permissions-Policy` denying camera, microphone and geolocation.
- **Abuse:** Turnstile on the email sign-in form, with `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` as Worker settings (so changing them needs no rebuild); in production a missing key refuses email sign-in with a clear error, the token's hostname must be the app's own, and outside production Cloudflare's test keys or the dev flag `TURNSTILE=off` work; the Auth.js route refuses a direct POST to `/api/auth/signin/email`, so every email link goes through that check; sign-in emails at most 5 per address and 20 per IP a day, and 10 a day site-wide (until Tend sends through the mailroom with a monthly slice); reminder emails as in section 8.
- **Stop tokens:** 256-bit random, compared by exact lookup; rate-limited by Cloudflare's default protections.
- **Logging:** structured JSON logs with ids and outcomes only; never names, numbers, notes, message bodies or emails.
- **Deletion:** deleting a contact deletes its messages and consent events; deleting the account deletes the user row and everything cascades; sessions end immediately.
- **Export:** `/api/export` returns contacts (decrypted), topics, messages and consent events as JSON.
- **Secrets:** Worker secrets only (`AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `CRON_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, optional `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `VAPID_PRIVATE_KEY`; `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are required for email sign-in), kept in pass under `tend/`.

## 11. Limits

| Limit | Value |
| --- | --- |
| Contacts per user | 500 |
| Scheduled (open) messages per user | 20 |
| Topics per contact | 6 |
| Message body | 2,000 characters |
| Notes | 1,000 characters |
| Sign-in emails | 5 per address, 20 per IP, 10 site-wide, per UTC day |
| Reminder emails | 6 per user, 10 site-wide, per UTC day |
| Telegram bot messages | 20 per user, 300 site-wide; replies to unlinked chats 3 per chat and 50 overall; per UTC day |
| Phone notifications | 6 per user, 10 site-wide, per UTC day (tests: 5 per user); 10 devices per user |

## 12. Tests

- **Unit (Vitest):** scheduling rules (`nextGoodTime`, caps, windows across DST and time zones), occasion dates and reminders across time zones, cadence math, suggestion ranking, message formatting, consent transitions, encryption round trip, rate limits, library validity, cron claim logic against a local libSQL file.
- **End to end (Playwright, Chromium, phone and desktop viewports):** sign in with the test-mode email provider (writes the link to a file); create a contact; ask consent and record yes; pick a suggestion, compose, schedule; run the cron route and see the reminder (test email sink); send screen copy and mark sent; caps refuse a too-soon message; a birthday today and a due keep-in-touch cadence each reminded once; recipient stop page stops and cancels; pause all; export; delete account; axe accessibility checks on every main page.
- **CI:** lint, typecheck (app and worker), unit, Cloudflare build plus deploy dry run, e2e.

## 13. Deploy

- Worker `tend`, custom domain `tend.n8builds.dev` (`routes` with `custom_domain: true`, `workers_dev: false`).
  The first deploy that attaches the domain runs from the owner's machine with wrangler's OAuth login (the CI token cannot create DNS); later deploys run in GitHub Actions.
- `.github/workflows/deploy.yml` on push to `main`: install, apply migrations to Turso (`scripts/migrate.mjs`), build, `opennextjs-cloudflare deploy`, with `CLOUDFLARE_API_TOKEN` (from `shared/CLOUDFLARE_DEPLOY_TOKEN`), `CLOUDFLARE_ACCOUNT_ID`, `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` as repository secrets.
- Placement near the Turso region, `aws-us-east-2`.
- Turnstile: the owner creates widget "Tend sign-in" (Managed) for hostname `tend.n8builds.dev`, then sets `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` as Worker secrets; no rebuild is needed.

## 14. Milestones

| Milestone | Contents | Exit |
| --- | --- | --- |
| M0 | PRD review and this spec | Merged |
| M1 MVP | Everything in section 2 MVP, deployed | Live at tend.n8builds.dev, CI green, owner signs in |
| M2 | CSV import/export, SMS invite link, usernames | |
| M3 | Telegram, Web Push, installable app | Shipped |
| M4 | Opt-in AI suggestions (labels only) | |
| M5 | Community content queue | |

## 15. Installable app and phone notifications

### The app

- `app/manifest.ts` serves `/manifest.webmanifest`: name and short name Tend, `start_url` `/today` (which sends anyone signed out to sign in), scope `/`, `display: standalone`, theme `#2f6b4f`, background `#f7f5f0`.
- Icons are rendered from `app/icon.svg` by `scripts/render-icons.mjs` and committed: 192 and 512 (`any`), a full-bleed 512 `maskable`, `app/apple-icon.png` (180, full bleed, since iOS rounds it and fills transparency with black) and a white 96 badge for Android notifications.
- Settings, "On your phone": Install Tend uses the browser's install prompt (Chrome, Edge, Android), shows the Share, then Add to Home Screen steps on iPhone and iPad, and says Tend is installed when it runs as the app.
- Phones also get a one-time hint at the top of the signed-in pages: offered once, kept while the app stays open, never on Settings or in the installed app.
- The root layout's inline script (with the page's CSP nonce) keeps the `beforeinstallprompt` event from the first moment, so a prompt that fires before hydration is not lost.

### The service worker

- `public/sw.js`, registered from `/sw.js?v=<build id>` in production builds (`NEXT_PUBLIC_BUILD_ID`: the commit in CI, else a timestamp). A new build is a new script URL, so phones install the new worker, which takes over at once and deletes the previous version's shell cache.
- Cached: the offline page and icons (per version), and `/_next/static/*` files, which are content-hashed and immutable (cache first, at most 200 entries).
- Never cached: pages and the API, which carry the user's people and messages. A page that cannot load offline gets `public/offline.html`, static and free of user data, with Try again.
- The CSP adds `worker-src 'self'` (the nonce and `'strict-dynamic'` would otherwise refuse the worker) and `manifest-src 'self'`.

### Web Push reminders

- Free, standard Web Push with VAPID (RFC 8291 encryption, RFC 8292 signing) on Web Crypto only (`lib/webpush.ts`), so it runs in the Worker with no library.
- On only when the Worker has the `VAPID_PRIVATE_KEY` secret (`tend/VAPID_PRIVATE_KEY` in pass, made with `pass-env generate tend/VAPID_PRIVATE_KEY 64 --charset hex`: the 32-byte P-256 key).
  The public key the browser subscribes with is derived from it at runtime (Web Crypto computes it on a PKCS #8 import), so there is no second value to keep in step. `VAPID_SUBJECT` defaults to the site's URL.
  Rotating the key ends every subscription: people turn notifications on again.
- Settings, "Phone notifications" (per device): on asks permission, subscribes with the public key and stores the subscription in `push_subscription` (endpoint, keys, a device label like "Chrome on Android"); off unsubscribes and deletes it. Other devices are listed with "Turn off on other devices"; "Send a test notification" sends one (5 a day per user).
- Only endpoints at the browsers' push services are accepted (`fcm.googleapis.com`, `push.services.mozilla.com`, `push.apple.com`, `notify.windows.com`, https only), so the server never posts anywhere else; at most 10 devices per user.
- iPhone and iPad support Web Push only in the installed app (iOS 16.4 and later), so Settings explains that and turns notifications on from there.
- The reminder run (section 8) sends one notification per user per run to each of their devices: "Time to message Sam" opens `/send/<id>`; several due messages open `/today`. Caps as for reminder email: 6 per user and 10 site-wide per UTC day (`PUSH_PER_USER_DAILY`, `PUSH_SITE_DAILY`). TTL 12 hours, `Topic: tend-reminder` so a newer reminder replaces an undelivered one.
- Email and push are separate choices (email in Preferences, push per device); a person can use either or both. When no channel delivers, the claim is handed back as for email.
- A 404 or 410 from the push service deletes that subscription. Subscriptions are stored as given: without Tend's VAPID private key, which the push services check, they cannot be used to send anything.

### Tests

- Unit: the RFC 8291 example byte for byte, a round trip with fresh keys, the VAPID JWT and its signature, endpoint allowlist, notification text, device labels.
- End to end: the manifest and every icon's size, Chrome's installability check (`Page.getInstallabilityErrors`, empty), the service worker registering with the build version, the offline page with nothing personal cached, turning notifications on in Settings and receiving the encrypted, signed reminder at a local push service (`e2e/telegram-mock.mjs`, `PUSH_TEST_BASE`), a 410 deleting the subscription, and the install hint and steps on iPhone.
