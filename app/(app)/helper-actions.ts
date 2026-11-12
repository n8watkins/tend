'use server'

/**
 * The Signal helper's actions for the signed-in user (docs/SIGNAL-HELPER.md):
 * turning it on and off, pairing and removing the helper, resuming after a
 * captcha, and Send, Skip, Send it again and It was sent on /approve/<id>.
 * Each re-reads the session; the helper is private, so an account that is
 * not allowed gets a 404.
 */

import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'

import { formatPairCode } from '@/lib/helper'
import {
  approveMessage,
  confirmSent,
  createPairCode,
  disableHelper,
  enableHelper,
  helperAllowedFor,
  removeHelper,
  resumeHelper,
  skipApproval,
} from '@/lib/server/helper'
import { getSettings, requireUser } from '@/lib/server/session'

async function allowedUser() {
  const user = await requireUser()
  if (!helperAllowedFor(user.email)) notFound()
  await getSettings(user.id)
  return user
}

function back(done: string): never {
  revalidatePath('/settings')
  redirect(`/settings?done=${done}#helper`)
}

export async function turnOnHelper(form: FormData): Promise<void> {
  const user = await allowedUser()
  if (form.get('ack') !== 'yes') redirect('/settings?error=helper-ack#helper')
  await enableHelper(user.id)
  back('helper-on')
}

export async function turnOffHelper(): Promise<void> {
  const user = await allowedUser()
  await disableHelper(user.id)
  back('helper-off')
}

export type PairCodeState = { code?: string; expiresAt?: number; error?: string } | undefined

export async function newPairCode(): Promise<PairCodeState> {
  const user = await allowedUser()
  const created = await createPairCode(user.id)
  if (!created) return { error: 'Turn the Signal helper on first.' }
  return { code: formatPairCode(created.code), expiresAt: created.expiresAt }
}

export async function removeHelperAction(): Promise<void> {
  const user = await allowedUser()
  await removeHelper(user.id)
  back('helper-removed')
}

export async function resumeHelperAction(): Promise<void> {
  const user = await allowedUser()
  await resumeHelper(user.id)
  back('helper-resumed')
}

function done(messageId: string, query: string): never {
  revalidatePath('/approvals')
  revalidatePath('/today')
  redirect(`/approve/${messageId}?${query}`)
}

export async function approveAction(messageId: string): Promise<void> {
  const user = await allowedUser()
  const result = await approveMessage(user.id, messageId, 'app')
  done(messageId, result.ok ? 'done=approved' : `error=${result.reason}`)
}

export async function sendAgainAction(messageId: string): Promise<void> {
  const user = await allowedUser()
  const result = await approveMessage(user.id, messageId, 'app', Date.now(), 'retry')
  done(messageId, result.ok ? 'done=approved' : `error=${result.reason}`)
}

export async function skipApprovalAction(messageId: string): Promise<void> {
  const user = await allowedUser()
  const result = await skipApproval(user.id, messageId)
  done(messageId, result.ok ? 'done=skipped' : 'error=state')
}

export async function confirmSentAction(messageId: string): Promise<void> {
  const user = await allowedUser()
  const ok = await confirmSent(user.id, messageId)
  done(messageId, ok ? 'done=confirmed' : 'error=state')
}
