# Signal Relationship Messenger - Product Requirements Document

Version 1.0 | November 9, 2026 | Status: Draft

## 1. Overview

A private, mobile-first web application for maintaining relationships through meaningful, consent-based Signal messages. The owner manages contacts, topics, message suggestions, timing, and history. Initial content includes verified Bible passages and philosophical quotes; later versions support articles, videos, and personal notes.

## 2. Goals and non-goals

Goals: create contacts and topic profiles; suggest contextually appropriate passages; attach reading links; review and schedule individual messages; deliver from an existing Signal identity; track invitations, replies, delivery attempts and message history; operate on a headless Linux server with minimal recurring cost.

Non-goals for MVP: mass outreach, scraping WhatsApp or Signal contacts, guaranteed Signal account discovery, autonomous responses that impersonate the owner, paid SMS gateway, comprehensive Bible vector search, and automated medical or addiction counseling.

## 3. Target users and core journeys

Primary user: one owner, using Android or desktop browsers. Recipients: personal contacts who opt in to occasional messages.

Journey A: Add a person manually or through a supported phone contact picker/CSV import; normalize E.164 number; set Signal status, consent, themes, preferences, frequency and timezone.

Journey B: If a contact does not use Signal, generate an invitation, copy it or open the native SMS composer; track invited date and manually confirm joining. Do not send invitations automatically.

Journey C: Generate 3-5 verified content suggestions; review verse context, source, reading link, and optional message; edit and approve; schedule within the contact's chosen window.

Journey D: A scheduler picks an eligible approved message at a random time inside permitted hours, sends it via signal-cli, logs results, and enforces cooldowns and opt-outs.

## 4. Functional requirements

Contacts: create, edit, archive, search, import/export, deduplicate; fields include display name, phone, timezone, Signal status (unknown/invited/confirmed/unavailable), consent state, contact preferences, topics, topic weights, notes, and last interaction.

Content library: verified KJV passages and selected public-domain philosophical quotations; metadata includes exact text, reference, source work, translation, context, tags, license, and canonical reading URL. Optional external video links require manual verification.

Recommendations: Gemini receives minimal contact topic context and recent send history; returns structured candidate references and rationale. Retrieve authoritative text from a local Bible dataset or permitted Bible API. Reject invented, mismatched, or unverifiable quotes. Rank for relevance, tone, novelty, context, and diversity.

Composer: allow original personal note, quote, citation, optional link, optional conversation question. Show exact outgoing message. Approval required by default; per-contact auto-send may be enabled only after explicit opt-in.

Scheduling: contact-specific frequency, allowed days, timezone, quiet hours, randomized delivery inside selected windows, maximum sends/week, minimum interval, pause/resume, skip on recent conversation, global kill switch, and retry policy. Random timing must never bypass consent or quiet hours.

Messaging: link signal-cli as a secondary device via QR code. Run signal-cli-rest-api locally in Docker with persistent encrypted or access-controlled state. Send individual messages, not broadcast groups. Track queued/sent/failed/unknown; do not claim delivered/read without reliable receipts.

History: store content reference, rendered text, approval, scheduled timestamp, send attempt timestamp, result, and conversation follow-up status. Prevent duplicate passages within configurable intervals.

## 5. Technical architecture

Frontend: Next.js App Router, TypeScript, Tailwind, shadcn/ui, responsive PWA. Views: Dashboard, Contacts, Contact Detail, Content Library, Suggestions/Approvals, Schedule, History, Settings.

Backend: Next.js route handlers or a small Node service. Database: SQLite with Prisma or Drizzle for a single-node MVP; migrations and encrypted backups. Worker: persistent Node scheduler or cron-driven worker with idempotent jobs. Docker Compose hosts web app, worker and signal-cli-rest-api on a headless Linux host.

AI: Gemini API on a selected eligible free-tier model; configurable rate and token limits. Use JSON-schema outputs, short prompts, caching and batched recommendations. Free tier availability is model- and account-dependent; monitor actual quota.

Source verification: bundled public-domain Bible text (KJV) indexed by book/chapter/verse; optional Bible API as a secondary source. Store verified quote records and source links. Semantic embeddings/vector database are optional phase-two upgrades, not prerequisites.

Network: expose only the authenticated web app through a private VPN such as Tailscale or a carefully secured reverse proxy. Bind Signal REST API to loopback/internal Docker network only. Access QR link via SSH tunnel; never expose it publicly.

Data flow: Contact topics + consent + recent history → Gemini candidates → trusted source verification → human review → scheduled queue → Signal API → delivery attempt log → dashboard.

## 6. Data model

Contact(id, name, phone_e164, timezone, signal_status, consent_status, frequency, allowed_window, last_contact_at, archived_at); Topic(id, label); ContactTopic(contact_id, topic_id, weight, note); Content(id, kind, reference, exact_text, author, work, translation, license, source_url, reading_url, context); Recommendation(id, contact_id, content_id, rationale, model, status, created_at); Message(id, contact_id, content_id, body, approval_status, scheduled_at, sent_at, status, idempotency_key); SendAttempt(id, message_id, attempted_at, response, error); Invitation(id, contact_id, method, invited_at, status); Settings(key, value).

## 7. Signal and contacts integration limitations

signal-cli is an unofficial Signal client. It can link to an existing account and send messages, but may break after Signal protocol changes or account restrictions. Device authentication persists in its configuration directory; monitor linkage and errors. Linked devices may be removed after extended inactivity. A web app cannot freely read Signal or personal WhatsApp contacts. The browser Contact Picker API has limited support and requires user interaction. Signal membership checks must not be treated as reliable. Native SMS invitations should be initiated by the user.

## 8. Safety, privacy and reliability

Require opt-in for automated recurring messages; support STOP/pause requests and a visible opt-out control. Avoid storing intimate addiction or health details; prefer high-level tags. Encrypt backups, restrict access, keep secrets out of Git, and avoid sending private recipient profiles to AI providers unnecessarily. Allow the owner to review sensitive suggestions. Prevent duplicate sends using idempotency keys, transactional queue claims and capped retries. Record failures and notify owner; never retry indefinitely. Respect provider terms and anti-spam protections.

## 9. Acceptance criteria

AC1: Owner can create a contact and record permission, themes, and timezone from Android. AC2: Owner can generate at least three candidates with verified citations and relevant reading links. AC3: Owner can edit, approve, and schedule a message. AC4: Approved messages send through the linked Signal account while the phone is offline. AC5: No message sends outside allowed hours or without opt-in. AC6: Duplicate job execution does not send duplicate messages. AC7: Owner can pause any contact or all messaging instantly. AC8: Send failures are visible and actionable. AC9: Server restarts preserve Signal linking and scheduled jobs.

## 10. Implementation phases

Phase 0 - Spike (half day): confirm headless Docker linking, Signal API send to an opted-in test contact, verify persistence across restart, check Gemini free-tier access and local Bible text.

Phase 1 - MVP (2-5 focused development days): scaffold Next.js app, SQLite schema, contact CRUD, manual Signal status and SMS invite flow, Bible text lookup, Gemini candidate generation, approval queue, scheduler, send history and basic auth.

Phase 2 - Reliability (1-3 days): retries/idempotency, timezone-safe random windows, observability, backups, privacy controls, import/export, mobile PWA polish.

Phase 3 - Expansion: local semantic index, saved custom quotations, verified video/article links, conversation-aware recommendations, more messaging transports and analytics.

## 11. Costs and assumptions

Signal-to-Signal messaging has no per-message fee. Self-hosting on an existing Linux computer adds electricity and maintenance but no required hosting subscription. SQLite and local Bible datasets are free. Gemini may fit within a model's free tier, but quotas and terms must be verified before launch. SMS invitations from the user's Android plan may have no incremental charge but are not sent by the server. Budget target: $0 incremental recurring API costs for small personal usage, not a guarantee.

## 12. Open decisions

Choose repository name and visibility; choose whether access is private VPN-only or internet-facing; choose initial frequency and allowed hours; choose whether any contact may be auto-sent without approval; confirm recipient consent model; choose preferred Bible translation and whether to include external videos in MVP.

## 13. Proposed repository structure

apps/web/ - Next.js PWA and API routes

apps/worker/ - scheduler and Signal dispatch

packages/db/ - SQLite schema and migrations

packages/content/ - Bible lookup and quote verification

packages/ai/ - Gemini recommendation pipeline

infra/docker-compose.yml - headless deployment

.env.example - documented environment variables

README.md - installation, Signal QR pairing, operations and security

PRD.md - copy of this product specification