import 'server-only'

/**
 * Outgoing email: sign-in links and reminders, through the Cloudflare Email
 * Service binding EMAIL (wrangler.jsonc), from EMAIL_FROM on n8builds.dev.
 * Callers spend from the limits (lib/server/limits.ts) first.
 *
 * In test mode (APP_ENV=test) messages are appended to
 * <E2E_EMAIL_DIR>/<address>.jsonl for the Playwright suite. Off Workers with
 * no binding (next dev) nothing is sent and the link is logged locally only.
 */

import { getCloudflareContext } from '@opennextjs/cloudflare'

import { isTestMode } from '@/lib/testMode'

export const EMAIL_FROM = process.env.EMAIL_FROM || 'tend@n8builds.dev'

export interface OutgoingEmail {
  to: string
  subject: string
  text: string
  html: string
}

interface EmailBinding {
  send(message: {
    to: string
    from: { email: string; name: string }
    subject: string
    text: string
    html: string
  }): Promise<{ messageId?: string }>
}

function binding(): EmailBinding | undefined {
  try {
    return (getCloudflareContext().env as { EMAIL?: EmailBinding }).EMAIL
  } catch {
    return undefined
  }
}

export function mailFileName(address: string): string {
  return `${address.toLowerCase().replace(/[^a-z0-9@._-]/g, '_')}.jsonl`
}

export async function sendEmail(message: OutgoingEmail): Promise<boolean> {
  if (isTestMode()) {
    const { appendFile, mkdir } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const dir = process.env.E2E_EMAIL_DIR || join(process.cwd(), '.e2e', 'email')
    await mkdir(dir, { recursive: true })
    await appendFile(join(dir, mailFileName(message.to)), `${JSON.stringify(message)}\n`, 'utf8')
    return true
  }
  const email = binding()
  if (!email) {
    if (process.env.NODE_ENV === 'development') console.info(`[email not configured] ${message.subject}\n${message.text}`)
    return false
  }
  await email.send({ ...message, from: { email: EMAIL_FROM, name: 'Tend' } })
  return true
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
