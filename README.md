# Tend

Thoughtful messages for the people you care about, for Signal.

Tend suggests a verified Bible passage or a public-domain quote that fits each person, reminds you when it is a good time, and remembers what you sent so you never repeat yourself or overdo it.
You send every message yourself, from your own Signal.

**Live:** https://tend.n8builds.dev

Tend is an independent project and is not affiliated with Signal.

## How it works

1. Add someone: a name is enough, plus a few topics that matter to them (hope, courage, friendship...) and how often is right.
2. Ask first: Tend drafts a short, friendly question asking if they would like the occasional message. Only people who say yes get content.
3. Get a nudge: at a good time inside their window, Tend emails you and shows the message on Today.
4. Send it yourself: copy the message, open your Signal chat with them (one tap with their number), paste, send, and tap "I sent it".

Every message can carry a private stop link. If the person uses it, Tend cancels everything scheduled for them and tells you.

## Why Tend never sends for you

Signal has no official API for apps, and its terms forbid "bulk messaging, auto-messaging, and auto-dialing".
Unofficial clients such as signal-cli would also mean holding your Signal keys on a server.
So Tend prepares and reminds; you send.
The full reasoning is in [docs/PRD-REVIEW.md](docs/PRD-REVIEW.md).

## Content

- Bible passages in eight public-domain translations (WEB, WEB British Edition, KJV, ASV, Berean Standard Bible, Bible in Basic English, Darby and Douay-Rheims), fetched from [bible-api.com](https://bible-api.com). Everyone picks a default, and can choose another per person. Licences and sources, and the translations we cannot offer yet, are in [docs/TRANSLATIONS.md](docs/TRANSLATIONS.md).
- Quotes from public-domain works (Marcus Aurelius, Epictetus, Emerson, Thoreau, Augustine, Boethius, Thomas à Kempis), each checked word for word against its Project Gutenberg text.

`node scripts/build-library.mjs` rebuilds `content/library.json` from `content/scripture-refs.json` and `content/quotes.json`, and fails if any quote is not found in its source.
See [CONTRIBUTING.md](CONTRIBUTING.md) to suggest more.

## Stack

Next.js 16 on Cloudflare Workers (OpenNext), Auth.js email magic links sent through the shared mailroom (account-wide email cap; Tend: 30 a day, 150 a month, 8 per recipient a day) and optional GitHub, Turso (libSQL) with Drizzle, Tailwind CSS 4, a Cron Trigger every 15 minutes for reminders, and Cloudflare Turnstile on sign-in.
The design is in [docs/SPEC.md](docs/SPEC.md).

## Development

Requires Node 22 or later.

```sh
npm install
# A local database and the variables the app needs, nothing secret:
export TURSO_DATABASE_URL=file:.e2e/dev.db
export AUTH_SECRET=dev-only-secret-change-me-dev-only-secret
export DATA_ENCRYPTION_KEY=dev-only-encryption-key-at-least-32-chars
export APP_ENV=test   # writes sign-in emails to .e2e/email instead of sending them
node scripts/migrate.mjs
npm run dev           # http://localhost:7841
```

Sign in with any address; the link is in `.e2e/email/<address>.jsonl`.

| Command | What it does |
| --- | --- |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript for the app and the Worker |
| `npm test` | Unit tests (Vitest) |
| `npm run build && npm run test:e2e` | End-to-end tests (Playwright) on phone and desktop, with axe checks |
| `npm run db:generate` | Write a migration after changing `db/schema.ts` |
| `npm run build:worker` | The Cloudflare Worker bundle |

## Deploying your own

1. Create a Turso database and apply the migrations: `TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/migrate.mjs`.
2. Change `name`, `routes`, `account_id`, `vars` and the `MAILROOM` service binding in `wrangler.jsonc` (a deployed mailroom Worker that allows your app name; Tend sends nothing without it).
3. Set the Worker secrets with `wrangler secret put`: `AUTH_SECRET`, `DATA_ENCRYPTION_KEY` (a random string of 32 or more characters), `CRON_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and optionally `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.
4. `npm run deploy`.

### Sign in with GitHub (optional)

Create a GitHub OAuth app (GitHub, Settings, Developer settings, OAuth Apps) with your site as the homepage URL and `https://<your domain>/api/auth/callback/github` as the callback URL.
Set its client ID and a new client secret as the Worker secrets `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`.
The "Continue with GitHub" button appears once both are set, and is hidden otherwise.
A GitHub sign-in uses the account's verified email address, so it opens the same Tend account as an email link to that address; a GitHub account with no verified email is refused.

### Telegram reminders (optional)

Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`), then set its token as the Worker secret `TELEGRAM_BOT_TOKEN` and a random string of your own as `TELEGRAM_WEBHOOK_SECRET`.
"Connect Telegram" then appears in Settings; the webhook and the bot's commands are registered on the first connect or the next cron run, and again whenever the token or secret change.
Nothing is paid: it uses Telegram's free Bot API.

## Licence

[MIT](LICENSE). A project by [n8builds.dev](https://n8builds.dev).
