import 'server-only'

/**
 * Outgoing email: sign-in links and reminders, sent through the shared mailroom
 * service binding MAILROOM (wrangler.jsonc), which counts every send against
 * the account-wide Cloudflare Email cap and the app's own caps (tend: 30 a day,
 * 150 a month, 8 per recipient a day). Callers spend from Tend's own limits
 * (lib/server/limits.ts) first.
 *
 * In test mode (APP_ENV=test) messages are appended to
 * <E2E_EMAIL_DIR>/<address>.jsonl for the Playwright suite. Off Workers with
 * no binding (next dev) nothing is sent and the link is logged locally only.
 */

import { getCloudflareContext } from '@opennextjs/cloudflare'

import { isTestMode } from '@/lib/testMode'

export interface OutgoingEmail {
  to: string
  subject: string
  text: string
  html: string
  /** Idempotency key: the same key never sends twice. */
  key: string
}

export type EmailKind = 'signin' | 'reminder'

export type SendOutcome =
  | { ok: true }
  | { ok: false; code: string; /** Worth trying again later (a cap that resets). */ retryable: boolean }

export interface MailroomBinding {
  send(request: {
    kind: EmailKind
    to: string
    subject: string
    text: string
    html: string
    fromName?: string
    key?: string
  }): Promise<{ ok: true } | { ok: false; code: string; retryable?: boolean }>
}

// Set by the Worker's Cron Trigger, which runs this code outside any request, where
// getCloudflareContext() has nothing (worker/cron.ts). Requests never set it.
let cronMailroom: MailroomBinding | undefined

export function setCronMailroom(mailroom: MailroomBinding | undefined): void {
  cronMailroom = mailroom
}

function binding(): MailroomBinding | undefined {
  if (cronMailroom) return cronMailroom
  try {
    return (getCloudflareContext().env as unknown as { MAILROOM?: MailroomBinding }).MAILROOM
  } catch {
    return undefined
  }
}

export function mailFileName(address: string): string {
  return `${address.toLowerCase().replace(/[^a-z0-9@._-]/g, '_')}.jsonl`
}

/** Never throws for a refused send; a refusal is not retried here. */
export async function sendEmail(kind: EmailKind, message: OutgoingEmail): Promise<SendOutcome> {
  if (isTestMode()) {
    const { appendFile, mkdir } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const dir = process.env.E2E_EMAIL_DIR || join(process.cwd(), '.e2e', 'email')
    await mkdir(dir, { recursive: true })
    await appendFile(join(dir, mailFileName(message.to)), `${JSON.stringify(message)}\n`, 'utf8')
    return { ok: true }
  }
  const mailroom = binding()
  if (!mailroom) {
    if (process.env.NODE_ENV === 'development') console.info(`[mailroom not bound] ${message.subject}\n${message.text}`)
    return { ok: false, code: 'not_configured', retryable: false }
  }
  const result = await mailroom.send({ kind, ...message, fromName: 'Tend' })
  if (result.ok) return { ok: true }
  const retryable = result.retryable === true || result.code.startsWith('cap_') || result.code === 'rate_limited'
  console.warn(`[mailroom refused] ${kind}: ${result.code}`)
  return { ok: false, code: result.code, retryable }
}

/** A short stable idempotency key from parts. */
export async function emailKey(...parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')))
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('')
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** A plain, accessible email layout: one heading, paragraphs, one button, a footer. */
export function layout(opts: { heading: string; paragraphs: string[]; button?: { label: string; url: string }; footer: string }): string {
  const p = opts.paragraphs.map((t) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1f2a24">${escapeHtml(t)}</p>`).join('')
  const button = opts.button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(opts.button.url)}" style="display:inline-block;background:#2f6b4f;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${escapeHtml(opts.button.label)}</a></p>`
    : ''
  return `<!doctype html><html lang="en"><body style="margin:0;background:#f7f5f0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<p style="margin:0 0 24px;font-weight:700;font-size:18px;color:#2f6b4f">Tend</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1f2a24">${escapeHtml(opts.heading)}</h1>
${p}${button}
<p style="margin:32px 0 0;font-size:13px;line-height:1.5;color:#5b665f">${escapeHtml(opts.footer)}</p>
</div></body></html>`
}
