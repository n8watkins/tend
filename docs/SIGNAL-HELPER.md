# Signal helper: design and safety

Status: accepted by the owner (2026-11-11). Phase 1 (approve first, by phone notification) is built and private to the owner; phases 2 and 3 are not built.
[SPEC.md](SPEC.md) section 16 describes what is built, and [PRD-REVIEW.md](PRD-REVIEW.md) records the reversed decision and the owner's answers.

The owner's decisions (section 10):

- **Which number:** each user links the helper to their own number; the owner uses theirs.
- **Signal's permission:** not asked yet; revisit before phase 3.
- **Public or private:** the code lives in this repo, but the Settings section shows only for accounts in `SIGNAL_HELPER_USERS` (the owner), and the README does not mention it yet.
- **Caps:** as written in 4.2.

Where phase 1 differs from the design below, the design was corrected:

- The local journal is an append-only JSON lines file (`journal.jsonl`), flushed to disk on every write, instead of SQLite, so the helper needs no dependency (2.1).
- A device token may make 300 calls an hour: a poll every 30 seconds is already 120 (2.2).
- `sendBy` is the end of the contact's window that day and never more than two hours after the approval, which is how 2.5's two rules combine.
- The WSL keep-alive starts from the user's own Run key, because a Task Scheduler logon task needs administrator rights (7.4).
- The approve page has Send, Skip and Send it yourself; editing the text is not in the app yet, and any edit after approval is refused at claim anyway.

## Summary

Tend can send Signal messages for its user, but only through a small helper that the user runs on their own PC, linked to their own Signal account as a secondary device (the same way Signal Desktop is linked).
Tend's server never holds Signal keys, never runs signal-cli and never talks to Signal.
By default nothing is sent until the user approves it: a due message arrives as a phone notification (and, later, as a Signal "Note to Self"), the user taps Send, Edit or Skip, and only then does the helper send it.
Later, for a few people the user fully trusts it with, and only when that person said yes, the user can turn on auto-send, with tight daily caps, quiet hours, a heads-up before each send and pause switches.
The helper is free, open source, opt-in and off for everyone unless they install it themselves.

The honest cost: auto-send is "auto-messaging" in the plain words of Signal's terms, and approve-first through an unofficial client is a grey area.
At a few messages a day to people who know you and reply, the practical ban risk is low, but it is not zero, and Signal can end an account without appeal.
That risk falls on the user's own number, so the design keeps volume tiny, refuses anything that looks like bulk, and makes every safeguard default to "do not send".

## 1. What changed, and why it is reconsidered

PRD-REVIEW.md (Pass 1 option (a) and (b), Pass 2 point 2) rejected Signal sending for three reasons.
This design answers each one; it does not pretend they went away.

| Reason it was rejected | What this design does |
| --- | --- |
| Signal's terms forbid "bulk messaging, auto-messaging, and auto-dialing" ([signal.org/legal](https://signal.org/legal/)) | Approve-first is the default: a person decides each send in the moment, as they would by pasting. Auto-send is a per-person opt-in with a written warning that it is auto-messaging under those terms. Bulk is impossible by construction (section 5). |
| Hosting signal-cli for users is unsafe (Tend would hold everyone's message keys) | Tend never hosts it. The keys live only on the user's PC. Tend's server sees only what it already has: the message text and the recipient's number. |
| Cloudflare Containers are not free | No container. The helper runs on hardware the user already owns; Tend gains only a few small API routes on the existing Worker. |

Principle 1 in SPEC.md ("You send. Tend never sends anything on Signal and never holds Signal keys or sessions.") becomes:
"You decide. Tend's server never sends on Signal and never holds Signal keys; an optional helper on your own computer sends what you approve."

## 2. Architecture

```
 your phone (Signal, primary)            your PC (Windows + WSL)
   |  linked devices                       tend-helper (Node, one process)
   |<------------------------------------>   └─ signal-cli jsonRpc (child process, stdin/stdout, no port)
   |                                              keys: ~/.local/share/signal-cli/data (700)
   |                                       |
   |  Web Push (approve / skip buttons)    |  HTTPS, outbound only, device token
   v                                       v
 Tend PWA  <------------------------->  Cloudflare Worker "tend"  ----> Turso
                                        /api/helper/* , /api/approvals/*
                                        cron */15: finds due messages, sends approval pushes
```

### 2.1 The helper

- One small Node 22 program, `tend-helper`, in this repo under `helper/`, sharing types and the reply parser with the app.
- It starts `signal-cli -a <number> jsonRpc` as a child process and talks JSON-RPC over stdin and stdout.
  Nothing listens on a port, so nothing on the network can ask it to send.
- It makes only outbound HTTPS calls to `https://tend.n8builds.dev` (or the user's own Tend URL, for self-hosters).
- It keeps a tiny local journal (`~/.local/state/tend-helper/journal.jsonl`, append-only, flushed to disk on every write) of message ids it has started and finished sending, which is what makes sends at-most-once (2.4).
- It never stores or uploads the content of messages it receives (section 6.2).

### 2.2 The device token

- Settings, "Signal helper", "Add a helper" shows a one-time pairing code (8 characters, 10 minutes, stored hashed, like the Telegram link code).
- `tend-helper pair <code>` exchanges it for a device token: 32 random bytes, prefixed `tdh_`, shown once, kept by Tend only as a SHA-256 hash.
- The token's scope is the helper routes only (section 8.1): read its own jobs, report results, heartbeat, report Note to Self commands.
  It cannot read the contact list, notes, history or export, cannot change settings, and cannot create messages.
- One helper per account. "Remove helper" in Settings revokes the token at once; the next call gets 401 and the helper stops sending and says so.
- On the PC the token lives in `~/.config/tend-helper/token` with mode 600 (on native Windows, protected with DPAPI for the current user).
- Rate limits on helper routes: 300 calls an hour per token (a poll every 30 seconds is 120), and after 30 bad tokens in an hour an address is refused outright.

### 2.3 Polling, not long-poll

- The helper polls `GET /api/helper/jobs` every 30 seconds, with the last cursor, and sends a heartbeat in the same call.
- Long-poll was considered: a Worker can hold a request open, but it would still need to check the database in a loop or add a Durable Object to be woken.
  For one helper per user, a 30-second poll costs about 2,900 small requests a day, well inside Workers Paid's included 10 million a month, and each poll reads a handful of indexed rows in Turso.
  The latency (at most 30 seconds between "Send" and the send) is fine for this product.
- Revisit with a Durable Object per user only if many people run helpers.

### 2.4 Idempotency: at most once, never twice

A double message is worse than a missed one, so every step prefers "stop and ask" over "retry".

1. A message the helper may send is in state `approved` (or `auto_ready`, phase 3) with an `approvedBodyHash`.
2. The helper claims it: `POST /api/helper/jobs/<id>/claim`.
   The server re-checks everything (consent `yes`, contact not stopped, no global pause, no auto-send pause, caps, window, body hash unchanged), then moves it to `sending` with a `claimId` and a 10-minute lease, in one conditional `UPDATE ... WHERE sendState = 'approved'`.
   Two claims cannot both win.
3. The helper writes `started <id> <claimId>` to its local journal, then calls signal-cli `send`, then writes `done <id> <signalTimestamp>`.
4. It reports `POST /api/helper/jobs/<id>/result` with `sent` (and the Signal timestamp) or `failed` (with a reason code).
   The server accepts a result once per `claimId`; a repeat is a no-op that returns the first answer.
5. If the helper crashes between steps 3 and 4, on restart it finds `started` without `done` and reports `unknown`.
   It never resends on its own.
6. If a lease runs out with no result, the server marks the message `unknown`.
   Tend shows "We are not sure this was sent. Check your Signal chat with Sam" with "It was sent" and "Send it again".

### 2.5 When the PC is off

- Tend shows the helper's state from its last heartbeat: "Helper online", or "Helper offline since 08:12".
  After 10 minutes without a heartbeat, approval pushes say "Your helper is offline; you can still send it yourself".
- An approved message has a `sendBy` deadline: the end of the contact's window that day.
  If no helper claims it by then, it falls back to the normal manual path (Due now, Copy, Open chat, I sent it) and the user gets one push: "Not sent: your PC was off. Send it yourself or reschedule."
- Auto-send messages that come due while the helper is offline are never sent late.
  They move to the approval queue instead, so a PC waking up after a weekend never fires a backlog.
- The helper also refuses, by itself, to send anything whose `scheduledFor` is more than 2 hours in the past.

## 3. Approve first (the default)

When a message is due and the user has a helper, the cron (which already claims due rows with `remindedAt`) creates an approval request instead of, or in addition to, the usual reminder.
The approval binds to the exact text through `approvedBodyHash`; any edit needs a new approval.

### 3.1 Approving from a phone notification (phase 1)

The push (from the PWA work now on the `feat/pwa` branch) carries:

- Title: "Send to Sam?"; body: the first 120 characters of the message.
- Action buttons: **Send** and **Skip**. Tapping the notification itself opens `/approve/<id>`, which shows the full text with Send, Edit, Skip and Reschedule.
- A one-time approval token in the encrypted payload (HMAC of message id, body hash and expiry, valid 12 hours).
  The service worker posts the action to `POST /api/approvals/<id>` with that token, so the buttons work without an open tab and cannot be forged by another site (no reliance on cookies alone).

Platform honesty: Chrome and Edge on Android, Windows and macOS show action buttons.
Safari on iPhone and iPad (installed web app) shows notifications but no action buttons, so there a tap opens `/approve/<id>` and the user taps Send there: one more tap.
Firefox shows no action buttons either.

### 3.2 Approving through Signal "Note to Self" (phase 2)

The helper sends the approval request into the user's own Note to Self chat (signal-cli `send --note-to-self`).
Only the user's own devices can write in that chat, so Signal itself authenticates the reply.

A request looks like this:

```
Tend #3 - to Sam (Psalm 23:1), due 10:30
---
"Yahweh is my shepherd: I shall lack nothing."
- Psalm 23:1 (WEB)
Stop these messages: https://tend.n8builds.dev/stop/...
---
Reply: yes 3 / skip 3 / later 3 / edit 3 <new text>
```

How replies map to messages:

- Each request gets a short number, unique among the user's open requests (`#1` to `#99`, reused only after the request closes). Tend stores it as `approvalNumber`.
- `yes 3` (also `y 3`, `send 3`): approve #3 with the exact text shown.
- `skip 3`: skip it (the same as Skip in the app).
- `later 3`: reschedule it to the next good time.
- `edit 3 <new text>`: replace the body; the helper answers with the new preview as a new request and waits for `yes`.
  An edit never sends by itself.
- `yes` or `skip` without a number works only when exactly one request is open; otherwise the helper answers "Which one? Open: #3 Sam, #4 Ana".
- Replying with Signal's quote (swipe to reply) to a request works without the number: the quote carries the original message's timestamp, which the helper maps to the request.
- `stop all`: the same as Pause all auto-sending plus skipping every open request (section 6.3).
- Anything else gets "Not understood" and changes nothing. There is no `yes all`.

Only messages that arrive as sync messages from the user's own other devices, in the Note to Self chat, are read as commands.
The helper ignores its own outgoing messages, every other chat, and every group.

### 3.3 Sending after approval

The helper claims the approved job on its next poll (2.4), sends it as a normal 1:1 Signal message with no attachments, and reports the result.
Tend marks it sent (`sentAt`, `sentVia = 'helper'`) and the user gets a quiet confirmation: a push "Sent to Sam", or a Note to Self "Sent #3".

## 4. Auto-send (phase 3)

### 4.1 Who can be auto-sent to

All of these must hold, checked by the server at schedule time and again at claim time:

- The contact's consent is `yes`. If it ever leaves `yes` (the user records no, or the recipient uses the stop link), auto-send turns off for that person and stays off until the user turns it on again.
- The user turned on "Auto-send to this person" on the contact page, after a confirmation screen that says in plain words what auto-send means under Signal's terms.
- The contact has a phone number and Signal status `on_signal`.
- At least 3 messages to this person were already sent through approve-first or by hand, with no stop since (a track record before trust; see open questions).
- The helper finds the number in the account's own Signal contacts (synced from the phone) with an existing conversation. A number Signal has never seen you talk to is refused on the PC, whatever Tend says.

### 4.2 Limits

| Limit | Default | Hard maximum |
| --- | --- | --- |
| Auto-sends per day, all people | 3 | 5 |
| Helper sends per day, approved plus auto | 10 | 20 |
| Gap between any two helper sends | 10 minutes | never less than 2 minutes |
| Per person | the contact's own `minDaysBetween` and `maxPer30Days` (default 7 days, 4 per 30 days) | as in SPEC.md section 8 |
| Window | the contact's window and allowed days, and also the user's own waking hours (default 08:00 to 21:00), so the user is around to see replies | |
| Heads-up | a push 30 minutes before each auto-send: "Sending to Sam at 10:30", with Cancel and Edit | can be shortened, not turned off |

The caps are enforced on the server (claim refuses) and, again, in the helper (it keeps its own daily count and refuses beyond the hard maximum even if the server says yes).
If either counter is unavailable, nothing is sent.

### 4.3 Pacing and "human-like" timing: the honest answer

The question was whether to add jitter or human-like pacing.
Tend already picks a random minute inside the contact's window, so messages do not all land at 9:00; that is a product choice for the recipient and stays.
The minimum gap between sends is flood control, so a bug can never fire ten messages in a second.

Tend will not add timing whose purpose is to make automated sends look human to Signal.
Doing that would be designing to evade the detection of exactly what the terms forbid, which is worse than the auto-send itself: it turns "I accept a risk on my own account" into "I am disguising a breach".
It would also not reduce the real risk much, because Signal's anti-spam signals are mostly about who you message and how they react (reports, blocks, unknown recipients, volume), not the second on the clock.
The design reduces risk by sending little, only to people who know you, and by stopping at the first sign of trouble.

### 4.4 The Auto-sending page

`/auto-sending`, linked from Settings and from Today when anything is set to auto-send:

- At the top, one switch: **Auto-sending on / paused**, plus the helper's state (online, last seen) and today's count against the cap.
- A row per person set to auto-send: name, next scheduled message (time in their zone and yours, first line of the text, Edit and Skip), last auto-send, a per-person **Pause** switch and **Turn off auto-send**.
- Below, the last 30 days of auto-sends with their outcome (sent, failed, unknown, canceled, moved to approval because the helper was offline).
- An empty state that explains auto-send and links to the safety notes, so the page is never blank.

## 5. What never happens

These are rules in code with tests, not settings:

- No bulk: never more than the caps in 4.2, never more than one recipient per send, never groups, never broadcast lists.
- No unknown numbers: only contacts in Tend with consent `yes`, and only numbers the user's own Signal already knows (4.1).
- No forwarding: received messages are never stored, logged or uploaded to Tend. Only Note to Self commands from the user's own devices are parsed, and only the parsed command (for example "approve #3") reaches Tend.
- No autonomous replies: the helper never answers anyone except the user in Note to Self.
- No attachments, no reactions, no read receipts or typing indicators sent on the user's behalf.
- No captcha solving: if Signal asks for a rate-limit challenge, sending stops (6.1).
- No hosting: Tend's own infrastructure never runs signal-cli, and the docs say plainly not to run the helper on a cloud server (a datacenter IP is the riskiest place for it).
- No late backlog: anything more than 2 hours late goes back to the user.

## 6. Safety and abuse

### 6.1 The risk to the user's number

Candidly:

- Signal does not publish its anti-spam rules, so nobody can give a number.
  What is public: the terms forbid auto-messaging and let Signal end access "anytime for any reason"; signal-cli has been used for years, often by people sending themselves or their family notifications from home servers, and the project's issues show rate-limit challenges for unusual traffic far more often than permanent bans.
- At a few messages a day, from a home connection, to people who are in your contacts and talk back, the traffic looks like an ordinary person using Signal Desktop.
  The practical chance of a ban is low.
- The things that raise it sharply are the things this design forbids: many messages, to many people, who do not know you, who report or block you, sent from a datacenter, with links, in bursts.
- The likely first sign is a "proof required" rate-limit challenge, not a ban.
  When signal-cli reports one, the helper stops all sending, tells the user (push and Note to Self), and waits.
  The user solves the captcha by hand (signalcaptchas.org, then `tend-helper captcha <token>`, which calls signal-cli `submitRateLimitChallenge`). Sending stays off until the user turns it back on.
- The worst case is that Signal ends the account, which would cost the user their Signal identity on that number.
  Approve-first lowers this risk to about the risk of using any unofficial client; auto-send raises it a little more and is a deliberate choice per person.

What reduces it further:

- Run the helper at home (residential IP), not on a VPS, and not through a datacenter VPN.
- Keep signal-cli current (7.3); stale clients are refused by Signal and misbehave.
- Keep the stop link on, so a recipient who wants out uses it instead of reporting spam.
- Keep caps low; there is no reason this product needs more than a handful a day.

### 6.2 Keys and data

- Signal keys stay in signal-cli's data folder on the PC. Tend never sees them, and the helper never reads that folder itself.
- The helper receives Signal traffic as a linked device must (to stay in sync and not be unlinked for inactivity). It discards every received message except Note to Self commands, and never writes message content to disk or logs.
- Tend sends the helper only, per claimed job: message id, claim id, recipient number (decrypted for that job only), the exact text, and its hash.

### 6.3 The kill switch, from fastest to most final

1. Note to Self `stop all`, or **Pause all** on the Auto-sending page: auto-send stops at once, open approvals stay open.
2. The existing global pause in Settings (`pausedAt`): nothing is scheduled, reminded or sent.
3. **Remove helper** in Settings: the token is revoked; the helper can no longer fetch anything.
4. Stop the service on the PC (`systemctl --user stop tend-helper`).
5. On the phone, Signal, Settings, Linked devices, remove "Tend helper": the helper can no longer send as you at all. This is the one switch that does not depend on Tend or the PC behaving.

### 6.4 Logs

- Tend keeps a `helper_event` row per step (approved, claimed, sent, failed, unknown, canceled, paused, challenge), with ids, times and reason codes, shown on the Auto-sending page and in the contact's history.
  Bodies already live on the message row; numbers and names are never in logs (SPEC.md section 10).
- The helper logs to journald (or a rotating file on Windows), with ids and outcomes only: never names, numbers or text.
- Every auto-send and every helper send appears in History with a "Sent by your helper" badge, so the user can always see what went out in their name.

### 6.5 Other Tend users

- The helper is off for everyone. A user turns it on in Settings, which shows the risk text first and needs a tick: "I understand this uses an unofficial Signal client on my computer, and auto-send breaks Signal's rule against auto-messaging. My account is my risk."
- Site-wide caps on helper sends (default 200 a day across Tend) protect the project from a misuse it would be blamed for.
- The README describes it as an experimental, self-run add-on, not a feature of the hosted service.

## 7. Install steps

### 7.1 What you need

- Windows 11 with WSL 2 (Ubuntu) and systemd turned on (`[boot] systemd=true` in `/etc/wsl.conf`), or Linux. Native Windows works too but is the second choice.
- signal-cli, the latest release from github.com/AsamK/signal-cli: the native Linux build (no Java needed), or the Java build with Java 21 or later.
- Node 22 or later for `tend-helper` (no npm packages: it has no dependencies).
- `qrencode`, to show the link code as a QR in the terminal (`sudo apt install qrencode`).
- In Tend: your account's email in the Worker's `SIGNAL_HELPER_USERS` setting (`npx wrangler secret put SIGNAL_HELPER_USERS`, then type the address), and phone notifications turned on (Settings, On your phone) on the phone you approve from.

Install signal-cli (WSL, native build, into your home folder):

```sh
V=$(curl -s https://api.github.com/repos/AsamK/signal-cli/releases/latest | sed -n 's/.*"tag_name": "v\([^"]*\)".*/\1/p')
curl -fL -o /tmp/signal-cli.tar.gz "https://github.com/AsamK/signal-cli/releases/download/v$V/signal-cli-$V-Linux-native.tar.gz"
mkdir -p ~/.local/opt/signal-cli ~/.local/bin
tar -xzf /tmp/signal-cli.tar.gz -C ~/.local/opt/signal-cli
ln -sf "$(find ~/.local/opt/signal-cli -type f -name signal-cli | head -1)" ~/.local/bin/signal-cli
signal-cli --version
```

Install tend-helper from this repository:

```sh
git -C ~/projects/public/tend pull
chmod +x ~/projects/public/tend/helper/bin/tend-helper.mjs
ln -sf ~/projects/public/tend/helper/bin/tend-helper.mjs ~/.local/bin/tend-helper
tend-helper version
```

### 7.2 Link signal-cli as a secondary device

1. `signal-cli link -n "Tend helper" | tee >(head -1 | qrencode -t ANSIUTF8)`: it prints a QR code and waits.
2. On the phone: Signal, Settings, Linked devices, Link new device, scan the QR. The command finishes with "Associated with: +1...".
3. `signal-cli -a +1XXXXXXXXXX receive` once, to pull contacts and sync (it can take a minute).
4. Check it appears in the phone's Linked devices as "Tend helper". Signal allows up to five linked devices, so Signal Desktop keeps working beside it.

### 7.3 Where the keys live

- `~/.local/share/signal-cli/data/` inside WSL's own Linux disk: the account file and its key and session stores. Run `chmod -R go-rwx ~/.local/share/signal-cli`.
- Do not put it on `/mnt/c`, in OneDrive, or in any synced or backed-up-to-cloud folder.
- No backup is needed: if the PC dies, link a new device; the phone keeps the account.
- Windows full-disk encryption (BitLocker or Device Encryption) should be on, since that is what protects the WSL disk at rest.

### 7.4 Pair and run as a service

1. In Tend, Settings, Signal helper: read the risk text, tick the box, Turn on the Signal helper, then Get a pairing code.
2. `tend-helper pair ABCD-EFGH` (the code works once, for 10 minutes). It finds signal-cli on PATH and the linked account; with several accounts, add `--account +1...`.
3. `tend-helper doctor --send-test` checks Node, signal-cli (found, version, how old), the linked account, that the keys are private and not on a Windows drive, the token, the clock and the service, then sends "Tend helper is connected." to your own Note to Self. Check it arrived on your phone.
4. `tend-helper install-service --dry-run` shows every step; `tend-helper install-service` does them: a systemd user unit (`Restart=on-failure`, not restarted after exit code 3, a revoked token), `loginctl enable-linger` so it runs without a login shell, and on WSL a keep-alive.
5. The keep-alive: WSL stops a distro when no Windows process uses it, so at every Windows logon a hidden `wsl.exe -d <distro> --exec sleep infinity` keeps it running. A Task Scheduler logon task needs administrator rights, so it starts from your own Run key instead (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, value `TendHelper`), through `wscript.exe //B //E:JScript` and a two-line script in `%LOCALAPPDATA%\tend-helper\`.
6. Settings now shows "Helper online". A first real test: add yourself as a person with your own number and consent yes, write a message with "Now", wait for the reminder run (at most 15 minutes), and tap Send on the notification (or on the page it opens, on iPhone). It arrives in your Note to Self chat within a minute, and History says "Sent by your helper".

`tend-helper status` shows what the helper knows; `journalctl --user -u tend-helper -f` follows its log (ids and outcomes only).
`tend-helper uninstall-service` undoes step 4.

On native Windows the same program runs from the same Run key, logging to `%LOCALAPPDATA%\tend-helper\helper.log`, with signal-cli's data folder given by `--signal-cli-config` pointing under `%LOCALAPPDATA%`.

### 7.5 After a captcha

If Signal asks for proof (a rate-limit challenge), the helper stops all sending and you get a notification.

1. Open https://signalcaptchas.org/challenge/generate.html, solve it, and copy the `signalcaptcha://...` link it offers.
2. `tend-helper captcha 'signalcaptcha://...'` (it stops the service for a moment, submits the captcha through signal-cli, and starts it again).
3. In Tend, Settings, Signal helper: Resume sending.

### 7.6 Updates

- Signal stops accepting clients that are too old, and signal-cli's own README warns that releases older than about three months may stop working.
- `tend-helper doctor` warns when signal-cli is more than 60 days old (built). Planned: the service runs it daily and warns by push, and Tend shows the warning on the Auto-sending page.
- Planned: `tend-helper update-signal-cli` downloads the latest release, checks its published checksum, swaps it in and restarts. It never updates itself silently. Until then, repeat the signal-cli install in 7.1.
- Tend tells the helper its minimum supported helper version in every jobs response; an older helper stops sending and says "Update tend-helper".
- A linked device that does not connect for a long time is unlinked by Signal (SPEC sources: 30 days without the phone online, 45 days of device inactivity). The helper connects continuously while the PC is on, and Tend warns after 14 days without a heartbeat.

## 8. Tend changes needed

### 8.1 API

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /api/helper/pair` | pairing code | Exchange a code for a device token |
| `GET /api/helper/jobs?cursor=` | device token | Heartbeat; returns approved and auto-ready jobs in their send window, open approval requests to post to Note to Self (phase 2), pause state, caps left, minimum helper version |
| `POST /api/helper/jobs/<id>/claim` | device token | Re-check every rule and lease the job (2.4) |
| `POST /api/helper/jobs/<id>/result` | device token | `sent`, `failed` or `unknown`; idempotent per claim |
| `POST /api/helper/commands` | device token | Parsed Note to Self commands: approve, skip, later, edit, stop all (phase 2) |
| `POST /api/helper/events` | device token | Challenge required, signal-cli outdated, unlinked |
| `POST /api/approvals/<id>` | session, or approval token from the push | Send, Skip, Later from push buttons and `/approve/<id>` |

All inputs are validated with zod, every lookup is scoped by the token's user, and every route has a rate limit.

### 8.2 Database

- New `helper_device`: `id`, `userId` (unique), `tokenHash`, `name`, `createdAt`, `lastSeenAt`, `helperVersion`, `signalCliVersion`, `revokedAt`.
- New `helper_pair_code`: as `telegram_link_code`.
- New `helper_event`: `id`, `userId`, `messageId` (null), `kind`, `reason`, `at`.
- `message` gains: `delivery` (`manual` or `helper`), `approvalState` (`none`, `pending`, `approved`, `skipped`, `expired`), `approvedBodyHash`, `approvedAt`, `approvedVia` (`app`, `push`, `note_to_self`, `auto`), `approvalNumber`, `sendState` (`idle`, `sending`, `sent`, `failed`, `unknown`), `claimId`, `leaseUntil`, `sendBy`, `sentVia` (`you`, `helper`), `signalTimestamp`.
  Index `(userId, approvalState, sendState)` for the jobs route.
- `contact` gains: `autoSend` (bool), `autoSendPausedAt`, `autoSendEnabledAt`.
- `user_settings` gains: `helperEnabled`, `helperAckAt` (when the risk text was accepted), `autoSendPausedAt`, `autoSendDailyCap`, `ownerWindowStart`, `ownerWindowEnd`, `approveVia` (`push`, `note_to_self`, `both`).
- Export includes the new fields; account deletion cascades as today.

### 8.3 UI

- Settings, "Signal helper": turn on (with the risk text), pairing code, helper status, Remove helper, where approvals go.
- `/approvals`: the approval queue (pending requests with Send, Edit, Skip, Later), also shown at the top of Today.
- `/approve/<id>`: one request, opened from a push.
- `/auto-sending`: as in 4.4.
- Contact page: "Auto-send to this person" switch (disabled with the reason when 4.1 is not met), and a "Sent by your helper" badge in history.
- The send screen keeps every manual path; the helper is an extra button, "Send with my helper", for users who have one.

### 8.4 Tests

- Unit: the job state machine (every transition, double claim, lease expiry, repeat result), the Note to Self reply parser (`yes 3`, `y3`, `skip`, ambiguity, `edit`, quotes, garbage), rule checks at claim (consent changes after approval, body edited after approval, pause, caps, windows across DST), auto-send eligibility, token scope (a device token cannot reach any other route), approval token expiry and forgery.
- Helper unit tests with a fake signal-cli (a script speaking the same JSON-RPC): crash between send and report leads to `unknown` and no resend; rate-limit challenge stops sending; received messages never reach logs or Tend; refusal of numbers not in Signal contacts; hard caps hold when the server misbehaves.
- End to end (Playwright): pair a fake helper; a due message raises an approval push (test sink); approve from `/approve/<id>`; the fake helper claims, sends and reports; History shows "Sent by your helper"; pause all and stop link both block claims; offline helper falls back to manual with one notice.
- Manual acceptance on the owner's PC with a real link, sending only to the owner's own second device or a consenting tester.
- CI never talks to Signal.

## 9. Phased plan

### Phase 1: approve first, by phone notification

Builds on the PWA and Web Push work.
Scope: helper pairing, device token, jobs, claim, result, `/approvals`, `/approve/<id>`, push action buttons, the helper with signal-cli linking, service install, doctor, logs, SPEC.md and PRD-REVIEW.md updated.
No Note to Self, no auto-send.

Acceptance checks:

- A due message for a contact with consent `yes` produces one push with Send and Skip; Send from the notification (Android Chrome) and from `/approve/<id>` (iPhone) both lead to exactly one Signal message within 60 seconds.
- Skip sends nothing; editing the text after approval sends nothing until approved again.
- Changing consent to `no`, or using the stop link, between approval and claim sends nothing.
- With the PC off, the approved message falls back to manual at the end of the window, with one notice; turning the PC on later sends nothing.
- Killing the helper mid-send never produces a second message; Tend shows "not sure" instead.
- Remove helper stops all sending within one poll.
- Helper logs and Tend logs contain no names, numbers or text (checked by a test).
- All unit and e2e tests above pass in CI; lint and typecheck clean.

### Phase 2: approvals through Note to Self

Scope: approval requests posted to Note to Self, the reply parser, quote replies, `stop all`, the "approvals go to" setting.

Acceptance checks:

- `yes 3`, `skip 3`, `later 3`, `edit 3 ...` and a quote reply each do exactly what 3.2 says, from the phone.
- A reply in any other chat, or from another person, changes nothing.
- `yes` with two open requests asks which one; there is no way to approve more than one message per reply.
- Approving the same request in both the push and Note to Self sends once.
- `stop all` pauses auto-send and closes open requests within one poll.

### Phase 3: auto-send

Scope: contact eligibility and switch with the risk confirmation, auto-ready jobs, the heads-up push with Cancel, caps in the server and in the helper, the owner's waking window, the Auto-sending page, challenge handling.

Acceptance checks:

- The switch is unavailable for any contact that fails 4.1, and turns itself off when consent leaves `yes`.
- A heads-up arrives 30 minutes before each auto-send; Cancel stops it.
- The fourth auto-send in a day (at the default cap) is not sent and appears in the approval queue instead.
- Nothing auto-sends outside the contact's window or the owner's waking hours, including across a DST change.
- With the helper offline at send time, the message moves to the approval queue and is never sent late.
- A simulated rate-limit challenge stops every send until the owner resumes.
- The Auto-sending page lists every auto-send person, their next message and both pause levels, and each switch takes effect within one poll.
- The owner runs it for two weeks on a small set of people before it is mentioned in the README.

## 10. Open questions for the owner

Answered on 2026-11-11 (see the top of this page): 1, 2, 3 and 6.
Phase 1 approves only when a message is due (question 4 stays open for phase 3), falls back to manual at the end of the window (9), and runs on WSL with systemd plus the keep-alive (10, to be confirmed on the owner's PC).

1. **Signal's permission.** Answered: not yet; revisit before phase 3.
2. **Which number.** Answered: each user's own number; the owner uses theirs.
3. **Public or private helper.** Answered: the code is public in this repo, the feature is private to the owner (`SIGNAL_HELPER_USERS`), and the README does not mention it yet.
4. **Approve ahead of time.** May you approve a message when you schedule it (so it is sent at the time with no further prompt), or must approval happen when it is due? Approving ahead is very close to auto-send.
5. **Track record before auto-send.** Is "3 earlier messages, no stop" the right bar, or do you want none, or more?
6. **Caps.** Answered: as written (3 auto-sends and 10 helper sends a day, 10 minutes apart).
7. **Heads-up.** Keep the 30-minute heads-up before every auto-send (with Cancel), and keep it impossible to turn off?
8. **Stop link.** Keep it on every auto-sent message, not just the first three?
9. **PC off.** Fall back to manual at the end of the window (proposed), or hold the message until the helper is back the next allowed day?
10. **Where it runs.** WSL with systemd plus a keep-alive task (proposed), or native Windows? Phase 1 needs one of them tested on your PC.
11. **Edits in Signal.** Allow `edit 3 <text>` in Note to Self, or keep editing in the app only?
