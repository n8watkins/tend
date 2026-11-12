import Link from 'next/link'

import { removeHelperAction, resumeHelperAction, turnOffHelper, turnOnHelper } from '@/app/(app)/helper-actions'
import type { HelperStatus } from '@/lib/server/helper'
import { formatWhen } from '@/lib/time'

import { ConfirmButton } from './ConfirmButton'
import { HelperPairCode } from './HelperPairCode'
import { SubmitButton } from './SubmitButton'

export const HELPER_DOCS = 'https://github.com/n8watkins/tend/blob/main/docs/SIGNAL-HELPER.md'

const HALT_TEXT: Record<string, string> = {
  challenge: 'Signal asked for a captcha, so your helper stopped sending. Solve it on your PC (tend-helper captcha), then resume here.',
  unlinked: 'Your helper is no longer linked to your Signal account. Link it again on your PC, then resume here.',
}

/**
 * Settings, "Signal helper" (docs/SIGNAL-HELPER.md 8.3). Shown only to
 * accounts in SIGNAL_HELPER_USERS: the risk text and turning it on, pairing,
 * the helper's state, resuming after a captcha, and removing it.
 */
export function HelperSettings({ status, timezone, notificationsOn, error }: { status: HelperStatus; timezone: string; notificationsOn: boolean; error?: string }) {
  const device = status.device
  return (
    <div className="card space-y-5">
      <div className="space-y-2">
        <p>
          A small program on your own computer sends the messages you approve, from your own Signal, linked like Signal Desktop. Tend&rsquo;s server never touches
          Signal or your keys.
        </p>
        <p className="hint">
          Private preview.{' '}
          <a href={HELPER_DOCS} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            How it works and how to install it
          </a>
        </p>
      </div>

      {!status.enabled ? (
        <form action={turnOnHelper} className="space-y-4 border-t border-line pt-5">
          <div className="notice notice-warn space-y-2">
            <p className="font-semibold">Your number, your risk</p>
            <p>
              The helper uses signal-cli, an unofficial Signal client. Signal&rsquo;s terms do not allow automated messaging, and Signal can end an account without
              appeal. Tend keeps it small: only what you approve, at most {status.dailyCap} a day, 10 minutes apart.
            </p>
          </div>
          {error === 'helper-ack' ? (
            <p role="alert" className="notice notice-danger">
              Tick the box to confirm you understand the risk.
            </p>
          ) : null}
          <label className="flex items-start gap-2">
            <input type="checkbox" name="ack" value="yes" className="mt-1 size-4 shrink-0" />
            <span>I understand this uses an unofficial Signal client on my computer, and my Signal account is my risk.</span>
          </label>
          <SubmitButton className="btn btn-primary">Turn on the Signal helper</SubmitButton>
        </form>
      ) : (
        <>
          {device ? (
            <div className="space-y-3 border-t border-line pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 font-semibold">
                  <span aria-hidden="true" className={`inline-block size-2.5 rounded-full ${device.online ? 'bg-accent' : 'bg-line'}`} />
                  {device.online
                    ? 'Helper online'
                    : device.lastSeenAt
                      ? `Helper offline since ${formatWhen(device.lastSeenAt, timezone)}`
                      : 'Paired, not connected yet'}
                </p>
                <span className="badge">
                  {status.sentToday} of {status.dailyCap} sent today
                </span>
              </div>
              <p className="hint">
                {device.name}
                {device.helperVersion ? `, tend-helper ${device.helperVersion}` : ''}
                {device.signalCliVersion ? `, signal-cli ${device.signalCliVersion}` : ''}. Paired {formatWhen(device.createdAt, timezone)}.
              </p>
              {device.haltedAt ? (
                <form action={resumeHelperAction} className="notice notice-danger space-y-3">
                  <p>
                    <strong>Sending is stopped.</strong> {HALT_TEXT[device.haltReason ?? ''] ?? 'Your helper stopped sending.'}
                  </p>
                  <SubmitButton className="btn btn-secondary btn-sm">Resume sending</SubmitButton>
                </form>
              ) : null}
              <p>
                When a message is due, you get a notification with <strong>Send</strong> and <strong>Skip</strong>. On iPhone, tap it to open the message and send
                from there.{' '}
                <Link href="/approvals" className="underline underline-offset-2">
                  Open your approvals
                </Link>
              </p>
              {notificationsOn ? null : (
                <p className="notice notice-warn">Turn on phone notifications above to get approvals on your phone. Until then, approve from the approvals page.</p>
              )}
              <form action={removeHelperAction}>
                <ConfirmButton message="Remove your helper? It stops at once and can no longer fetch or send anything." className="btn btn-secondary">
                  Remove helper
                </ConfirmButton>
              </form>
            </div>
          ) : (
            <div className="space-y-3 border-t border-line pt-5">
              <p className="font-semibold">Pair your helper</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  Install signal-cli and tend-helper on your PC and link it to your Signal (
                  <a href={`${HELPER_DOCS}#7-install-steps`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    install steps
                  </a>
                  ).
                </li>
                <li>Get a pairing code here and run the command it shows.</li>
              </ol>
              <HelperPairCode />
            </div>
          )}
          <form action={turnOffHelper} className="border-t border-line pt-5">
            <p className="hint mb-2">Turning it off removes your helper too. Messages go back to the usual reminders.</p>
            <SubmitButton className="btn btn-ghost btn-flush">Turn off the Signal helper</SubmitButton>
          </form>
        </>
      )}
    </div>
  )
}
