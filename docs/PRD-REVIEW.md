# PRD review: Signal Relationship Messenger

Source: [docs/PRD.md](PRD.md) (v1.0 draft, 2026-11-09), written for one owner on a self-hosted Linux box.
New requirement from the owner (2026-11-10): the app is public, multi-user, sign-in required, open source, hosted on Cloudflare at a subdomain of n8builds.dev.
This document has two passes.
Pass 1 analyses the PRD against that new requirement.
Pass 2 challenges Pass 1 and records what changed as a result.
The decisions that survive both passes are listed at the end and are what [SPEC.md](SPEC.md) builds.

Facts below were checked on 2026-11-10; sources are linked inline.

## Pass 1: analysis

### 1. What the PRD gets right

- The core loop is good and small: pick a person, pick something worth sending, review it, send it at a sensible time, remember that you did.
- It treats consent, quiet hours, frequency limits, opt-out and a kill switch as requirements, not features.
- It refuses to fake delivery state: "do not claim delivered/read without reliable receipts."
- It rejects mass outreach, contact scraping and impersonating autonomous replies.
- It insists that quoted text is verified against an authoritative source rather than generated.

### 2. What the public, multi-user requirement breaks

The PRD assumes a single trusted operator who owns the server, the Signal account and the data.
A public app breaks each of those assumptions:

| PRD assumption | Public reality |
| --- | --- |
| One owner, basic auth or VPN | Anyone can sign up; real auth, per-user isolation and abuse limits are needed |
| signal-cli linked to the owner's account on the owner's box | We would be holding many strangers' Signal sessions on our servers |
| Docker Compose on a headless Linux host | Cloudflare Workers: no long-running processes, no JVM |
| SQLite file with encrypted backups | Turso (the owner's standard, HANDOFF-2026-11-10-ops.md: "Turso stays") |
| Gemini sees "minimal contact topic context" | Third-party data processing for every user's contacts needs a privacy basis |
| The owner's own judgment is the spam filter | Any user could try to use it to spam |

### 3. Signal delivery: the central question

Signal has no official bot, business or sending API.
Three options were on the table.

#### Option (a): signal-cli or signal-cli-rest-api, linked as a secondary device, hosted by us

- signal-cli is an unofficial client in Java; signal-cli-rest-api wraps it in Docker.
  It needs a long-running process that keeps a protocol session and receives messages; Workers cannot host it.
- Cloudflare Containers could run it.
  Containers need Workers Paid; the plan includes 25 GiB-hours of memory, 375 vCPU-minutes and 200 GB-hours of disk a month, and the Free column is N/A ([Containers pricing](https://developers.cloudflare.com/containers/pricing/)).
  One always-on container with 0.5 GiB for a JVM is about 365 GiB-hours a month, more than 14 times the included memory, before CPU.
  It also sleeps when idle and would need its state on durable storage, which containers do not keep across restarts by default.
  So it does not fit "never pay", and the cost grows per user.
- Signal's Terms of Service, under "Legal and Acceptable Use", forbid "sending illegal or impermissible communications such as bulk messaging, auto-messaging, and auto-dialing" ([signal.org/legal](https://signal.org/legal/)).
  A scheduler that sends on the user's behalf at a random time is auto-messaging in the plainest reading.
  The same terms forbid accessing or using the services "in unauthorized manners", and Signal "may ... terminate your access ... anytime for any reason".
- Signal rate-limits unusual senders with a "proof required" challenge (a captcha) that a headless client cannot answer by itself; signal-cli documents `submitRateLimitChallenge` for exactly this ([signal-cli-rest-api #536](https://www.github.com/bbernhard/signal-cli-rest-api/issues/536)).
  Scheduled sends from a datacenter IP are the pattern most likely to trigger it.
- Linked devices unlink when the phone has not come online for 30 days, or after 45 days of device inactivity ([Signal support](https://support.signal.org/hc/en-us/articles/360007320551)), so the link needs care and monitoring.
- Holding a linked-device session means holding the private keys that can read and send every future message on a person's account.
  For a public app, one breach would expose every user's Signal conversations.

Verdict: rejected for the hosted app.
It breaks Signal's terms, puts every user's account at ban risk, makes us custodians of their message keys, and costs money that grows with users.

#### Option (b): an optional self-hosted bridge the user runs

The idea: the user runs signal-cli-rest-api in Docker on their own machine, linked to their own account, polling the app for due messages.
It moves the keys off our servers, which fixes the custody problem.
It does not fix the terms: the send is still automated, and still auto-messaging under Signal's terms.
It also hands the user a JVM, Docker, a QR link over SSH, a long-lived API token and monitoring, which few people can run safely.
Verdict in Pass 1: defer; maybe a later, clearly opt-in milestone. (Pass 2 revisits this.)

#### Option (c): the app prepares, the person sends

- Signal links open a chat with a person: `https://signal.me/#p/+<E.164>` opens a chat in the user's Signal client; `sgnl://` has the same shape ([shkspr.mobi on Signal's URI scheme](https://shkspr.mobi/blog/2023/02/signals-newish-uri-scheme/)).
- There is no text parameter: Signal's own route table has routes for phone numbers and usernames only, with no message field (Signal-Desktop `ts/util/signalRoutes.ts`), and users of automation apps report the same ([Drafts forum](https://forums.getdrafts.com/t/signal-private-messenger/8119)).
  This is unlike WhatsApp's `wa.me/<number>?text=`.
- So the flow is: copy the exact message to the clipboard, open the chat link, paste, send, come back and mark it sent.
  On Android the Web Share API (`navigator.share`) can also hand the text straight to Signal's share sheet entry, which then asks for the recipient: one tap fewer than paste.
- Nothing is automated on Signal, no keys leave the user's phone, no infrastructure is needed, and it costs nothing.
- The cost is friction: the user must be present.
  The app removes the rest of the work: what to send, to whom, when, and whether it is too soon.

Verdict: (c) for the hosted app.

#### Reminders replace automated sending

Because the person sends, the scheduler's job changes from "send at time T" to "remind the user at time T".
The reminder is an email ("Time to send Psalm 23 to Sam") through Cloudflare Email Service, plus a "Due now" list in the app.
Email Service sending needs Workers Paid and includes 3,000 emails a month per account, then $0.35 per 1,000 ([Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/)); the owner's account is already on Paid and shares that quota across projects, so the app must cap its email.

### 4. Consent model

The recipient is not a user of the app, so the app can only record what the sender tells it, plus one thing it can enforce:

- Each contact has a consent state: not asked, asked, yes, no, stopped.
- Only a contact at "yes" can be sent content; a contact at "not asked" can only be sent a consent request ("Would you like an occasional verse or quote from me?"), which the app drafts.
- "No" and "stopped" block everything except deletion.
- An easy stop the recipient controls: every message can carry a short personal stop link (`/stop/<token>`).
  Opening it shows a page with one button; pressing it marks the contact stopped and cancels anything scheduled.
  The action is a POST, because Signal fetches link previews with a GET and a preview must never stop anything.
- Frequency limits enforced by the app at schedule time and at mark-sent time: a minimum gap between messages to one person, a maximum per 30 days, and a per-user daily cap.
- Quiet hours in the contact's time zone: a reminder is never scheduled outside the window.
- A global pause for the user.

### 5. Content

- Scripture: only public-domain translations.
  The World English Bible is public domain; "World English Bible" is a trademark of eBible.org, and changed text must not use the name ([ebible.org copyright](https://ebible.org/web/copyright.htm)).
  The King James Version is public domain except in the United Kingdom, where it is under perpetual Crown letters patent administered by Cambridge University Press ([ebible.org KJV](https://ebible.org/kjv/copr.htm)).
  So WEB is the default; KJV is offered with a note.
- Text comes from bible-api.com, which serves WEB and KJV, allows 15 requests per 30 seconds, and asks that whole Bibles are taken from its open-bibles repository instead ([bible-api.com](https://bible-api.com/)).
  The library is small and curated, so a script fetches each passage once and the result is committed.
- Quotes: public-domain translations and authors only, each checked against a full public-domain source text (Project Gutenberg) by a script that requires the exact text to appear in the source.
  No "attributed to" quotes: if it cannot be found in the source, it is not in the library.
- Data model: a content item has kind, reference, exact text, author, work, translation, licence, source URL, reading URL, short context, and topic tags.

### 6. AI suggestions

The PRD's Gemini step sends "minimal contact topic context" to a third party.
For a public app every user's contacts would pass through it.
With a small curated library, deterministic ranking (topic match weighted by the contact's topics, minus anything recently sent to them, with variety across kinds) gives good suggestions with no third party and no hallucination risk.
Verdict: no AI in the MVP; a later opt-in milestone that sends only topic labels, never names or notes.

### 7. Privacy

Contacts are personal data about people who never signed up.

- Minimise: a contact needs a name only; a phone number is optional and only used to build the chat link; notes are optional and warned against for health or other sensitive details.
- Encrypt at rest at the application layer: phone numbers and notes are encrypted with AES-GCM before they reach the database, with a key held as a Worker secret, on top of Turso's own storage encryption.
- Delete: deleting a contact deletes its messages; deleting the account deletes everything, at once, not after a grace period.
- Export: a JSON export of everything the user owns.
- No analytics on contact data, no third-party scripts beyond Turnstile on the sign-in form.

### 8. Sign-in and abuse

- Auth.js email magic link through Cloudflare Email Service from `<name>@n8builds.dev` (the owner's standard, as in net_trailers), optional GitHub.
- Turnstile on the sign-in form; built optional so the app works before the widget exists, required once the secret is set.
- Sign-in email limits per address, per IP and per day for the whole site, because every link spends the shared 3,000.
- Per-user caps on contacts and scheduled messages; the app never sends anything to a contact, so spam through the app is limited to what a user could paste by hand anyway.

### 9. Hosting fit

Workers + OpenNext + Next.js + Turso is the owner's house stack (net_trailers, portfolio-rank).
A Cron Trigger every 15 minutes is enough to find due reminders; Durable Object alarms would give second-level precision the product does not need.

## Pass 2: review of Pass 1

Each point challenges a Pass 1 conclusion; the outcome is recorded.

1. **"Option (c) is too much friction; people will stop using it."**
   Partly true.
   But the friction is the product's point: a message that is meant to show you thought of someone should be sent by you, in your own conversation, where you see their reply.
   The PRD itself rejects "autonomous responses that impersonate the owner"; a scheduled message the person never saw go out is close to that.
   Mitigation: make the send path two taps on a phone (Share to Signal on Android; Copy and Open chat elsewhere), and make the reminder email open straight to that screen.
   Outcome: keep (c).

2. **"Isn't the self-hosted bridge (b) fine if it is the user's own account on the user's own machine?"**
   Pass 1 said "defer"; that was too soft.
   The terms ban auto-messaging regardless of where the client runs, so building it would mean shipping a tool whose purpose is to break the terms of the network it depends on, from a public open-source repo under the owner's name, to strangers who may not read the warning.
   Even a "send now" button that sends through the bridge saves only the paste and adds a JVM, Docker and a key on disk.
   Outcome: the bridge is not built and not on the roadmap.
   The spec states this and revisits only if Signal publishes an official API or written permission.

3. **"Is the PRD's own owner-only use (signal-cli on his box) now forbidden too?"**
   That is outside this repo.
   The review notes that the same clause applies and the owner should decide for his private setup with that in mind.

4. **"Is the stop link a consent theatre? The sender can just re-enable the contact."**
   The sender can, because the sender is the one who has the relationship and may hear "please start again" in person.
   But a stop set by the recipient is recorded as such, shown with a badge, and re-enabling it requires the sender to confirm they asked; the history keeps the event.
   Outcome: keep, with a "stopped by them" state distinct from the sender's "no".

5. **"Signal's link preview might trigger the stop link."**
   Pass 1 already required POST.
   Link previews only read Open Graph tags with a GET; they never submit forms.
   The stop page also sets `noindex` and has no Open Graph image, so the preview is plain.
   Outcome: confirmed.

6. **"Does the app need the phone number at all?"**
   Only for the chat link.
   A Signal username works too, but `signal.me/#eu/` links need the username's encrypted form, which only a Signal client can produce.
   Outcome: phone optional; without it the send screen offers Copy and Share only.
   Usernames are a later milestone.

7. **"Is application-level encryption worth it when only the server holds the key?"**
   It protects against the most likely leak, a database token or backup leaking on its own, and costs little.
   It does not protect against a compromised Worker; that is stated honestly in the privacy page.
   Searching contacts by phone becomes impossible; nothing needs that.
   Outcome: keep, for phone and notes.

8. **"Email reminders cost the shared quota; could they be dropped?"**
   In-app "Due now" works without email, and a web push reminder would be free.
   But email is the one channel that reaches a phone reliably without a PWA install, and the user asked for it.
   Outcome: email reminders on by default with a cap (one digest per user per cron run, at most 6 a day, and a site-wide daily cap); web push is a later milestone.

9. **"Is 15-minute cron precision right when the PRD wanted random times inside a window?"**
   The PRD's randomness existed to make automated sends look human.
   With the person sending, a reminder time is just "when should I be nudged".
   The app still picks a time inside the contact's window (the next allowed day, a random minute in the window) so suggestions do not all land at 9:00, and the user can change it.
   Outcome: keep, 15-minute cron.

10. **"Is a curated library too small to be useful?"**
    A few dozen well-chosen items cover the common topics, and the per-contact "not sent in the last 180 days" rule stops repeats.
    Users can also write their own message without library content.
    Outcome: start with about 40 verified items; growth is by pull request, which also gives contributors a clear way to help.

11. **"Name and trademark."**
    "Signal" is a trademark; the product must not use it in its name.
    Outcome: the product is **Tend**, described as "for Signal", at `tend.n8builds.dev`.

12. **"Is MIT right?"**
    The value here is the consent model and the curated content, not a moat.
    MIT is the simplest licence for contributors, matches net_trailers, and FSL's protection matters only for a product someone might resell as a service.
    Outcome: MIT.

## Decisions

| Area | Decision |
| --- | --- |
| Name | Tend, "thoughtful messages for the people you care about, for Signal"; `tend.n8builds.dev`; repo `n8watkins/tend`, MIT |
| Delivery | The person sends: copy plus `signal.me` chat link, or Share on Android. Tend's server never sends to Signal. Since 2026-11-11 (below), an optional helper on the person's own PC may send what they approve |
| Automation | No signal-cli on Tend's infrastructure, ever. Reversed in part on 2026-11-11: an opt-in, self-run helper with approve-first (phase 1, built, private to the owner); auto-send (phase 3) not before Signal's permission is revisited. See [SIGNAL-HELPER.md](SIGNAL-HELPER.md) |
| Scheduling | Reminders, not sends: a Cron Trigger every 15 minutes, email digest plus in-app "Due now" |
| Consent | Per-contact states; content only to "yes"; recipient stop link (POST); frequency and quiet-hour rules enforced server-side; global pause |
| Content | Curated, PR-reviewed library: WEB (default) and KJV scripture from bible-api.com, public-domain quotes checked against Gutenberg texts |
| AI | None in the MVP |
| Privacy | Name only required; phone and notes encrypted with AES-GCM; delete and export; no analytics |
| Stack | Next.js on Workers via OpenNext, Auth.js magic link via Email Service, optional GitHub, Turso with Drizzle, Turnstile optional until configured |

### 2026-11-11: an optional Signal helper

The owner reconsidered the "no automation" decision above for a narrow case, designed in [SIGNAL-HELPER.md](SIGNAL-HELPER.md).
It answers the three original reasons rather than setting them aside: approve-first keeps a person deciding each send, the keys stay on the user's own PC (Tend never hosts signal-cli), and nothing new runs on paid infrastructure.
The owner's decisions:

- Each user links the helper to their own number; the owner uses theirs.
- Signal is not asked for permission yet; that is revisited before phase 3 (auto-send).
- The helper is private to the owner for now: the code is in the repo, but the Settings section shows only for accounts in `SIGNAL_HELPER_USERS`, and the README does not mention it yet.
- The caps are as written in SIGNAL-HELPER.md 4.2.

Phase 1 (approve first, by phone notification) is built; SPEC.md section 16 describes it.
